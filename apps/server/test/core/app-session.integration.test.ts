import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { AppSessionError, AppSessionService } from '../../src/core/app-session-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('AppSessionService against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const service = new AppSessionService(db)
  const ids = {
    player: '30000000-0000-4000-8000-000000000001',
    identity: '30000000-0000-4000-8000-000000000002',
    community: '30000000-0000-4000-8000-000000000003',
  } as const
  const now = new Date('2026-09-14T18:00:00.000Z')

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values({ id: ids.player })
    await db.insert(schema.telegramIdentities).values({
      id: ids.identity,
      playerId: ids.player,
      telegramUserId: 987654n,
      displayName: 'Session tester',
    })
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: -100987654n,
      title: 'Session community',
      slug: 'session-community',
    })
  })

  afterAll(async () => close())

  it('exchanges a code once, preserves target context, and revokes the session', async () => {
    await db.insert(schema.communityAdmins).values({
      communityId: ids.community,
      telegramUserId: 987654n,
      verifiedAt: now,
      lastVerifiedAt: now,
    })
    const issued = await service.issueCode({
      telegramIdentityId: ids.identity,
      targetMode: 'admin',
      targetCommunityId: ids.community,
      now,
    })
    const exchanged = await service.exchangeCode({ code: issued.code, now })

    expect(exchanged.redirectPath).toBe(`/app/admin/${ids.community}`)
    expect(
      await service.getSession(exchanged.token, new Date(now.getTime() + 1_000)),
    ).toMatchObject({
      playerId: ids.player,
      telegramIdentityId: ids.identity,
      telegramUserId: 987654n,
      targetCommunityId: ids.community,
      targetMode: 'admin',
    })
    await expect(service.exchangeCode({ code: issued.code, now })).rejects.toBeInstanceOf(
      AppSessionError,
    )

    await service.revokeSession(exchanged.token, new Date(now.getTime() + 2_000))
    expect(await service.getSession(exchanged.token, new Date(now.getTime() + 3_000))).toBeNull()
  })

  it('restores a valid persistent session and rejects it after expiry or logout', async () => {
    const issued = await service.createSession({
      playerId: ids.player,
      telegramIdentityId: ids.identity,
      now,
    })

    expect(
      await service.getSession(issued.token, new Date(now.getTime() + 29 * 24 * 60 * 60_000)),
    ).toMatchObject({ playerId: ids.player, telegramIdentityId: ids.identity })
    expect(
      await service.getSession(issued.token, new Date(now.getTime() + 30 * 24 * 60 * 60_000)),
    ).toBeNull()

    const logoutIssued = await service.createSession({
      playerId: ids.player,
      telegramIdentityId: ids.identity,
      now,
    })
    await service.revokeSession(logoutIssued.token, new Date(now.getTime() + 1_000))
    expect(await service.getSession(logoutIssued.token, new Date(now.getTime() + 2_000))).toBeNull()
  })

  it('rejects an expired code and an unverified admin target', async () => {
    const issued = await service.issueCode({ telegramIdentityId: ids.identity, now })
    await expect(
      service.exchangeCode({ code: issued.code, now: new Date(now.getTime() + 5 * 60_000 + 1) }),
    ).rejects.toBeInstanceOf(AppSessionError)

    await expect(
      service.issueCode({
        telegramIdentityId: ids.identity,
        targetMode: 'admin',
        targetCommunityId: ids.community,
        now,
      }),
    ).rejects.toBeInstanceOf(AppSessionError)
  })

  it('exchanges a Telegram pairing code into a session once', async () => {
    const issued = await service.issueTelegramPairingCode({
      telegramIdentityId: ids.identity,
      now,
    })
    const exchanged = await service.exchangeTelegramPairingCode({ code: issued.code, now })

    expect(exchanged.redirectPath).toBe('/app')
    expect(await service.getSession(exchanged.token, now)).toMatchObject({
      playerId: ids.player,
      telegramIdentityId: ids.identity,
      telegramUserId: 987654n,
    })
    await expect(service.exchangeTelegramPairingCode({ code: issued.code, now })).rejects.toThrow(
      'invalid or expired',
    )

    const expired = await service.issueTelegramPairingCode({
      telegramIdentityId: ids.identity,
      now,
    })
    await expect(
      service.exchangeTelegramPairingCode({
        code: expired.code,
        now: new Date(now.getTime() + 10 * 60_000 + 1),
      }),
    ).rejects.toThrow('invalid or expired')
  })

  it('replaces active Telegram pairing codes atomically, including concurrent requests', async () => {
    const first = await service.issueTelegramPairingCode({
      telegramIdentityId: ids.identity,
      now,
    })
    const replacement = await service.issueTelegramPairingCode({
      telegramIdentityId: ids.identity,
      now: new Date(now.getTime() + 1_000),
    })

    const rowsAfterReplacement = await db
      .select({
        id: schema.telegramPairingCodes.id,
        consumedAt: schema.telegramPairingCodes.consumedAt,
      })
      .from(schema.telegramPairingCodes)
    expect(rowsAfterReplacement.find((row) => row.id === first.id)?.consumedAt).not.toBeNull()
    expect(rowsAfterReplacement.find((row) => row.id === replacement.id)?.consumedAt).toBeNull()

    await Promise.all([
      service.issueTelegramPairingCode({
        telegramIdentityId: ids.identity,
        now: new Date(now.getTime() + 2_000),
      }),
      service.issueTelegramPairingCode({
        telegramIdentityId: ids.identity,
        now: new Date(now.getTime() + 3_000),
      }),
    ])

    const active = await db
      .select({ id: schema.telegramPairingCodes.id })
      .from(schema.telegramPairingCodes)
      .where(
        and(
          eq(schema.telegramPairingCodes.telegramIdentityId, ids.identity),
          isNull(schema.telegramPairingCodes.consumedAt),
          gt(schema.telegramPairingCodes.expiresAt, new Date(now.getTime() + 3_000)),
        ),
      )
    expect(active).toHaveLength(1)
  })
})
