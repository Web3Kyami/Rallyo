import { normalizeAnswer } from '@rallyo/core'
import { z } from 'zod'

import { gameDifficultySchema } from '../games/difficulty'

export const contentPresentationSchema = z.enum([
  'TEXT',
  'MCQ',
  'IMAGE_IDENTIFY',
  'IMAGE_CLUE',
  'MATH',
  'PROGRESSIVE_CLUE',
])

export const preparedMediaSchema = z
  .object({
    type: z.string().trim().min(1).max(32),
    fileId: z.string().trim().min(1).optional(),
    assetRef: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1).optional(),
    credit: z.string().trim().min(1).optional(),
    alt: z.string().trim().min(1).optional(),
    spoiler: z.boolean().default(false),
  })
  .superRefine((media, context) => {
    if (!media.fileId && !media.assetRef) {
      context.addIssue({
        code: 'custom',
        path: ['fileId'],
        message: 'Prepared media needs a Telegram file ID or asset reference.',
      })
    }
  })

export const preparedQuizItemSchema = z
  .object({
    question: z.string().trim().min(1),
    answer: z.string().trim().min(1),
    aliases: z.array(z.string().trim().min(1)).default([]),
    category: z.string().trim().min(1),
    difficulty: gameDifficultySchema.default('AUTO'),
    presentationType: contentPresentationSchema.default('TEXT'),
    options: z
      .array(z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) }))
      .min(2)
      .optional(),
    hints: z.array(z.string().trim().min(1)).max(3).default([]),
    media: preparedMediaSchema.optional(),
    sourceRefs: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((item, context) => {
    if (
      item.presentationType === 'MCQ' &&
      !item.options?.some(
        (option) => normalizeAnswer(option.value) === normalizeAnswer(item.answer),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'MCQ content needs an option matching the answer.',
      })
    }
    if (
      (item.presentationType === 'IMAGE_IDENTIFY' || item.presentationType === 'IMAGE_CLUE') &&
      !item.media
    ) {
      context.addIssue({
        code: 'custom',
        path: ['media'],
        message: 'Image content needs prepared media metadata.',
      })
    }
  })

export type PreparedQuizItem = z.infer<typeof preparedQuizItemSchema>

export function validatePreparedQuizItem(input: unknown): PreparedQuizItem {
  const result = preparedQuizItemSchema.safeParse(input)
  if (!result.success) {
    throw new ContentPreparationError(result.error.issues.map((issue) => issue.message).join(' '))
  }
  return result.data
}

export function normalizePreparedAliases(item: PreparedQuizItem): readonly string[] {
  return [...new Set([item.answer, ...item.aliases].map(normalizeAnswer).filter(Boolean))]
}

export interface OfflineContentProvider {
  generate(input: { readonly sourceText: string }): Promise<readonly unknown[]>
}

export async function prepareOfflineContent(
  provider: OfflineContentProvider,
  sourceText: string,
): Promise<PreparedQuizItem[]> {
  const candidates = await provider.generate({ sourceText })
  return candidates.map(validatePreparedQuizItem)
}

export function createMathQuestion(
  difficulty: Exclude<z.infer<typeof gameDifficultySchema>, 'AUTO'>,
  seed: number,
) {
  const random = seededRandom(seed)
  const left = difficulty === 'EASY' ? 2 + randomInt(random, 18) : 10 + randomInt(random, 90)
  const right = difficulty === 'EASY' ? 2 + randomInt(random, 18) : 2 + randomInt(random, 28)
  const operation =
    difficulty === 'EASY'
      ? random() < 0.5
        ? '+'
        : '-'
      : difficulty === 'MEDIUM'
        ? ['+', '-', '×'][randomInt(random, 3)]!
        : ['+', '-', '×', '%'][randomInt(random, 4)]!
  const answer = calculateMathAnswer(left, right, operation)
  return {
    question: `${left} ${operation} ${right} = ?`,
    answer: String(answer),
    aliases: [String(answer)],
    category: 'Mental maths',
    difficulty,
    presentationType: 'MATH' as const,
    hints: ['Take a breath and work it out mentally.'],
    sourceRefs: ['rallyo:math:v1'],
  }
}

export class ContentPreparationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentPreparationError'
  }
}

function calculateMathAnswer(left: number, right: number, operation: string): number {
  switch (operation) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '×':
      return left * right
    case '%':
      return Math.round((left * right) / 100)
    default:
      return 0
  }
}

function seededRandom(seed: number): () => number {
  let state = Math.abs(Math.trunc(seed)) % 2_147_483_647
  if (state === 0) state = 1
  return () => {
    state = (state * 16_807) % 2_147_483_647
    return (state - 1) / 2_147_483_646
  }
}

function randomInt(random: () => number, maxExclusive: number): number {
  return Math.floor(Math.min(0.999999, Math.max(0, random())) * maxExclusive)
}
