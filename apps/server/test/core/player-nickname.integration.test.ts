import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { AppApiService } from '../../src/core/app-api-service'
import { AppSessionService } from '../../src/core/app-session-service'
import { mergeWalletPlayerIntoTelegramPlayer } from '../../src/core/identity-merge-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import { buildServer } from '../../src/app'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('persistent Player nickname against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const appApi = new AppApiService(db)
  const now = new Date('2026-09-23T10:00:00.000Z')
  const telegramPlayerId = '70000000-0000-4000-8000-000000000001'
  const walletPlayerId = '70000000-0000-4000-8000-000000000002'
  const telegramIdentityId = '70000000-0000-4000-8000-000000000003'
  const actor = (playerId: string, identityId: string | null = null) => ({
    sessionId: '70000000-0000-4000-8000-000000000004',
    playerId,
    telegramIdentityId: identityId,
    telegramUserId: identityId ? 7001n : null,
    targetCommunityId: null,
    targetMode: 'player' as const,
    expiresAt: new Date(now.getTime() + 60_000),
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values([{ id: telegramPlayerId }, { id: walletPlayerId }])
  })
  afterAll(async () => close())

  it('persists a wallet-only nickname and returns it on a new bootstrap', async () => {
    await expect(appApi.updateNickname(actor(walletPlayerId), '  Kyami  ')).resolves.toEqual({
      nickname: 'Kyami',
    })
    expect((await appApi.globalLeague(actor(walletPlayerId))).currentPlayer.displayName).toBe(
      'Kyami',
    )
    const bootstrap = await appApi.bootstrap(actor(walletPlayerId), now)
    expect(bootstrap.player).toMatchObject({
      id: walletPlayerId,
      displayName: 'Kyami',
      nickname: 'Kyami',
    })
    await expect(appApi.updateNickname(actor(walletPlayerId), '<script>')).rejects.toThrow()
  })

  it('persists and bootstraps a nickname through the authenticated HTTP routes', async () => {
    const appSessions = new AppSessionService(db)
    const issued = await appSessions.createSession({ playerId: walletPlayerId, now })
    const server = buildServer({ database: db, appSessionCookieSecure: false })
    try {
      const patch = await server.inject({
        method: 'PATCH',
        url: '/api/app/me/nickname',
        headers: { cookie: `rallyo_session=${issued.token}` },
        payload: { nickname: 'Francis' },
      })
      expect(patch.statusCode).toBe(200)
      expect(patch.json()).toEqual({ nickname: 'Francis' })

      const [persisted] = await db
        .select({ nickname: schema.players.nickname })
        .from(schema.players)
        .where(eq(schema.players.id, walletPlayerId))
      expect(persisted?.nickname).toBe('Francis')

      const bootstrap = await server.inject({
        method: 'GET',
        url: '/api/app/me',
        headers: { cookie: `rallyo_session=${issued.token}` },
      })
      expect(bootstrap.statusCode).toBe(200)
      const bootstrapBody: {
        readonly player: {
          readonly id: string
          readonly displayName: string
          readonly nickname: string
        }
      } = bootstrap.json()
      expect(bootstrapBody.player).toMatchObject({
        id: walletPlayerId,
        displayName: 'Francis',
        nickname: 'Francis',
      })

      const invalid = await server.inject({
        method: 'PATCH',
        url: '/api/app/me/nickname',
        headers: { cookie: `rallyo_session=${issued.token}` },
        payload: { nickname: '<Francis>' },
      })
      expect(invalid.statusCode).toBe(400)
      const invalidBody: { readonly error: { readonly code: string } } = invalid.json()
      expect(invalidBody.error.code).toBe('INVALID_REQUEST')

      const anonymous = await server.inject({
        method: 'PATCH',
        url: '/api/app/me/nickname',
        payload: { nickname: 'Francis' },
      })
      expect(anonymous.statusCode).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('keeps Telegram-linked nickname updates on the canonical Player', async () => {
    await db.insert(schema.telegramIdentities).values({
      id: telegramIdentityId,
      playerId: telegramPlayerId,
      telegramUserId: 7001n,
      displayName: 'Telegram Kyami',
    })
    const appSessions = new AppSessionService(db)
    const issued = await appSessions.createSession({
      playerId: telegramPlayerId,
      telegramIdentityId,
      now,
    })
    const server = buildServer({ database: db, appSessionCookieSecure: false })
    try {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/app/me/nickname',
        headers: { cookie: `rallyo_session=${issued.token}` },
        payload: { nickname: 'Francis' },
      })
      expect(response.statusCode).toBe(200)
      const bootstrap = await server.inject({
        method: 'GET',
        url: '/api/app/me',
        headers: { cookie: `rallyo_session=${issued.token}` },
      })
      const bootstrapBody: {
        readonly player: {
          readonly displayName: string
          readonly nickname: string
          readonly username: string | null
        }
      } = bootstrap.json()
      expect(bootstrapBody.player).toMatchObject({
        displayName: 'Telegram Kyami',
        nickname: 'Francis',
        username: null,
      })
    } finally {
      await server.close()
    }
  })

  it('preserves wallet nickname on safe Telegram pairing while preferring Telegram display name', async () => {
    await appApi.updateNickname(actor(walletPlayerId), 'Wallet Kyami')
    await db.insert(schema.telegramIdentities).values({
      id: telegramIdentityId,
      playerId: telegramPlayerId,
      telegramUserId: 7001n,
      displayName: 'Telegram Kyami',
    })
    await db.transaction((tx) =>
      mergeWalletPlayerIntoTelegramPlayer(tx, {
        telegramPlayerId,
        walletPlayerId,
        now,
      }),
    )
    const [player] = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.id, telegramPlayerId))
    expect(player?.nickname).toBe('Wallet Kyami')
    expect(
      await db.select().from(schema.players).where(eq(schema.players.id, walletPlayerId)),
    ).toEqual([])
    const bootstrap = await appApi.bootstrap(actor(telegramPlayerId, telegramIdentityId), now)
    expect(bootstrap.player).toMatchObject({
      nickname: 'Wallet Kyami',
      displayName: 'Telegram Kyami',
    })
  })
})
