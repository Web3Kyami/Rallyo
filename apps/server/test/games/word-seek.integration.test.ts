import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { CommunityGameConfigService } from '../../src/core/community-game-config-service'
import { ScoreEventService } from '../../src/core/score-event-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import { WordSeekService } from '../../src/games/word-seek/service'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Word Seek against PostgreSQL', { timeout: 30_000 }, () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)
  const configurations = new CommunityGameConfigService(db)
  const wordSeek = new WordSeekService(db, configurations, () => 0)
  const scores = new ScoreEventService(db)
  const now = new Date('2026-09-13T12:00:00.000Z')
  const ids = {
    communityOne: '70000000-0000-4000-8000-000000000001',
    communityTwo: '70000000-0000-4000-8000-000000000002',
    seasonOne: '70000000-0000-4000-8000-000000000003',
    seasonTwo: '70000000-0000-4000-8000-000000000004',
    playerOne: '70000000-0000-4000-8000-000000000005',
    playerTwo: '70000000-0000-4000-8000-000000000006',
    playerThree: '70000000-0000-4000-8000-000000000007',
  } as const

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db
      .insert(schema.players)
      .values([{ id: ids.playerOne }, { id: ids.playerTwo }, { id: ids.playerThree }])
    await db.insert(schema.communities).values([
      {
        id: ids.communityOne,
        telegramChatId: 7001n,
        title: 'Word Seek one',
        slug: 'word-seek-one',
      },
      {
        id: ids.communityTwo,
        telegramChatId: 7002n,
        title: 'Word Seek two',
        slug: 'word-seek-two',
      },
    ])
    await db.insert(schema.seasons).values([
      {
        id: ids.seasonOne,
        communityId: ids.communityOne,
        name: 'Word Seek season one',
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 3_600_000),
        status: 'ACTIVE',
      },
      {
        id: ids.seasonTwo,
        communityId: ids.communityTwo,
        name: 'Word Seek season two',
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 3_600_000),
        status: 'ACTIVE',
      },
    ])
  })

  afterAll(async () => close())

  async function enable(communityId: string, config: Record<string, unknown> = {}) {
    await configurations.set({
      communityId,
      gameKey: 'word_seek',
      enabled: true,
      config: { wordLength: 5, roundTimeoutSeconds: 60, maxGuesses: 3, points: 30, ...config },
    })
  }

  async function start(communityId: string = ids.communityOne, seasonId: string = ids.seasonOne) {
    return wordSeek.start({
      communityId,
      seasonId,
      startsAt: now,
      now,
      targetWord: 'crane',
    })
  }

  it('enforces disabled-by-default capability and starts when enabled', async () => {
    await expect(start()).rejects.toThrow('disabled')
    await enable(ids.communityOne)
    const session = await start()
    expect(session.targetWord).toBe('crane')
    expect(session.status).toBe('LIVE')
    expect(await wordSeek.activeSession(ids.communityOne)).toMatchObject({ id: session.id })
  })

  it('keeps communities isolated and uses one shared seasonal score ledger', async () => {
    await enable(ids.communityOne)
    const session = await start()
    await scores.award({
      playerId: ids.playerOne,
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      sourceType: 'QUIZ',
      sourceId: 'quiz:one',
      points: 10,
      reason: 'existing quiz score',
      idempotencyKey: 'quiz:one:player-one',
    })

    const result = await wordSeek.submitGuess({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      telegramUpdateId: 1n,
      telegramInputId: 'chat:7001:message:1',
      rawGuess: 'CRANE',
      now,
    })
    expect(result.status).toBe('WON')

    const events = await db
      .select()
      .from(schema.scoreEvents)
      .where(
        and(
          eq(schema.scoreEvents.communityId, ids.communityOne),
          eq(schema.scoreEvents.seasonId, ids.seasonOne),
        ),
      )
    expect(events).toHaveLength(2)
    expect(events.find((event) => event.sourceType === 'WORD_SEEK')).toMatchObject({
      sourceId: session.id,
      delta: 30,
    })
    expect(await wordSeek.activeSession(ids.communityTwo)).toBeNull()
    await expect(start(ids.communityTwo, ids.seasonTwo)).rejects.toThrow('disabled')
  })

  it('handles valid, invalid, duplicate, and replayed input deterministically', async () => {
    await enable(ids.communityOne)
    const session = await start()

    await expect(
      wordSeek.submitGuess({
        communityId: ids.communityOne,
        playerId: ids.playerOne,
        telegramUpdateId: 2n,
        telegramInputId: 'chat:7001:message:2',
        rawGuess: 'nope',
        now,
      }),
    ).resolves.toMatchObject({ status: 'INVALID_LENGTH', wordLength: 5 })

    const feedback = await wordSeek.submitGuess({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      telegramUpdateId: 3n,
      telegramInputId: 'chat:7001:message:3',
      rawGuess: 'speed',
      now,
    })
    expect(feedback).toMatchObject({ status: 'FEEDBACK', guessesUsed: 1 })
    expect(
      await wordSeek.submitGuess({
        communityId: ids.communityOne,
        playerId: ids.playerTwo,
        telegramUpdateId: 4n,
        telegramInputId: 'chat:7001:message:4',
        rawGuess: 'SPEED',
        now,
      }),
    ).toMatchObject({ status: 'DUPLICATE_GUESS' })

    const won = await wordSeek.submitGuess({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      telegramUpdateId: 5n,
      telegramInputId: 'chat:7001:message:5',
      rawGuess: 'crane',
      now,
    })
    expect(won.status).toBe('WON')
    expect(
      await wordSeek.submitGuess({
        communityId: ids.communityOne,
        playerId: ids.playerOne,
        telegramUpdateId: 5n,
        telegramInputId: 'chat:7001:message:5',
        rawGuess: 'crane',
        now,
      }),
    ).toMatchObject({ status: 'DUPLICATE_UPDATE' })
    expect(await db.select().from(schema.wordSeekGuesses)).toHaveLength(2)
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
    expect(await db.select().from(schema.analyticsEvents)).toHaveLength(3)
    expect(session.id).toBeTruthy()
  })

  it('arbitrates concurrent solvers to one winner and one score event', async () => {
    await enable(ids.communityOne)
    await start()

    const results = await Promise.all([
      wordSeek.submitGuess({
        communityId: ids.communityOne,
        playerId: ids.playerOne,
        telegramUpdateId: 6n,
        telegramInputId: 'chat:7001:message:6',
        rawGuess: 'crane',
        now,
      }),
      wordSeek.submitGuess({
        communityId: ids.communityOne,
        playerId: ids.playerTwo,
        telegramUpdateId: 7n,
        telegramInputId: 'chat:7001:message:7',
        rawGuess: 'crane',
        now,
      }),
    ])

    expect(results.filter((result) => result.status === 'WON')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'NO_ACTIVE_GAME')).toHaveLength(1)
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
    expect(await db.select().from(schema.wordSeekGuesses)).toHaveLength(1)
  })

  it('closes an expired session and recovers through a fresh service instance', async () => {
    await enable(ids.communityOne, { roundTimeoutSeconds: 30 })
    const session = await start()
    const expired = await wordSeek.submitGuess({
      communityId: ids.communityOne,
      playerId: ids.playerThree,
      telegramUpdateId: 8n,
      telegramInputId: 'chat:7001:message:8',
      rawGuess: 'crane',
      now: new Date(now.getTime() + 31_000),
    })
    expect(expired).toMatchObject({ status: 'TIMED_OUT', sessionId: session.id, word: 'crane' })
    expect(await wordSeek.activeSession(ids.communityOne)).toBeNull()
    const restarted = new WordSeekService(db, configurations, () => 0)
    expect(await restarted.recover(ids.communityOne)).toBeNull()
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(0)
  })

  it('supports an approved project vocabulary source', async () => {
    await enable(ids.communityOne, { source: 'PROJECT' })
    const projectWord = await wordSeek.createProjectWord({
      communityId: ids.communityOne,
      word: 'rally',
      clue: 'A coordinated push.',
      sourceRef: 'project-glossary',
    })
    const isolatedDraft = await wordSeek.createProjectWord({
      communityId: ids.communityOne,
      word: 'orbit',
    })
    await expect(wordSeek.approveProjectWord(isolatedDraft.id, ids.communityTwo)).rejects.toThrow(
      'Only an existing project word draft can be approved.',
    )
    await wordSeek.approveProjectWord(projectWord.id)
    const session = await wordSeek.start({
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      startsAt: now,
      now,
      targetWord: 'rally',
    })
    expect(session.sourceType).toBe('PROJECT')
    expect(session.sourceId).toBe(projectWord.id)
    expect(session.clue).toBe('A coordinated push.')
  })
})
