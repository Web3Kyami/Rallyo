import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

export type RewardSender = (input: {
  readonly recipient: string
  readonly amountLuna: bigint
  readonly idempotencyKey: string
}) => Promise<{ readonly transactionHash: string }>

export type RewardPolicy = {
  readonly enabled?: boolean
  readonly maxPerClaimLuna: bigint
  readonly maxDailyLuna: bigint
}

export class RewardClaimError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RewardClaimError'
  }
}

export class RewardService {
  constructor(
    private readonly database: RallyoDatabase,
    private readonly send: RewardSender,
    private readonly policy: RewardPolicy = {
      maxPerClaimLuna: 100_000n,
      maxDailyLuna: 1_000_000n,
    },
  ) {}

  async summaryForCommunity(communityId: string) {
    const [row] = await this.database
      .select({
        entitlementCount: sql<string>`count(*)`,
        totalAmountLuna: sql<string>`coalesce(sum(${schema.rewardEntitlements.amountLuna}), 0)`,
        eligibleCount: sql<string>`count(*) filter (where ${schema.rewardEntitlements.status} = 'ELIGIBLE')`,
        sentCount: sql<string>`count(*) filter (where ${schema.rewardEntitlements.status} = 'SENT')`,
        confirmedCount: sql<string>`count(*) filter (where ${schema.rewardEntitlements.status} = 'CONFIRMED')`,
        failedCount: sql<string>`count(*) filter (where ${schema.rewardEntitlements.status} = 'FAILED')`,
      })
      .from(schema.rewardEntitlements)
      .innerJoin(schema.seasons, eq(schema.rewardEntitlements.seasonId, schema.seasons.id))
      .where(eq(schema.seasons.communityId, communityId))

    return {
      entitlementCount: Number(row?.entitlementCount ?? 0),
      totalAmountLuna: String(row?.totalAmountLuna ?? '0'),
      eligibleCount: Number(row?.eligibleCount ?? 0),
      sentCount: Number(row?.sentCount ?? 0),
      confirmedCount: Number(row?.confirmedCount ?? 0),
      failedCount: Number(row?.failedCount ?? 0),
    }
  }

