import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { eq, sql } from 'drizzle-orm'

import { CommunityGameConfigService } from '../../src/core/community-game-config-service'
import { RoundService } from '../../src/core/round-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

// Regression guard for the multiple-choice answer lockout.
//
// `answers_round_player_unique` is (roundId, playerId): one answer row per player
// per round. A wrong tap claims that row. When the player then tapped the CORRECT
// option, the old code locked the round first and only then tried to insert,
// so the insert collided, returned zero rows, and threw ScoreAwardError. The
// transaction rolled back, the round returned to LIVE, and the player's correct
// answer scored nothing.
//
// A player who guesses wrong once must still be able to win the round.
describeDatabase('RoundService multiple-choice answer recovery', () => {
  if (!databaseUrl) {
    return
  }

  const { db, close } = createDatabase(databaseUrl)
  const now = new Date('2026-09-12T12:00:00.000Z')

  const ids = {
    community: '00000000-0000-4000-8000-0000000000b1',
    season: '00000000-0000-4000-8000-0000000000b2',
    question: '00000000-0000-4000-8000-0000000000b3',
    round: '00000000-0000-4000-8000-0000000000b4',
    player: '00000000-0000-4000-8000-0000000000b5',
  } as const

  async function seedMultipleChoiceRound() {
    await db.insert(schema.players).values({ id: ids.player })
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 11n,
      title: 'Multiple-choice recovery community',
      slug: 'multiple-choice-recovery-community',
    })
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.community,
      name: 'Multiple-choice recovery season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.questions).values({
      id: ids.question,
      scope: 'COMMUNITY',
      communityId: ids.community,
      source: 'MANUAL',
      mode: 'QUICK',
      category: 'test',
      difficulty: 'easy',
      prompt: 'Which option is correct?',
      correctAnswer: 'Right',
      acceptedAnswers: ['right'],
      options: [
        { label: 'Right', value: 'Right' },
        { label: 'Wrong', value: 'Wrong' },
      ],
      basePoints: 20,
      fingerprint: 'multiple-choice-recovery-fingerprint',
      status: 'APPROVED',
    })
    await db.insert(schema.rounds).values({
      id: ids.round,
      communityId: ids.community,
      seasonId: ids.season,
      questionId: ids.question,
      state: 'LIVE',
      presentation: 'multiple_choice',
      startsAt: now,
      locksAt: new Date(now.getTime() + 60_000),
    })
  }

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await seedMultipleChoiceRound()
  })

  afterAll(async () => {
    await close()
  })

  it('awards a correct answer after the player already tapped a wrong option', async () => {
    const service = new RoundService(db, new CommunityGameConfigService(db))

    const wrong = await service.submitQuickQuizAnswer({
      telegramUpdateId: 8101n,
      telegramInputId: 'chat:11:message:1',
      roundId: ids.round,
      playerId: ids.player,
      rawAnswer: 'Wrong',
      now,
    })
    expect(wrong).toEqual({ status: 'WRONG' })

    const correct = await service.submitQuickQuizAnswer({
      telegramUpdateId: 8102n,
      telegramInputId: 'chat:11:message:2',
      roundId: ids.round,
      playerId: ids.player,
      rawAnswer: 'Right',
      now,
    })

    expect(correct).toEqual({ status: 'ACCEPTED', points: 20 })
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
    expect(
      await db.select().from(schema.rounds).where(eq(schema.rounds.id, ids.round)),
    ).toMatchObject([{ state: 'LOCKED' }])
  })

  it('awards exactly one score event when a second correct answer arrives', async () => {
    const service = new RoundService(db, new CommunityGameConfigService(db))

    expect(
      await service.submitQuickQuizAnswer({
        telegramUpdateId: 8201n,
        telegramInputId: 'chat:11:message:1',
        roundId: ids.round,
        playerId: ids.player,
        rawAnswer: 'Right',
        now,
      }),
    ).toEqual({ status: 'ACCEPTED', points: 20 })

    expect(
      await service.submitQuickQuizAnswer({
        telegramUpdateId: 8202n,
        telegramInputId: 'chat:11:message:2',
        roundId: ids.round,
        playerId: ids.player,
        rawAnswer: 'Right',
        now,
      }),
    ).toEqual({ status: 'ROUND_CLOSED' })

    const events = await db.select().from(schema.scoreEvents)
    expect(events).toHaveLength(1)
    expect(events[0]?.delta).toBe(20)
  })
})
