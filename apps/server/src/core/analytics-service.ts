import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>
type Transaction = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>

export type AnalyticsEventExecutor = Database | Transaction

export async function recordAnalyticsEvent(
  database: AnalyticsEventExecutor,
  input: {
    readonly type: string
    readonly playerId?: string
    readonly communityId?: string
    readonly roundId?: string
    readonly metadata: Record<string, unknown>
  },
): Promise<void> {
  await database.insert(schema.analyticsEvents).values({
    type: input.type,
    ...(input.playerId ? { playerId: input.playerId } : {}),
    ...(input.communityId ? { communityId: input.communityId } : {}),
    ...(input.roundId ? { roundId: input.roundId } : {}),
    metadata: input.metadata,
  })
}
