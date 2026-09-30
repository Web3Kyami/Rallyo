import { and, eq, isNull, sql } from 'drizzle-orm'
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
  // Only reopen an update that is still unprocessed.
  //
  // Telegram redelivers an update when it does not receive a timely webhook
  // response, and `next()` can throw AFTER the work has already been done.
  // Deleting the row unconditionally turned that into a full replay: the next
  // delivery re-claimed the update and re-ran completed work, double-counting
  // activity and re-posting announcements.
  //
  // An update already marked processed stays on the row, so it is never
  // re-claimed. Genuinely failed work is left unprocessed and becomes
  // claimable again straight away.
  await database
    .delete(schema.telegramUpdates)
    .where(
      and(
        eq(schema.telegramUpdates.telegramUpdateId, telegramUpdateId),
        isNull(schema.telegramUpdates.processedAt),
      ),
    )
}
