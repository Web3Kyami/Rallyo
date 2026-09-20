import { and, eq, gt, lte } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { assertCommunityAdmin } from './community-authorization'
import { awardScoreEvent } from './score-event-service'

export class ManualScoreAwardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManualScoreAwardError'
  }
}

export class ManualScoreService {
  constructor(private readonly database: RallyoDatabase) {}

  async award(input: {
    readonly communityId: string
    readonly playerId: string
    readonly points: number
    readonly reason?: string
    readonly awardedByTelegramUserId: bigint
    readonly idempotencyKey: string
    readonly now: Date
  }) {
    if (!Number.isSafeInteger(input.points) || input.points === 0) {
      throw new ManualScoreAwardError('Manual adjustments must use a non-zero safe integer.')
    }
    const reason = input.reason?.trim() || 'Admin adjustment'

    await assertCommunityAdmin(this.database, input.communityId, input.awardedByTelegramUserId)

    return this.database.transaction(async (tx) => {
      const [community] = await tx
        .select({ status: schema.communities.status })
        .from(schema.communities)
        .where(eq(schema.communities.id, input.communityId))
        .limit(1)
      if (!community || community.status !== 'ACTIVE') {
        throw new ManualScoreAwardError('Manual awards require an active community.')
      }

      const [season] = await tx
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(
          and(
            eq(schema.seasons.communityId, input.communityId),
            eq(schema.seasons.status, 'ACTIVE'),
            lte(schema.seasons.startsAt, input.now),
            gt(schema.seasons.endsAt, input.now),
          ),
        )
        .limit(1)
      if (!season)
        throw new ManualScoreAwardError('An active season is required for manual awards.')

      const [existing] = await tx
        .select()
        .from(schema.manualScoreAwards)
        .where(eq(schema.manualScoreAwards.idempotencyKey, input.idempotencyKey))
        .for('update')
        .limit(1)
      if (existing) {
        if (
          existing.communityId !== input.communityId ||
          existing.playerId !== input.playerId ||
          existing.points !== input.points
        ) {
          throw new ManualScoreAwardError(
            'Manual award idempotency key is already used differently.',
          )
        }
        const [event] = await tx
          .select()
          .from(schema.scoreEvents)
          .where(eq(schema.scoreEvents.id, existing.scoreEventId ?? ''))
          .limit(1)
        if (!event) throw new ManualScoreAwardError('Manual award is missing its score event.')
        return { award: existing, scoreEvent: event, created: false }
      }

      const [award] = await tx
        .insert(schema.manualScoreAwards)
        .values({
          communityId: input.communityId,
          seasonId: season.id,
          playerId: input.playerId,
          points: input.points,
          reason,
          awardedByTelegramUserId: input.awardedByTelegramUserId,
          idempotencyKey: input.idempotencyKey,
        })
        .returning()
      if (!award) throw new ManualScoreAwardError('Manual award could not be created.')

      const scoreEvent = await awardScoreEvent(tx, {
        playerId: input.playerId,
        communityId: input.communityId,
        seasonId: season.id,
        sourceType: 'MANUAL',
        sourceId: award.id,
        points: input.points,
        reason,
        idempotencyKey: input.idempotencyKey,
      })

      const [updatedAward] = await tx
        .update(schema.manualScoreAwards)
        .set({ scoreEventId: scoreEvent.id })
        .where(eq(schema.manualScoreAwards.id, award.id))
        .returning()
      if (!updatedAward)
        throw new ManualScoreAwardError('Manual award audit could not be completed.')

      const [event] = await tx
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.id, scoreEvent.id))
        .limit(1)
      if (!event) throw new ManualScoreAwardError('Manual score event could not be loaded.')
      return { award: updatedAward, scoreEvent: event, created: scoreEvent.created }
    })
  }
}
