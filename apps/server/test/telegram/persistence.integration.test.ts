import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import {
  claimTelegramUpdate,
  markTelegramUpdateProcessed,
  releaseTelegramUpdate,
} from '../../src/db/telegram-updates'
import {
  findCommunityByTelegramChatId,
  listAdminCommunities,
  recordVerifiedAdmin,
  upsertCommunity,
  upsertTelegramIdentity,
} from '../../src/telegram/persistence'
import {
  clearAdminWizardSession,
  getActiveAdminWizardSession,
  saveAdminWizardSession,
} from '../../src/telegram/admin-wizard'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Telegram persistence against PostgreSQL', () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
  })

  afterAll(async () => {
    await close()
  })

  it('upserts one player identity without creating duplicate players', async () => {
    const first = await upsertTelegramIdentity(db, {
      telegramUserId: 7001n,
      username: 'first_handle',
      displayName: 'First Player',
    })
    const second = await upsertTelegramIdentity(db, {
      telegramUserId: 7001n,
      username: 'renamed_handle',
      displayName: 'Renamed Player',
    })

    expect(second).toEqual(first)
    expect(await db.select().from(schema.players)).toHaveLength(1)
    expect(await db.select().from(schema.telegramIdentities)).toMatchObject([
      { telegramUserId: 7001n, username: 'renamed_handle', displayName: 'Renamed Player' },
    ])
  })

  it('handles concurrent identity creation through the unique Telegram id', async () => {
    const identities = await Promise.all([
      upsertTelegramIdentity(db, {
        telegramUserId: 7002n,
        username: 'parallel_one',
        displayName: 'Parallel One',
      }),
      upsertTelegramIdentity(db, {
        telegramUserId: 7002n,
        username: 'parallel_two',
        displayName: 'Parallel Two',
      }),
    ])

    expect(identities[0]?.playerId).toBe(identities[1]?.playerId)
    expect(await db.select().from(schema.players)).toHaveLength(1)
    expect(await db.select().from(schema.telegramIdentities)).toHaveLength(1)
  })

  it('upserts a community by Telegram chat id and records verified admins', async () => {
    const created = await upsertCommunity(db, {
      telegramChatId: -1007003n,
      title: 'Rallyo Test Group',
    })
    const updated = await upsertCommunity(db, {
      telegramChatId: -1007003n,
      title: 'Rallyo Renamed Group',
    })

    expect(updated.id).toBe(created.id)
    expect(updated.title).toBe('Rallyo Renamed Group')
    expect(await findCommunityByTelegramChatId(db, -1007003n)).toMatchObject({ id: created.id })
    expect(await db.select().from(schema.communities)).toHaveLength(1)

    await recordVerifiedAdmin(db, {
      communityId: created.id,
      telegramUserId: 7004n,
      verifiedAt: new Date('2026-09-12T12:00:00.000Z'),
    })

    expect(await listAdminCommunities(db, 7004n)).toMatchObject([
      { id: created.id, telegramChatId: -1007003n, title: 'Rallyo Renamed Group' },
    ])
  })

  it('claims each Telegram update once and records completion', async () => {
    expect(await claimTelegramUpdate(db, 7005n)).toBe(true)
    expect(await claimTelegramUpdate(db, 7005n)).toBe(false)

    await markTelegramUpdateProcessed(db, 7005n)
    const processedUpdates = await db.select().from(schema.telegramUpdates)
    expect(processedUpdates).toHaveLength(1)
    expect(processedUpdates[0]?.telegramUpdateId).toBe(7005n)
    expect(processedUpdates[0]?.processedAt).toBeInstanceOf(Date)

    await releaseTelegramUpdate(db, 7006n)
    expect(await claimTelegramUpdate(db, 7006n)).toBe(true)
    expect(
      await db
        .select()
        .from(schema.telegramUpdates)
        .where(eq(schema.telegramUpdates.telegramUpdateId, 7006n)),
    ).toHaveLength(1)
  })

  it('does not reclaim a completed update', async () => {
    expect(await claimTelegramUpdate(db, 7007n)).toBe(true)
    await markTelegramUpdateProcessed(db, 7007n)

    expect(await claimTelegramUpdate(db, 7007n)).toBe(false)
  })

  it('reclaims an interrupted update after the processing lease expires', async () => {
    expect(await claimTelegramUpdate(db, 7008n)).toBe(true)
    await db
      .update(schema.telegramUpdates)
      .set({ processingStartedAt: new Date(Date.now() - 120_000) })
      .where(eq(schema.telegramUpdates.telegramUpdateId, 7008n))

    expect(await claimTelegramUpdate(db, 7008n)).toBe(true)
  })

  it('persists and expires admin wizard state safely across messages', async () => {
    const community = await upsertCommunity(db, {
      telegramChatId: -1007009n,
      title: 'Wizard community',
    })
    const now = new Date('2026-09-13T12:00:00.000Z')

    await saveAdminWizardSession(db, {
      telegramUserId: 7010n,
      communityId: community.id,
      state: 'QUESTION_IDS',
      data: { questionCount: 2 },
      now,
    })
    expect(await getActiveAdminWizardSession(db, 7010n, now)).toMatchObject({
      state: 'QUESTION_IDS',
      data: { questionCount: 2 },
    })
    expect(
      await getActiveAdminWizardSession(db, 7010n, new Date(now.getTime() + 16 * 60_000)),
    ).toBeNull()

    await clearAdminWizardSession(db, 7010n, community.id)
    expect(await getActiveAdminWizardSession(db, 7010n, now)).toBeNull()
  })
})
