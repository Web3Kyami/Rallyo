import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import {
  QuestionBankService,
  QuestionBankValidationError,
} from '../../src/core/question-bank-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('QuestionBankService against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const service = new QuestionBankService(db)
  const communityId = '10000000-0000-4000-8000-000000000001'

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.communities).values({
      id: communityId,
      telegramChatId: 991n,
      title: 'Brain test',
      slug: 'brain-test',
    })
  })

  afterAll(async () => close())

  it('deduplicates identical project source material by checksum', async () => {
    const input = {
      communityId,
      type: 'MARKDOWN' as const,
      title: 'Project guide',
      rawText: '# Wallets\n\nA signed message proves control without moving funds.',
    }
    const first = await service.ingestSource(input)
    const second = await service.ingestSource(input)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(await db.select().from(schema.knowledgeSources)).toHaveLength(1)
  })

  it('validates generated packs, stores them as drafts, and requires source references', async () => {
    const source = await service.ingestSource({
      communityId,
      type: 'PASTED_TEXT',
      title: 'Notes',
      rawText: 'Rallyo uses a signed message challenge to verify wallet control.',
    })
    const drafts = await service.saveGeneratedDraftPack({
      communityId,
      sourceId: source.source.id,
      questions: [
        {
          mode: 'QUICK',
          prompt: 'What proves control of a wallet without moving funds?',
          correctAnswer: 'Sign a message',
          acceptedAnswers: ['sign a message'],
          options: [
            { label: 'Sign a message', value: 'Sign a message' },
            { label: 'Send NIM', value: 'Send NIM' },
          ],
          category: 'Security',
          difficulty: 'easy',
          sourceRefs: [source.source.id],
        },
      ],
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.status).toBe('DRAFT')
    const approved = await service.approveQuestion(drafts[0]!.id)
    expect(approved.status).toBe('APPROVED')
    await expect(
      service.saveGeneratedDraftPack({
        communityId,
        sourceId: source.source.id,
        questions: [
          {
            mode: 'QUICK',
            prompt: 'This question omits the source reference entirely.',
            correctAnswer: 'A',
            acceptedAnswers: ['A'],
            options: [
              { label: 'A', value: 'A' },
              { label: 'B', value: 'B' },
            ],
            category: 'Test',
            difficulty: 'easy',
            sourceRefs: [],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(QuestionBankValidationError)
    expect(
      (
        await db
          .select()
          .from(schema.questions)
          .where(eq(schema.questions.communityId, communityId))
      ).every((question) => question.status === 'APPROVED'),
    ).toBe(true)
  })

  it('rejects ambiguous mode payloads before persistence', async () => {
    const source = await service.ingestSource({
      communityId,
      type: 'FAQ',
      title: 'FAQ',
      rawText: 'The community FAQ explains the wallet challenge and game rules clearly.',
    })
    await expect(
      service.saveGeneratedDraftPack({
        communityId,
        sourceId: source.source.id,
        questions: [
          {
            mode: 'CLUE',
            prompt: 'Identify the verification method used by Rallyo.',
            correctAnswer: 'Sign a message',
            acceptedAnswers: ['Sign a message'],
            category: 'Security',
            difficulty: 'medium',
            sourceRefs: [source.source.id],
          },
        ],
      }),
    ).rejects.toThrow('Clue Round requires three clues.')
    expect(await db.select().from(schema.questions)).toHaveLength(0)
  })
})
