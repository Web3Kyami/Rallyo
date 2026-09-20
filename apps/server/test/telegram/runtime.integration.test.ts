import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { RoundService } from '../../src/core/round-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import { processQuizTimeoutTick } from '../../src/telegram/runtime'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Telegram quiz runtime against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const now = new Date('2026-09-20T12:01:00.000Z')
  const ids = {
    community: '71000000-0000-4000-8000-000000000001',
    season: '71000000-0000-4000-8000-000000000002',
    player: '71000000-0000-4000-8000-000000000003',
    question: '71000000-0000-4000-8000-000000000004',
    round: '71000000-0000-4000-8000-000000000005',
  } as const

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values({ id: ids.player })
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 7101n,
      title: 'Runtime quiz test',
      slug: 'runtime-quiz-test',
    })
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.community,
      name: 'Runtime season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.questions).values({
      id: ids.question,
      scope: 'COMMUNITY',
      communityId: ids.community,
      source: 'MANUAL',
      mode: 'FIRST_CORRECT',
      category: 'runtime',
      difficulty: 'HARD',
      prompt: 'What is the timeout answer?',
      correctAnswer: 'Nimiq',
      acceptedAnswers: ['Nimiq'],
      basePoints: 10,
      fingerprint: 'runtime-timeout-question',
      status: 'APPROVED',
    })
    await db.insert(schema.rounds).values({
      id: ids.round,
      communityId: ids.community,
      seasonId: ids.season,
      questionId: ids.question,
      state: 'LIVE',
      startsAt: new Date(now.getTime() - 61_000),
      locksAt: new Date(now.getTime() - 1_000),
      telegramMessageId: 88n,
    })
  })

  afterAll(async () => close())

  it('durably closes a timed-out round, resolves Telegram, and rejects late answers', async () => {
    const editMessageText = vi.fn().mockRejectedValue(new Error('message is no longer editable'))
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 89 })
    const bot = { api: { editMessageText, sendMessage } } as never
    const roundService = new RoundService(db)

    await processQuizTimeoutTick(bot, roundService, db, now)

    expect(await db.select({ state: schema.rounds.state }).from(schema.rounds)).toEqual([
      { state: 'CLOSED' },
    ])
    expect(editMessageText).toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith(
      7101,
      expect.stringContaining("<b>⏱ TIME'S UP</b>"),
      expect.any(Object),
    )

    const late = await roundService.submitQuickQuizAnswer({
      telegramUpdateId: 71001n,
      telegramInputId: 'late-answer-1',
      roundId: ids.round,
      playerId: ids.player,
      rawAnswer: 'Nimiq',
      now,
      updateAlreadyClaimed: true,
    })
    expect(late).toEqual({ status: 'ROUND_CLOSED' })
    expect(
      await db.select().from(schema.scoreEvents).where(eq(schema.scoreEvents.roundId, ids.round)),
    ).toHaveLength(0)
  })
})
