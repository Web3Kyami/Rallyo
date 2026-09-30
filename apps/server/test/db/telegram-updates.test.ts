import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { sql } from 'drizzle-orm'

import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import {
  claimTelegramUpdate,
  markTelegramUpdateProcessed,
  releaseTelegramUpdate,
} from '../../src/db/telegram-updates'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

// A Telegram update can be redelivered. `releaseTelegramUpdate` used to delete
// the row unconditionally, so a handler that finished its work and then threw
// on a later step had its row deleted. The next delivery re-claimed the update
// and re-ran work that had already succeeded -- double-counting activity and
// re-posting announcements.
//
// Releasing must only reopen an update that THIS run still owns and that has
// not been marked processed. An update another handler finished stays closed.
describeDatabase('telegram update claim and release', () => {
  if (!databaseUrl) {
    return
  }

  const { db, close } = createDatabase(databaseUrl)

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE telegram_updates CASCADE`)
  })

  afterAll(async () => {
    await close()
  })

  it('refuses a second claim while the first is still processing', async () => {
    expect(await claimTelegramUpdate(db, 9001n)).toBe(true)
    expect(await claimTelegramUpdate(db, 9001n)).toBe(false)
  })

  it('allows a redelivery after a release, so failed work is retried', async () => {
    expect(await claimTelegramUpdate(db, 9002n)).toBe(true)
    await releaseTelegramUpdate(db, 9002n)
    expect(await claimTelegramUpdate(db, 9002n)).toBe(true)
  })

  it('does NOT reopen an update that was already marked processed', async () => {
    // The real failure: work completes, a later step throws, the handler
    // releases the claim, and the finished work runs a second time.
    expect(await claimTelegramUpdate(db, 9003n)).toBe(true)
    await markTelegramUpdateProcessed(db, 9003n)

    await releaseTelegramUpdate(db, 9003n)

    const rows = await db.select().from(schema.telegramUpdates)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.processedAt).not.toBeNull()

    // And the update must not be claimable again.
    expect(await claimTelegramUpdate(db, 9003n)).toBe(false)
  })

  it('reclaims an update whose handler died without releasing', async () => {
    expect(await claimTelegramUpdate(db, 9004n)).toBe(true)

    // Age the lease past 60s to simulate a handler that never came back.
    await db.execute(
      sql`UPDATE telegram_updates
          SET processing_started_at = now() - interval '120 seconds'
          WHERE telegram_update_id = 9004`,
    )

    expect(await claimTelegramUpdate(db, 9004n)).toBe(true)
  })
})
