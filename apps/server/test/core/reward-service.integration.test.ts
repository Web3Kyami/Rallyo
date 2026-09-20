import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'

import { RewardClaimError, RewardService } from '../../src/core/reward-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('RewardService against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const ids = {
    community: '30000000-0000-4000-8000-000000000001',
    season: '30000000-0000-4000-8000-000000000002',
    player: '30000000-0000-4000-8000-000000000003',
    wallet: '30000000-0000-4000-8000-000000000004',
    entitlement: '30000000-0000-4000-8000-000000000005',
    question: '30000000-0000-4000-8000-000000000006',
    round: '30000000-0000-4000-8000-000000000007',
  } as const
  const now = new Date('2026-09-13T12:00:00.000Z')

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values({ id: ids.player })
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 303n,
      title: 'Rewards test',
      slug: 'rewards-test',
    })
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.community,
      name: 'Reward season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.walletIdentities).values({
      id: ids.wallet,
      playerId: ids.player,
      address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      publicKey: '00'.repeat(32),
    })
    await db.insert(schema.questions).values({
      id: ids.question,
      scope: 'COMMUNITY',
      communityId: ids.community,
      source: 'MANUAL',
      mode: 'QUICK',
      category: 'test',
      difficulty: 'easy',
      prompt: 'What is the test answer?',
      correctAnswer: 'test',
      acceptedAnswers: ['test'],
      basePoints: 20,
      fingerprint: 'reward-test-question',
      status: 'APPROVED',
    })
    await db.insert(schema.rounds).values({
      id: ids.round,
      communityId: ids.community,
      seasonId: ids.season,
      questionId: ids.question,
      state: 'SCORED',
      startsAt: new Date(now.getTime() - 60_000),
      locksAt: new Date(now.getTime() - 30_000),
    })
    await db.insert(schema.scoreEvents).values({
      playerId: ids.player,
      communityId: ids.community,
      seasonId: ids.season,
      roundId: ids.round,
      questionId: ids.question,
      delta: 20,
      reason: 'test',
      idempotencyKey: 'reward-score-test',
    })
    await db.insert(schema.rewardEntitlements).values({
      id: ids.entitlement,
      seasonId: ids.season,
      playerId: ids.player,
      rank: 1,
      amountLuna: 1_000n,
      idempotencyKey: 'reward-test-1',
      status: 'ELIGIBLE',
    })
  })

  afterAll(async () => close())

  it('persists SENT, transaction hash, and CONFIRMED exactly once', async () => {
    const calls: string[] = []
    const service = new RewardService(db, (input) => {
      calls.push(input.idempotencyKey)
      return Promise.resolve({ transactionHash: 'tx-test-1' })
    })
    const sent = await service.claim(ids.entitlement, now)
    expect(sent.status).toBe('SENT')
    expect(sent.transactionHash).toBe('tx-test-1')
    expect(calls).toEqual(['reward-test-1'])
    const confirmed = await service.confirm(ids.entitlement, 'tx-test-1', now)
    expect(confirmed.status).toBe('CONFIRMED')
    await expect(service.confirm(ids.entitlement, 'tx-test-1', now)).rejects.toBeInstanceOf(
      RewardClaimError,
    )
  })

  it('finalizes an active season into deterministic rank entitlements and is idempotent', async () => {
    const service = new RewardService(db, () => Promise.resolve({ transactionHash: 'unused' }))
    await db
      .delete(schema.rewardEntitlements)
      .where(eq(schema.rewardEntitlements.id, ids.entitlement))
    const first = await service.finalizeSeason({
      seasonId: ids.season,
      payouts: [{ rank: 1, amountLuna: 500n }],
      now,
    })
    expect(first).toHaveLength(1)
    expect(first[0]?.rank).toBe(1)
    expect(first[0]?.playerId).toBe(ids.player)
    expect(
      await service.finalizeSeason({
        seasonId: ids.season,
        payouts: [{ rank: 1, amountLuna: 500n }],
        now,
      }),
    ).toEqual([])
    expect((await db.select().from(schema.seasons))[0]?.status).toBe('CLOSED')
  })

  it('marks a failed sender for safe retry and never claims before wallet connection', async () => {
    const service = new RewardService(db, () => {
      return Promise.reject(new Error('sender unavailable'))
    })
    await expect(service.claim(ids.entitlement, now)).rejects.toThrow('sender unavailable')
    expect((await db.select().from(schema.rewardEntitlements))[0]?.status).toBe('FAILED')
    await db.delete(schema.walletIdentities).where(eq(schema.walletIdentities.id, ids.wallet))
    await expect(service.claim(ids.entitlement, now)).rejects.toThrow('Link a wallet')
    expect(
      (
        await db
          .select()
          .from(schema.rewardEntitlements)
          .where(and(eq(schema.rewardEntitlements.id, ids.entitlement)))
      )[0]?.status,
    ).toBe('FAILED')
  })

  it('blocks an eligible reward before payout execution when no active wallet exists', async () => {
    await db.delete(schema.walletIdentities).where(eq(schema.walletIdentities.id, ids.wallet))
    const calls: string[] = []
    const service = new RewardService(db, (input) => {
      calls.push(input.idempotencyKey)
      return Promise.resolve({ transactionHash: 'must-not-send' })
    })

    await expect(service.claim(ids.entitlement, now)).rejects.toThrow(
      'Link a wallet before claiming this reward.',
    )
    expect(calls).toEqual([])
    expect((await db.select().from(schema.rewardEntitlements))[0]?.status).toBe('ELIGIBLE')
  })
})
