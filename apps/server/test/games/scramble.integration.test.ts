import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, gte, lte, or } from 'drizzle-orm'

import { CommunityGameConfigService } from '../../src/core/community-game-config-service'
import { RoundService } from '../../src/core/round-service'
import { ScoreEventService } from '../../src/core/score-event-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import { ScrambleService, ScrambleStartError } from '../../src/games/scramble/service'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Scramble against PostgreSQL', () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)
  const configurations = new CommunityGameConfigService(db)
  const scramble = new ScrambleService(db, configurations)
  const now = new Date('2026-09-13T12:00:00.000Z')
  const ids = {
    communityOne: '60000000-0000-4000-8000-000000000001',
    communityTwo: '60000000-0000-4000-8000-000000000002',
    seasonOne: '60000000-0000-4000-8000-000000000003',
    seasonTwo: '60000000-0000-4000-8000-000000000004',
    playerOne: '60000000-0000-4000-8000-000000000005',
    playerTwo: '60000000-0000-4000-8000-000000000006',
    projectQuestion: '60000000-0000-4000-8000-000000000007',
  } as const

  beforeEach(async () => {
    const testCommunities = or(
      eq(schema.communities.id, ids.communityOne),
      eq(schema.communities.id, ids.communityTwo),
    )
    await db
      .delete(schema.scoreEvents)
      .where(
        or(
          eq(schema.scoreEvents.communityId, ids.communityOne),
          eq(schema.scoreEvents.communityId, ids.communityTwo),
        ),
      )
    await db.delete(schema.communities).where(testCommunities)
    await db
      .delete(schema.players)
      .where(or(eq(schema.players.id, ids.playerOne), eq(schema.players.id, ids.playerTwo)))
    await db
      .delete(schema.telegramUpdates)
      .where(
        and(
          gte(schema.telegramUpdates.telegramUpdateId, 6100n),
          lte(schema.telegramUpdates.telegramUpdateId, 6300n),
        ),
      )
    await db.insert(schema.players).values([{ id: ids.playerOne }, { id: ids.playerTwo }])
    await db.insert(schema.communities).values([
      {
        id: ids.communityOne,
        telegramChatId: 6001n,
        title: 'Scramble One',
        slug: 'scramble-one',
      },
      {
        id: ids.communityTwo,
        telegramChatId: 6002n,
        title: 'Scramble Two',
        slug: 'scramble-two',
      },
    ])
    await db.insert(schema.seasons).values([
      {
        id: ids.seasonOne,
        communityId: ids.communityOne,
        name: 'Scramble season one',
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60 * 60_000),
        status: 'ACTIVE',
      },
      {
        id: ids.seasonTwo,
        communityId: ids.communityTwo,
        name: 'Scramble season two',
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60 * 60_000),
        status: 'ACTIVE',
      },
    ])
    await configurations.set({
      communityId: ids.communityOne,
      gameKey: 'scramble',
      enabled: true,
      config: {
        source: 'GENERAL',
        points: 10,
        timeoutSeconds: 60,
        hintsEnabled: true,
        maxHints: 2,
        hintTimingSeconds: [10, 20],
        pointReductions: [2, 3],
        noRepeatRounds: 5,
      },
    })
  })

  afterAll(async () => close())

  it('does not start while disabled and isolates communities', async () => {
    await expect(
      scramble.startRound({ communityId: ids.communityTwo, seasonId: ids.seasonTwo, now }),
    ).rejects.toBeInstanceOf(ScrambleStartError)

    const round = await scramble.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now,
      random: () => 0,
    })
    expect(round.communityId).toBe(ids.communityOne)
    expect(round.status).toBe('LIVE')
  })

  it('starts deterministically, recovers after service restart, and avoids recent terms', async () => {
    const first = await scramble.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now,
      random: () => 0,
    })
    expect(first.scrambledTerm).not.toBe(first.term)
    expect(first.scrambledTerm).not.toBe(first.term.toUpperCase())

    const restarted = new ScrambleService(db, configurations)
    expect(await restarted.activeRoundForCommunity(ids.communityOne, now)).toMatchObject({
      id: first.id,
    })

    await restarted.expireDueRounds(new Date(now.getTime() + 60_000))
    const second = await restarted.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now: new Date(now.getTime() + 60_001),
      random: () => 0,
    })
    expect(second.normalizedAnswer).not.toBe(first.normalizedAnswer)
  })

  it('awards the first correct answer once under concurrency and aggregates with Quiz', async () => {
    const round = await scramble.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now,
      random: () => 0,
    })
    const answer = `${round.term.toUpperCase()}!!!`
    const results = await Promise.all([
      scramble.submitGuess({
        telegramUpdateId: 6101n,
        telegramInputId: 'chat:6001:message:1',
        roundId: round.id,
        playerId: ids.playerOne,
        rawAnswer: answer,
        now,
      }),
      scramble.submitGuess({
        telegramUpdateId: 6102n,
        telegramInputId: 'chat:6001:message:2',
        roundId: round.id,
        playerId: ids.playerTwo,
        rawAnswer: answer,
        now,
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['ROUND_CLOSED', 'WON'])
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.sourceType, 'SCRAMBLE')),
    ).toHaveLength(1)

    await new ScoreEventService(db).award({
      playerId: ids.playerOne,
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      sourceType: 'QUIZ',
      sourceId: 'quiz:aggregate',
      points: 3,
      reason: 'test quiz contribution',
      idempotencyKey: 'quiz:aggregate',
    })
    const leaderboard = await new RoundService(db).leaderboardForSeason(
      ids.communityOne,
      ids.seasonOne,
    )
    expect(leaderboard[0]).toMatchObject({ playerId: ids.playerOne, points: 13 })
  })

  it('progresses hints, reduces only available points, and stops hints after a winner', async () => {
    const round = await scramble.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now,
      random: () => 0,
    })
    expect(
      await scramble.requestHint({ roundId: round.id, now: new Date(now.getTime() + 9_000) }),
    ).toMatchObject({
      status: 'NOT_READY',
    })
    const first = await scramble.requestHint({
      roundId: round.id,
      now: new Date(now.getTime() + 10_000),
    })
    expect(first).toMatchObject({ status: 'HINT', pointsRemaining: 8 })
    const second = await scramble.requestHint({
      roundId: round.id,
      now: new Date(now.getTime() + 20_000),
    })
    expect(second).toMatchObject({ status: 'HINT', pointsRemaining: 5 })

    await scramble.submitGuess({
      telegramUpdateId: 6201n,
      telegramInputId: 'chat:6001:message:3',
      roundId: round.id,
      playerId: ids.playerOne,
      rawAnswer: round.term,
      now: new Date(now.getTime() + 21_000),
    })
    expect(
      await scramble.requestHint({ roundId: round.id, now: new Date(now.getTime() + 22_000) }),
    ).toEqual({
      status: 'ROUND_CLOSED',
    })
  })

  it('times out and can use approved Project Brain terminology', async () => {
    await configurations.set({
      communityId: ids.communityOne,
      gameKey: 'scramble',
      enabled: true,
      config: {
        source: 'PROJECT_BRAIN',
        points: 9,
        timeoutSeconds: 30,
        hintsEnabled: false,
        maxHints: 0,
        hintTimingSeconds: [],
        pointReductions: [],
        noRepeatRounds: 0,
      },
    })
    await db.insert(schema.questions).values({
      id: ids.projectQuestion,
      scope: 'COMMUNITY',
      communityId: ids.communityOne,
      source: 'PROJECT_AI',
      mode: 'FIRST_CORRECT',
      category: 'Project Brain',
      difficulty: 'easy',
      prompt: 'Which approved project term should be used here?',
      correctAnswer: 'Nimiq Pay',
      acceptedAnswers: ['Nimiq Pay'],
      basePoints: 15,
      fingerprint: 'scramble-project-term',
      status: 'APPROVED',
    })

    const round = await scramble.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now,
      random: () => 0,
    })
    expect(round.source).toBe('PROJECT_BRAIN')
    expect(round.term).toBe('Nimiq Pay')
    expect(await scramble.expireDueRounds(new Date(now.getTime() + 30_000))).toHaveLength(1)
    expect(
      await scramble.activeRoundForCommunity(ids.communityOne, new Date(now.getTime() + 30_001)),
    ).toBeNull()
    expect(await db.select().from(schema.walletIdentities)).toHaveLength(0)
  })

  it('prefers approved project vocabulary while retaining the general fallback', async () => {
    await configurations.set({
      communityId: ids.communityOne,
      gameKey: 'scramble',
      enabled: true,
      config: {
        source: 'GENERAL',
        points: 9,
        timeoutSeconds: 30,
        hintsEnabled: false,
        maxHints: 0,
        hintTimingSeconds: [],
        pointReductions: [],
        noRepeatRounds: 0,
      },
    })
    await db.insert(schema.wordSeekWords).values({
      communityId: ids.communityOne,
      word: 'rallyo',
      wordLength: 6,
      status: 'APPROVED',
    })

    const round = await scramble.startRound({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      now,
      random: () => 0,
    })
    expect(round.source).toBe('PROJECT_BRAIN')
    expect(round.term).toBe('rallyo')
    expect(round.category).toBe('Project vocabulary')
  })
})
