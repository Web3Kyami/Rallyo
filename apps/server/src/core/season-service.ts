import { and, desc, eq, gt, lte, sql } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { assertCommunityAdmin } from './community-authorization'

export class SeasonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeasonError'
  }
}

export class SeasonService {
  constructor(private readonly database: RallyoDatabase) {}

  async activeForCommunity(communityId: string, now: Date) {
    const [season] = await this.database
      .select()
      .from(schema.seasons)
      .where(
        and(
          eq(schema.seasons.communityId, communityId),
          eq(schema.seasons.status, 'ACTIVE'),
          lte(schema.seasons.startsAt, now),
          gt(schema.seasons.endsAt, now),
        ),
      )
      .orderBy(desc(schema.seasons.startsAt))
      .limit(1)

    return season ?? null
  }

  async stats(seasonId: string) {
    const [stats] = await this.database
      .select({
        players: sql<string>`count(distinct ${schema.scoreEvents.playerId})`,
        points: sql<string>`coalesce(sum(${schema.scoreEvents.delta}), 0)`,
      })
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.seasonId, seasonId))

    return {
      players: Number(stats?.players ?? 0),
      points: Number(stats?.points ?? 0),
    }
  }

  async createAndActivate(input: {
    readonly communityId: string
    readonly name: string
    readonly startsAt: Date
    readonly endsAt: Date
    readonly winnerCount: number
    readonly actorTelegramUserId: bigint
  }) {
    const name = input.name.trim()
    if (name.length === 0 || name.length > 80) {
      throw new SeasonError('Season names must be from 1 to 80 characters.')
    }
    if (input.endsAt <= input.startsAt) {
      throw new SeasonError('The season end must be after its start.')
    }
    if (
      !Number.isSafeInteger(input.winnerCount) ||
      input.winnerCount < 1 ||
      input.winnerCount > 100
    ) {
      throw new SeasonError('Choose between 1 and 100 winners.')
    }

    await assertCommunityAdmin(this.database, input.communityId, input.actorTelegramUserId)

    return this.database.transaction(async (tx) => {
      const [community] = await tx
        .select({ id: schema.communities.id, status: schema.communities.status })
        .from(schema.communities)
        .where(eq(schema.communities.id, input.communityId))
        .for('update')
      if (!community || community.status !== 'ACTIVE') {
        throw new SeasonError('This community is not active.')
      }

      await tx
        .update(schema.seasons)
        .set({ status: 'CLOSED' })
        .where(
          and(
            eq(schema.seasons.communityId, input.communityId),
            eq(schema.seasons.status, 'ACTIVE'),
            lte(schema.seasons.endsAt, input.startsAt),
          ),
        )

      const [existing] = await tx
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(
          and(
            eq(schema.seasons.communityId, input.communityId),
            eq(schema.seasons.status, 'ACTIVE'),
            lte(schema.seasons.startsAt, input.endsAt),
            gt(schema.seasons.endsAt, input.startsAt),
          ),
        )
        .limit(1)
      if (existing) {
        throw new SeasonError('An active season already exists for this community.')
      }

      const [season] = await tx
        .insert(schema.seasons)
        .values({
          communityId: input.communityId,
          name,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: 'ACTIVE',
          winnerCount: input.winnerCount,
        })
        .returning()
      if (!season) throw new SeasonError('The season could not be started.')
      return season
    })
  }

  async end(input: {
    readonly communityId: string
    readonly seasonId: string
    readonly actorTelegramUserId: bigint
  }) {
    await assertCommunityAdmin(this.database, input.communityId, input.actorTelegramUserId)

    const [season] = await this.database
      .update(schema.seasons)
      .set({ status: 'CLOSED' })
      .where(
        and(
          eq(schema.seasons.id, input.seasonId),
          eq(schema.seasons.communityId, input.communityId),
          eq(schema.seasons.status, 'ACTIVE'),
        ),
      )
      .returning()
    if (!season) throw new SeasonError('That season is already closed or unavailable.')
    return season
  }
}
