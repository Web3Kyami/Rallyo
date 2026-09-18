import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { RallyoXpService } from '../../src/core/rallyo-xp-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

const ids = {
  playerOne: '40000000-0000-4000-8000-000000000001',
  playerTwo: '40000000-0000-4000-8000-000000000002',
  playerThree: '40000000-0000-4000-8000-000000000003',
  identityOne: '40000000-0000-4000-8000-000000000011',
  identityTwo: '40000000-0000-4000-8000-000000000012',
  identityThree: '40000000-0000-4000-8000-000000000013',
  community: '40000000-0000-4000-8000-000000000021',
  season: '40000000-0000-4000-8000-000000000022',
} as const

const now = new Date('2026-09-18T12:00:00.000Z')

describeDatabase('Rallyo XP service against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const service = new RallyoXpService(db)

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values([
      {
        id: ids.playerOne,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: ids.playerTwo,
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
      },
      {
        id: ids.playerThree,
        createdAt: new Date('2026-09-03T00:00:00.000Z'),
      },
    ])
    await db.insert(schema.telegramIdentities).values([
      {
        id: ids.identityOne,
        playerId: ids.playerOne,
        telegramUserId: 4001n,
        displayName: 'Alpha Player',
      },
      {
        id: ids.identityTwo,
        playerId: ids.playerTwo,
        telegramUserId: 4002n,
        displayName: 'Beta Player',
      },
      {
        id: ids.identityThree,
        playerId: ids.playerThree,
        telegramUserId: 4003n,
        displayName: 'Gamma Player',
      },
    ])
  })

  afterAll(async () => close())

  it('awards the first daily claim once and keeps the second claim at zero', async () => {
    const first = await service.claimDailyCheckin(ids.playerOne, now)
    const second = await service.claimDailyCheckin(ids.playerOne, now)

    expect(first).toMatchObject({ claimed: true, xpAwarded: 10 })
    expect(first.progression).toMatchObject({
      totalXp: 10,
      todayClaimed: true,
      globalRank: 1,
    })
    expect(second).toMatchObject({ claimed: false, xpAwarded: 0 })
    expect(second.progression.totalXp).toBe(10)
    expect(await db.select().from(schema.rallyoXpEvents)).toHaveLength(1)
  })

  it('uses the database uniqueness boundary for concurrent claims', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.claimDailyCheckin(ids.playerOne, now)),
    )

    expect(results.filter((result) => result.claimed)).toHaveLength(1)
    expect(results.filter((result) => result.xpAwarded === 10)).toHaveLength(1)
    expect(await db.select().from(schema.rallyoXpEvents)).toHaveLength(1)
    expect((await service.progression(ids.playerOne, now)).totalXp).toBe(10)
  })

  it('opens a new claim at the next UTC calendar day', async () => {
    const beforeMidnight = new Date('2026-09-18T23:59:59.999Z')
    const afterMidnight = new Date('2026-09-19T00:00:00.000Z')

    expect((await service.claimDailyCheckin(ids.playerOne, beforeMidnight)).claimed).toBe(true)
    expect((await service.claimDailyCheckin(ids.playerOne, beforeMidnight)).claimed).toBe(false)
    expect((await service.claimDailyCheckin(ids.playerOne, afterMidnight)).claimed).toBe(true)
    expect((await service.progression(ids.playerOne, afterMidnight)).totalXp).toBe(20)
    expect((await service.progression(ids.playerOne, afterMidnight)).nextEligibleAt).toEqual(
      new Date('2026-09-20T00:00:00.000Z'),
    )
  })

  it('keeps Rallyo XP separate from community score events', async () => {
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 4004n,
      title: 'Separate scores community',
      slug: 'separate-scores-community',
    })
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.community,
      name: 'Season points',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-01T00:00:00.000Z'),
      status: 'ACTIVE',
    })
    await db.insert(schema.scoreEvents).values({
      playerId: ids.playerOne,
      communityId: ids.community,
      seasonId: ids.season,
      sourceType: 'QUIZ',
      delta: 40,
      reason: 'Community quiz score',
      idempotencyKey: 'community-score-1',
    })

    await service.claimDailyCheckin(ids.playerOne, now)

    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
    expect(await db.select().from(schema.rallyoXpEvents)).toHaveLength(1)
    expect((await service.progression(ids.playerOne, now)).totalXp).toBe(10)
  })

  it('orders the global league by total Rallyo XP and returns the current rank', async () => {
    await service.claimDailyCheckin(ids.playerOne, new Date('2026-09-16T12:00:00.000Z'))
    await service.claimDailyCheckin(ids.playerOne, new Date('2026-09-17T12:00:00.000Z'))
    await service.claimDailyCheckin(ids.playerTwo, new Date('2026-09-18T12:00:00.000Z'))

    const league = await service.globalLeague(ids.playerThree)

    expect(
      league.leaderboard.map((entry) => [entry.displayName, entry.totalXp, entry.rank]),
    ).toEqual([
      ['Alpha Player', 20, 1],
      ['Beta Player', 10, 2],
      ['Gamma Player', 0, 3],
    ])
    expect(league.currentPlayer).toMatchObject({
      playerId: ids.playerThree,
      displayName: 'Gamma Player',
      totalXp: 0,
      rank: 3,
      isCurrentPlayer: true,
    })
  })

  it('persists the ledger when the service is recreated', async () => {
    await service.claimDailyCheckin(ids.playerOne, now)
    const restartedService = new RallyoXpService(db)

    await expect(restartedService.progression(ids.playerOne, now)).resolves.toMatchObject({
      totalXp: 10,
      todayClaimed: true,
    })
    expect(
      await db
        .select({ id: schema.rallyoXpEvents.id })
        .from(schema.rallyoXpEvents)
        .where(eq(schema.rallyoXpEvents.playerId, ids.playerOne)),
    ).toHaveLength(1)
  })
})