  async finalizeSeason(input: {
    readonly seasonId: string
    readonly payouts: readonly { readonly rank: number; readonly amountLuna: bigint }[]
    readonly now?: Date
  }) {
    return this.database.transaction(async (tx) => {
      const [season] = await tx
        .select({
          id: schema.seasons.id,
          communityId: schema.seasons.communityId,
          status: schema.seasons.status,
        })
        .from(schema.seasons)
        .where(eq(schema.seasons.id, input.seasonId))
        .for('update')
      if (!season) throw new RewardClaimError('Season not found.')
      if (season.status === 'CLOSED') return []
      if (season.status !== 'ACTIVE')
        throw new RewardClaimError('Only an active season can be finalized.')
      if (input.payouts.some((payout) => payout.rank < 1 || payout.amountLuna <= 0n)) {
        throw new RewardClaimError('Payout ranks and amounts must be positive.')
      }
      if (input.payouts.some((payout) => payout.amountLuna > this.policy.maxPerClaimLuna)) {
        throw new RewardClaimError('Payout exceeds the configured per-claim cap.')
      }

      const leaderboard = await tx
        .select({
          playerId: schema.scoreEvents.playerId,
          points: sql<number>`sum(${schema.scoreEvents.delta})`,
        })
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.seasonId, input.seasonId))
        .groupBy(schema.scoreEvents.playerId)
        .orderBy(desc(sql`sum(${schema.scoreEvents.delta})`), schema.scoreEvents.playerId)
      const entitlements = []
      for (const payout of input.payouts) {
        const player = leaderboard[payout.rank - 1]
        if (!player) continue
        const [entitlement] = await tx
          .insert(schema.rewardEntitlements)
          .values({
            seasonId: input.seasonId,
            playerId: player.playerId,
            rank: payout.rank,
            amountLuna: payout.amountLuna,
            idempotencyKey: `season:${input.seasonId}:rank:${payout.rank}`,
            status: 'ELIGIBLE',
          })
          .onConflictDoNothing({ target: schema.rewardEntitlements.idempotencyKey })
          .returning()
        if (entitlement) entitlements.push(entitlement)
      }
      await tx
        .update(schema.seasons)
        .set({ status: 'CLOSED' })
        .where(eq(schema.seasons.id, input.seasonId))
      return entitlements
    })
  }

  async claim(entitlementId: string, now = new Date()) {
    const claim = await this.database.transaction(async (tx) => {
      if (this.policy.enabled === false)
        throw new RewardClaimError('Reward claims are paused by the operator.')
      const [entitlement] = await tx
        .select()
        .from(schema.rewardEntitlements)
        .where(eq(schema.rewardEntitlements.id, entitlementId))
        .for('update')
      if (!entitlement) throw new RewardClaimError('Reward entitlement not found.')
      if (entitlement.status === 'SENT' || entitlement.status === 'CONFIRMED') return entitlement
      if (entitlement.status === 'CLAIMING') return entitlement
      if (entitlement.status !== 'ELIGIBLE' && entitlement.status !== 'FAILED') {
        throw new RewardClaimError('Reward is not claimable.')
      }
      if (entitlement.amountLuna > this.policy.maxPerClaimLuna) {
        throw new RewardClaimError('Reward exceeds the configured per-claim cap.')
      }
      const dailyStart = new Date(now)
      dailyStart.setUTCHours(0, 0, 0, 0)
      const [daily] = await tx
        .select({ total: sql<bigint>`coalesce(sum(${schema.rewardEntitlements.amountLuna}), 0)` })
        .from(schema.rewardEntitlements)
        .where(
          and(
            gte(schema.rewardEntitlements.updatedAt, dailyStart),
            inArray(schema.rewardEntitlements.status, ['SENT', 'CONFIRMED']),
          ),
        )
      if (BigInt(daily?.total ?? 0) + entitlement.amountLuna > this.policy.maxDailyLuna) {
        throw new RewardClaimError('Daily reward payout cap has been reached.')
      }

      const [wallet] = await tx
        .select({ address: schema.walletIdentities.address })
        .from(schema.walletIdentities)
        .where(
          and(
            eq(schema.walletIdentities.playerId, entitlement.playerId),
            isNull(schema.walletIdentities.revokedAt),
          ),
        )
        .limit(1)
      if (!wallet) throw new RewardClaimError('Link a wallet before claiming this reward.')

      const [claiming] = await tx
        .update(schema.rewardEntitlements)
        .set({ status: 'CLAIMING', updatedAt: now })
        .where(eq(schema.rewardEntitlements.id, entitlement.id))
        .returning()
      if (!claiming) throw new RewardClaimError('Reward claim could not be started.')
      return { ...claiming, recipient: wallet.address }
    })

    if (claim.status === 'SENT' || claim.status === 'CONFIRMED') return claim
    if (!('recipient' in claim)) {
      throw new RewardClaimError('Claim is already in progress and requires reconciliation.')
    }

    try {
      const sent = await this.send({
        recipient: claim.recipient,
        amountLuna: claim.amountLuna,
        idempotencyKey: claim.idempotencyKey,
      })
      const [updated] = await this.database
        .update(schema.rewardEntitlements)
        .set({ status: 'SENT', transactionHash: sent.transactionHash, updatedAt: now })
        .where(
          and(
            eq(schema.rewardEntitlements.id, claim.id),
            inArray(schema.rewardEntitlements.status, ['CLAIMING', 'FAILED']),
          ),
        )
        .returning()
      if (!updated)
        throw new RewardClaimError('Transaction was sent but claim state could not be persisted.')
      return updated
    } catch (error) {
      await this.database
        .update(schema.rewardEntitlements)
        .set({ status: 'FAILED', updatedAt: now })
        .where(
          and(
            eq(schema.rewardEntitlements.id, claim.id),
            eq(schema.rewardEntitlements.status, 'CLAIMING'),
          ),
        )
      throw error
    }
  }

  async confirm(entitlementId: string, transactionHash: string, now = new Date()) {
    const [updated] = await this.database
      .update(schema.rewardEntitlements)
      .set({ status: 'CONFIRMED', transactionHash, updatedAt: now })
      .where(
        and(
          eq(schema.rewardEntitlements.id, entitlementId),
          eq(schema.rewardEntitlements.status, 'SENT'),
          eq(schema.rewardEntitlements.transactionHash, transactionHash),
        ),
      )
      .returning()
    if (!updated) throw new RewardClaimError('Only a matching sent transaction can be confirmed.')
    return updated
  }
}
