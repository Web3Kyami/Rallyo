import { and, eq, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>
type Transaction = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>
type ScoreEventExecutor = Database | Transaction

export type ScoreSourceType = (typeof schema.scoreSourceType.enumValues)[number]

export type ScoreEventAwardInput = {
  readonly playerId: string
  readonly communityId: string
  readonly seasonId: string
  readonly sourceType: ScoreSourceType
  readonly sourceId?: string
  readonly roundId?: string
  readonly questionId?: string
  readonly points: number
  readonly reason: string
  readonly idempotencyKey: string
}

export type ScoreEventAwardResult = {
  readonly id: string
  readonly created: boolean
}

export class ScoreEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoreEventError'
  }
}

export class ScoreEventService {
  constructor(private readonly database: Database) {}

  award(input: ScoreEventAwardInput) {
    return awardScoreEvent(this.database, input)
  }

  awardInTransaction(transaction: Transaction, input: ScoreEventAwardInput) {
    return awardScoreEvent(transaction, input)
  }
}

export async function awardScoreEvent(
  database: ScoreEventExecutor,
  input: ScoreEventAwardInput,
): Promise<ScoreEventAwardResult> {
  const validPoints = input.sourceType === 'MANUAL' ? input.points !== 0 : input.points > 0
  if (!Number.isSafeInteger(input.points) || !validPoints) {
    throw new ScoreEventError(
      input.sourceType === 'MANUAL'
        ? 'Manual score adjustments must use a non-zero safe integer.'
        : 'Score awards must use a positive safe integer.',
    )
  }

  const values = {
    playerId: input.playerId,
    communityId: input.communityId,
    seasonId: input.seasonId,
    sourceType: input.sourceType,
    delta: input.points,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(input.roundId ? { roundId: input.roundId } : {}),
    ...(input.questionId ? { questionId: input.questionId } : {}),
  }

  const inserted = await database
    .insert(schema.scoreEvents)
    .values(values)
    .onConflictDoNothing({ target: schema.scoreEvents.idempotencyKey })
    .returning({ id: schema.scoreEvents.id })

  if (inserted[0]) {
    return { id: inserted[0].id, created: true }
  }

  const existing = await database
    .select({
      id: schema.scoreEvents.id,
      playerId: schema.scoreEvents.playerId,
      communityId: schema.scoreEvents.communityId,
      seasonId: schema.scoreEvents.seasonId,
      sourceType: schema.scoreEvents.sourceType,
      sourceId: schema.scoreEvents.sourceId,
      delta: schema.scoreEvents.delta,
    })
    .from(schema.scoreEvents)
    .where(
      and(
        eq(schema.scoreEvents.idempotencyKey, input.idempotencyKey),
        eq(schema.scoreEvents.playerId, input.playerId),
        eq(schema.scoreEvents.communityId, input.communityId),
        eq(schema.scoreEvents.seasonId, input.seasonId),
      ),
    )
    .limit(1)

  const event = existing[0]
  if (
    !event ||
    event.sourceType !== input.sourceType ||
    event.sourceId !== (input.sourceId ?? null) ||
    event.delta !== input.points
  ) {
    throw new ScoreEventError('Score idempotency key is already used for a different award.')
  }

  return { id: event.id, created: false }
}
