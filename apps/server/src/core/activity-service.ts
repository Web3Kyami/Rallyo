import { and, eq, sql } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

export class ActivityService {
  constructor(private readonly database: RallyoDatabase) {}

  async recordMessage(input: {
    readonly communityId: string
    readonly playerId: string
    readonly bucketStart: Date
    readonly isReply?: boolean
  }): Promise<void> {
    await this.database
      .insert(schema.communityActivityRollups)
      .values({
        communityId: input.communityId,
        playerId: input.playerId,
        bucketStart: input.bucketStart,
        messageCount: 1,
        replyCount: input.isReply ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [
          schema.communityActivityRollups.communityId,
          schema.communityActivityRollups.playerId,
          schema.communityActivityRollups.bucketStart,
        ],
        set: {
          messageCount: sql`${schema.communityActivityRollups.messageCount} + 1`,
          replyCount: input.isReply
            ? sql`${schema.communityActivityRollups.replyCount} + 1`
            : schema.communityActivityRollups.replyCount,
          updatedAt: new Date(),
        },
      })
  }

  async stats(input: { readonly communityId: string; readonly playerId?: string }) {
    return this.database
      .select()
      .from(schema.communityActivityRollups)
      .where(
        and(
          eq(schema.communityActivityRollups.communityId, input.communityId),
          ...(input.playerId ? [eq(schema.communityActivityRollups.playerId, input.playerId)] : []),
        ),
      )
      .orderBy(schema.communityActivityRollups.bucketStart)
  }

  async summary(input: { readonly communityId: string }) {
    const [row] = await this.database
      .select({
        messageCount: sql<string>`coalesce(sum(${schema.communityActivityRollups.messageCount}), 0)`,
        replyCount: sql<string>`coalesce(sum(${schema.communityActivityRollups.replyCount}), 0)`,
        activePlayers: sql<string>`count(distinct ${schema.communityActivityRollups.playerId})`,
        lastBucketAt: sql<Date | null>`max(${schema.communityActivityRollups.bucketStart})`,
      })
      .from(schema.communityActivityRollups)
      .where(eq(schema.communityActivityRollups.communityId, input.communityId))

    return {
      messageCount: Number(row?.messageCount ?? 0),
      replyCount: Number(row?.replyCount ?? 0),
      activePlayers: Number(row?.activePlayers ?? 0),
      lastBucketAt: row?.lastBucketAt ?? null,
    }
  }
}
