import { createHash } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

const optionSchema = z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) })
const generatedQuestionSchema = z
  .object({
    mode: z.enum(['QUICK', 'FIRST_CORRECT', 'CLUE']),
    prompt: z.string().trim().min(12),
    correctAnswer: z.string().trim().min(1),
    acceptedAnswers: z.array(z.string().trim().min(1)).min(1),
    options: z.array(optionSchema).min(2).optional(),
    clueData: z.object({ clues: z.array(z.string().trim().min(3)).length(3) }).optional(),
    category: z.string().trim().min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    explanation: z.string().trim().min(1).optional(),
    sourceRefs: z.array(z.string().trim().min(1)).min(1),
    basePoints: z.number().int().positive().optional(),
  })
  .superRefine((question, context) => {
    if (question.mode === 'QUICK') {
      if (!question.options || question.options.length < 2) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Quick Quiz requires options.',
        })
      } else if (!question.options.some((option) => option.value === question.correctAnswer)) {
        context.addIssue({
          code: 'custom',
          path: ['correctAnswer'],
          message: 'Correct answer must match one option value.',
        })
      }
    }
    if (question.mode === 'CLUE' && !question.clueData) {
      context.addIssue({
        code: 'custom',
        path: ['clueData'],
        message: 'Clue Round requires three clues.',
      })
    }
  })

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>

export class QuestionBankValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuestionBankValidationError'
  }
}

export class QuestionBankService {
  constructor(private readonly database: RallyoDatabase) {}

  async listCommunityQuestions(communityId: string) {
    return this.database
      .select({
        id: schema.questions.id,
        mode: schema.questions.mode,
        category: schema.questions.category,
        difficulty: schema.questions.difficulty,
        prompt: schema.questions.prompt,
        basePoints: schema.questions.basePoints,
        status: schema.questions.status,
        source: schema.questions.source,
        createdAt: schema.questions.createdAt,
      })
      .from(schema.questions)
      .where(
        and(eq(schema.questions.scope, 'COMMUNITY'), eq(schema.questions.communityId, communityId)),
      )
      .orderBy(desc(schema.questions.createdAt))
  }

  async ingestSource(input: {
    readonly communityId: string
    readonly type: 'PASTED_TEXT' | 'MARKDOWN' | 'FAQ'
    readonly title: string
    readonly rawText: string
  }) {
    const title = input.title.trim()
    const rawText = input.rawText.trim()
    if (!title) throw new QuestionBankValidationError('Knowledge source title is required.')
    if (rawText.length < 20) throw new QuestionBankValidationError('Knowledge source is too short.')

    const checksum = sha256(rawText)
    const [existing] = await this.database
      .select()
      .from(schema.knowledgeSources)
      .where(
        and(
          eq(schema.knowledgeSources.communityId, input.communityId),
          eq(schema.knowledgeSources.checksum, checksum),
        ),
      )
      .limit(1)
    if (existing) return { source: existing, created: false }

    const [source] = await this.database
      .insert(schema.knowledgeSources)
      .values({
        communityId: input.communityId,
        type: input.type,
        title,
        rawText,
        checksum,
      })
      .returning()
    if (!source) throw new Error('Knowledge source could not be persisted.')
    return { source, created: true }
  }

  validateGeneratedPack(input: unknown): GeneratedQuestion[] {
    if (!Array.isArray(input))
      throw new QuestionBankValidationError('Generated pack must be an array.')
    const parsed = z.array(generatedQuestionSchema).safeParse(input)
    if (!parsed.success) {
      throw new QuestionBankValidationError(
        parsed.error.issues.map((issue) => issue.message).join(' '),
      )
    }
    return parsed.data
  }

  async saveGeneratedDraftPack(input: {
    readonly communityId: string
    readonly sourceId: string
    readonly questions: unknown
  }) {
    const pack = this.validateGeneratedPack(input.questions)
    const [source] = await this.database
      .select({ id: schema.knowledgeSources.id })
      .from(schema.knowledgeSources)
      .where(
        and(
          eq(schema.knowledgeSources.id, input.sourceId),
          eq(schema.knowledgeSources.communityId, input.communityId),
        ),
      )
      .limit(1)
    if (!source) throw new QuestionBankValidationError('Knowledge source is not in this community.')
    if (pack.some((question) => !question.sourceRefs.includes(input.sourceId))) {
      throw new QuestionBankValidationError(
        'Every generated question must reference its source record.',
      )
    }

    return this.database.transaction(async (tx) => {
      const drafts = []
      for (const question of pack) {
        const fingerprint = questionFingerprint(question)
        const [draft] = await tx
          .insert(schema.questions)
          .values({
            scope: 'COMMUNITY',
            communityId: input.communityId,
            source: 'PROJECT_AI',
            mode: question.mode,
            category: question.category,
            difficulty: question.difficulty,
            prompt: question.prompt,
            options: question.options,
            correctAnswer: question.correctAnswer,
            acceptedAnswers: uniqueStrings([question.correctAnswer, ...question.acceptedAnswers]),
            clueData: question.clueData,
            explanation: question.explanation,
            sourceRefs: question.sourceRefs,
            basePoints: question.basePoints ?? defaultPoints(question.mode),
            fingerprint,
            status: 'DRAFT',
          })
          .returning()
        if (!draft) throw new Error('Generated question could not be persisted.')
        drafts.push(draft)
      }
      return drafts
    })
  }

  async approveQuestion(questionId: string, communityId?: string) {
    const [question] = await this.database
      .update(schema.questions)
      .set({ status: 'APPROVED' })
      .where(
        and(
          eq(schema.questions.id, questionId),
          eq(schema.questions.status, 'DRAFT'),
          ...(communityId ? [eq(schema.questions.communityId, communityId)] : []),
        ),
      )
      .returning()
    if (!question) throw new QuestionBankValidationError('Only an existing draft can be approved.')
    return question
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function questionFingerprint(question: GeneratedQuestion): string {
  return sha256(
    [
      question.mode,
      question.prompt.trim().toLowerCase(),
      question.correctAnswer.trim().toLowerCase(),
    ].join('|'),
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function defaultPoints(mode: GeneratedQuestion['mode']): number {
  return mode === 'FIRST_CORRECT' ? 15 : mode === 'CLUE' ? 30 : 20
}
