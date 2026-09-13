import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from './schema'

type Database = NodePgDatabase<typeof schema>

export async function claimTelegramUpdate(
  database: Database,
  telegramUpdateId: bigint,
): Promise<boolean> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - 60_000)
  const insertedUpdates = await database
    .insert(schema.telegramUpdates)
    .values({ telegramUpdateId, processingStartedAt: now })
    .onConflictDoUpdate({
      target: schema.telegramUpdates.telegramUpdateId,
      set: { processingStartedAt: now },
      where: sql`${schema.telegramUpdates.processedAt} IS NULL AND ${schema.telegramUpdates.processingStartedAt} < ${staleBefore}`,
    })
    .returning({ telegramUpdateId: schema.telegramUpdates.telegramUpdateId })

  return insertedUpdates.length === 1
}

export async function markTelegramUpdateProcessed(
  database: Database,
  telegramUpdateId: bigint,
): Promise<void> {
  await database
    .update(schema.telegramUpdates)
    .set({ processedAt: new Date() })
    .where(eq(schema.telegramUpdates.telegramUpdateId, telegramUpdateId))
}

export async function releaseTelegramUpdate(
  database: Database,
  telegramUpdateId: bigint,
): Promise<void> {
  await database
    .delete(schema.telegramUpdates)
    .where(eq(schema.telegramUpdates.telegramUpdateId, telegramUpdateId))
}
