import { afterEach, describe, expect, it } from 'vitest'

import { buildServer } from '../src/app'

describe('server health', () => {
  const app = buildServer()

  afterEach(async () => {
    await app.close()
  })

  it('reports a healthy process', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('accepts a Telegram webhook only with the configured secret', async () => {
    const updates: unknown[] = []
    const webhookApp = buildServer({
      telegramWebhook: {
        secretToken: 'phase-two-test-secret',
        handleUpdate: (update) => {
          updates.push(update)
          return Promise.resolve()
        },
      },
    })

    const unauthorized = await webhookApp.inject({
      method: 'POST',
      url: '/telegram/webhook',
      payload: { update_id: 1 },
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
    })
    const authorized = await webhookApp.inject({
      method: 'POST',
      url: '/telegram/webhook',
      payload: { update_id: 1 },
      headers: { 'x-telegram-bot-api-secret-token': 'phase-two-test-secret' },
    })

    expect(unauthorized.statusCode).toBe(401)
    expect(authorized.statusCode).toBe(200)
    expect(updates).toEqual([{ update_id: 1 }])
    await webhookApp.close()
  })

  it('exposes wallet challenge and completion routes with configured CORS', async () => {
    const calls: string[] = []
    const walletApp = buildServer({
      walletLinkOrigin: 'https://hq.example',
      walletLinkService: {
        beginChallenge: (input: { code: string; address: string }) => {
          calls.push(`begin:${input.code}:${input.address}`)
          return {
            challengeId: 'challenge-1',
            message: 'Rallyo wallet link',
            expiresAt: new Date(),
          }
        },
        completeChallenge: () => {
          calls.push('complete')
          return { address: 'NQ00' }
        },
      } as never,
    })
    const preflight = await walletApp.inject({ method: 'OPTIONS', url: '/api/wallet/challenge' })
    const challenge = await walletApp.inject({
      method: 'POST',
      url: '/api/wallet/challenge',
      payload: { code: 'ABC123', address: 'NQ00' },
    })
    expect(preflight.statusCode).toBe(204)
    expect(challenge.statusCode).toBe(200)
    expect(challenge.headers['access-control-allow-origin']).toBe('https://hq.example')
    expect(calls).toEqual(['begin:ABC123:NQ00'])
    await walletApp.close()
  })

  it('exchanges a one-time app code into an HttpOnly session cookie', async () => {
    const appSessionService = {
      exchangeCode: ({ code }: { readonly code: string }) =>
        Promise.resolve({
          token: `session-for-${code}`,
          redirectPath: '/app',
          expiresAt: new Date('2026-09-14T20:00:00.000Z'),
        }),
      getSession: () => Promise.resolve(null),
      revokeSession: () => Promise.resolve(),
    }
    const sessionApp = buildServer({ appSessionService: appSessionService as never })

    const response = await sessionApp.inject({
      method: 'POST',
      url: '/api/app/session/exchange',
      payload: { code: 'one-time-code' },
    })

    expect(response.statusCode).toBe(200)
    const exchangeBody = JSON.parse(response.body) as { readonly redirectPath: string }
    expect(exchangeBody.redirectPath).toBe('/app')
    expect(response.headers['set-cookie']).toContain('rallyo_session=session-for-one-time-code')
    expect(response.headers['set-cookie']).toContain('HttpOnly')
    expect(response.headers['set-cookie']).toContain('SameSite=Lax')
    await sessionApp.close()
  })

  it('supports credentialed cross-origin app sessions from the configured web origin', async () => {
    const sessionApp = buildServer({
      appCorsOrigin: 'https://rallyo.vercel.app',
      appSessionCookieSecure: true,
      appSessionService: {
        exchangeCode: () =>
          Promise.resolve({
            token: 'cross-origin-session',
            redirectPath: '/app',
            expiresAt: new Date('2026-09-14T20:00:00.000Z'),
          }),
        getSession: () => Promise.resolve(null),
        revokeSession: () => Promise.resolve(),
      } as never,
    })

    const preflight = await sessionApp.inject({
      method: 'OPTIONS',
      url: '/api/app/session/exchange',
      headers: { origin: 'https://rallyo.vercel.app' },
    })
    const response = await sessionApp.inject({
      method: 'POST',
      url: '/api/app/session/exchange',
      headers: { origin: 'https://rallyo.vercel.app' },
      payload: { code: 'one-time-code' },
    })
    const rejected = await sessionApp.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://not-rallyo.example' },
    })

    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('https://rallyo.vercel.app')
    expect(preflight.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-origin']).toBe('https://rallyo.vercel.app')
    expect(response.headers['set-cookie']).toContain('SameSite=None')
    expect(response.headers['set-cookie']).toContain('Secure')
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined()
    await sessionApp.close()
  })

  it('exposes wallet-first app authentication and Telegram pairing routes', async () => {
    const walletApp = buildServer({
      walletLinkOrigin: 'https://pay.example',
      appWalletAuthService: {
        beginChallenge: ({ address }: { readonly address: string }) =>
          Promise.resolve({
            challengeId: 'wallet-challenge-1',
            message: `sign:${address}`,
            expiresAt: new Date('2026-09-15T10:05:00.000Z'),
          }),
        completeChallenge: () =>
          Promise.resolve({
            playerId: 'player-wallet',
            token: 'wallet-session',
            sessionId: 'session-wallet',
            redirectPath: '/app',
            expiresAt: new Date('2026-10-15T10:00:00.000Z'),
          }),
      } as never,
    })
    const challenge = await walletApp.inject({
      method: 'POST',
      url: '/api/app/wallet/challenge',
      payload: { address: 'NQ00' },
    })
    const complete = await walletApp.inject({
      method: 'POST',
      url: '/api/app/wallet/complete',
      payload: {
        challengeId: 'wallet-challenge-1',
        message: 'sign:NQ00',
        publicKey: 'public-key',
        signature: 'signature',
      },
    })
    expect(challenge.statusCode).toBe(200)
    expect(challenge.headers['access-control-allow-origin']).toBe('https://pay.example')
    expect(complete.statusCode).toBe(200)
    expect(complete.headers['set-cookie']).toContain('rallyo_session=wallet-session')
    await walletApp.close()

    const pairApp = buildServer({
      appSessionService: {
        exchangeCode: () => Promise.reject(new Error('not used')),
        getSession: () => Promise.resolve(null),
        revokeSession: () => Promise.resolve(),
        pairTelegram: ({
          sessionToken,
          code,
        }: {
          readonly sessionToken: string
          readonly code: string
        }) => Promise.resolve({ playerId: `paired:${sessionToken}:${code}`, redirectPath: '/app' }),
      } as never,
    })
    const paired = await pairApp.inject({
      method: 'POST',
      url: '/api/app/telegram/pair',
      headers: { cookie: 'rallyo_session=wallet-session' },
      payload: { code: 'PAIR1234' },
    })
    expect(paired.statusCode).toBe(200)
    expect(paired.json()).toEqual({
      playerId: 'paired:wallet-session:PAIR1234',
      redirectPath: '/app',
    })
    await pairApp.close()
  })

  it('keeps app bootstrap behind the server session boundary', async () => {
    const appSessionService = {
      getSession: (token: string | undefined) =>
        Promise.resolve(
          token === 'valid-session'
            ? {
                sessionId: 'session-1',
                playerId: 'player-1',
                telegramIdentityId: 'identity-1',
                telegramUserId: 123n,
                targetCommunityId: null,
                targetMode: 'player' as const,
                expiresAt: new Date('2026-09-14T20:00:00.000Z'),
              }
            : null,
        ),
      revokeSession: () => Promise.resolve(),
      exchangeCode: () => Promise.reject(new Error('not used')),
    }
    const appApiService = {
      bootstrap: () => Promise.resolve({ player: { id: 'player-1' } }),
    }
    const sessionApp = buildServer({
      appSessionService: appSessionService as never,
      appApiService: appApiService as never,
    })

    const anonymous = await sessionApp.inject({ method: 'GET', url: '/api/app/me' })
    const authenticated = await sessionApp.inject({
      method: 'GET',
      url: '/api/app/me',
      headers: { cookie: 'rallyo_session=valid-session' },
    })

    expect(anonymous.statusCode).toBe(401)
    const anonymousBody = JSON.parse(anonymous.body) as {
      readonly error: { readonly code: string }
    }
    expect(anonymousBody.error.code).toBe('UNAUTHENTICATED')
    expect(authenticated.statusCode).toBe(200)
    expect(authenticated.json()).toEqual({ player: { id: 'player-1' } })
    await sessionApp.close()
  })

  it('keeps Rallyo progression and league routes behind the app session boundary', async () => {
    const actor = {
      sessionId: 'session-progression',
      playerId: 'player-progression',
      telegramIdentityId: null,
      telegramUserId: null,
      targetCommunityId: null,
      targetMode: 'player' as const,
      expiresAt: new Date('2026-09-18T20:00:00.000Z'),
    }
    const sessionApp = buildServer({
      appSessionService: {
        getSession: (token: string | undefined) =>
          Promise.resolve(token === 'progression-session' ? actor : null),
        revokeSession: () => Promise.resolve(),
        exchangeCode: () => Promise.reject(new Error('not used')),
      } as never,
      appApiService: {
        progression: () => Promise.resolve({ totalXp: 0 }),
        claimDailyCheckin: () => Promise.resolve({ claimed: true, xpAwarded: 10 }),
        globalLeague: () => Promise.resolve({ leaderboard: [], currentPlayer: {} }),
      } as never,
    })

    const urls = [
      ['/api/app/progression', 'GET'],
      ['/api/app/progression/daily-checkin', 'POST'],
      ['/api/app/league', 'GET'],
    ] as const
    for (const [url, method] of urls) {
      const anonymous = await sessionApp.inject({ method, url })
      expect(anonymous.statusCode).toBe(401)
    }

    const authenticated = await sessionApp.inject({
      method: 'GET',
      url: '/api/app/progression',
      headers: { cookie: 'rallyo_session=progression-session' },
    })
    expect(authenticated.statusCode).toBe(200)
    expect(authenticated.json()).toEqual({ totalXp: 0 })
    await sessionApp.close()
  })

  it('routes community admin game changes through the authenticated session', async () => {
    const calls: unknown[] = []
    const app = buildServer({
      appSessionService: {
        getSession: (token: string | undefined) =>
          Promise.resolve(
            token === 'admin-session'
              ? {
                  sessionId: 'session-admin',
                  playerId: 'player-admin',
                  telegramIdentityId: 'identity-admin',
                  telegramUserId: 7001n,
                  targetCommunityId: 'community-one',
                  targetMode: 'admin' as const,
                  expiresAt: new Date('2026-10-15T10:00:00.000Z'),
                }
              : null,
          ),
        revokeSession: () => Promise.resolve(),
        exchangeCode: () => Promise.reject(new Error('not used')),
      } as never,
      appApiService: {
        adminSetGameCapability: (_actor: unknown, communityId: string, input: unknown) => {
          calls.push({ communityId, input })
          return Promise.resolve({ gameKey: 'word_seek', enabled: true })
        },
      } as never,
    })

    const anonymous = await app.inject({
      method: 'PATCH',
      url: '/api/app/admin/communities/community-one/games/word_seek',
      payload: { enabled: true, config: { source: 'PROJECT' } },
    })
    const authenticated = await app.inject({
      method: 'PATCH',
      url: '/api/app/admin/communities/community-one/games/word_seek',
      headers: { cookie: 'rallyo_session=admin-session' },
      payload: { enabled: true, config: { source: 'PROJECT' } },
    })

    expect(anonymous.statusCode).toBe(401)
    expect(authenticated.statusCode).toBe(200)
    expect(authenticated.json()).toEqual({
      capability: { gameKey: 'word_seek', enabled: true },
    })
    expect(calls).toEqual([
      {
        communityId: 'community-one',
        input: { gameKey: 'word_seek', enabled: true, config: { source: 'PROJECT' } },
      },
    ])
    await app.close()
  })
})

describe('Operator routes', () => {
  afterEach(async () => {
    await app?.close()
  })

  let app: ReturnType<typeof buildServer> | null = null

  it('keeps Operator access separate from normal app sessions and rejects bad keys', async () => {
    const authenticatedActor = {
      sessionId: 'operator-session-1',
      expiresAt: new Date('2026-09-15T20:00:00.000Z'),
    }
    const auth = {
      configured: true,
      authenticate: ({ accessKey }: { readonly accessKey: string }) =>
        Promise.resolve(
          accessKey === 'correct-key' ? { token: 'operator-token', ...authenticatedActor } : null,
        ),
      getSession: (token: string | undefined) =>
        Promise.resolve(token === 'operator-token' ? authenticatedActor : null),
      revokeSession: () => Promise.resolve(),
    }
    const consoleService = {
      bootstrap: () => Promise.resolve({ generatedAt: new Date(), overview: { source: 'test' } }),
      overview: () => Promise.resolve({ source: 'test' }),
      listCommunities: () => Promise.resolve([]),
      community: () => Promise.resolve({}),
      searchPlayers: () => Promise.resolve([]),
      player: () => Promise.resolve({}),
    }
    app = buildServer({
      operatorSessionService: auth as never,
      operatorConsoleService: consoleService as never,
      appSessionService: {
        getSession: (token: string | undefined) =>
          Promise.resolve(
            token === 'player-token'
              ? {
                  sessionId: 'player-session',
                  playerId: 'player-1',
                  telegramIdentityId: null,
                  telegramUserId: null,
                  targetCommunityId: null,
                  targetMode: 'player' as const,
                  expiresAt: new Date('2026-09-15T20:00:00.000Z'),
                }
              : null,
          ),
        revokeSession: () => Promise.resolve(),
        exchangeCode: () => Promise.reject(new Error('not used')),
      } as never,
      appApiService: { bootstrap: () => Promise.resolve({ player: { id: 'player-1' } }) } as never,
    })

    const anonymous = await app.inject({ method: 'GET', url: '/api/operator/me' })
    const playerSession = await app.inject({
      method: 'GET',
      url: '/api/operator/me',
      headers: { cookie: 'rallyo_session=player-token' },
    })
    const wrongKey = await app.inject({
      method: 'POST',
      url: '/api/operator/session',
      payload: { accessKey: 'wrong-key' },
    })
    const login = await app.inject({
      method: 'POST',
      url: '/api/operator/session',
      payload: { accessKey: 'correct-key' },
    })
    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/operator/me',
      headers: { cookie: 'rallyo_operator_session=operator-token' },
    })

    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json()).toMatchObject({ error: { code: 'OPERATOR_UNAUTHENTICATED' } })
    expect(playerSession.statusCode).toBe(401)
    expect(wrongKey.statusCode).toBe(401)
    expect(login.statusCode).toBe(200)
    expect(login.headers['set-cookie']).toContain('rallyo_operator_session=operator-token')
    expect(login.headers['set-cookie']).toContain('SameSite=Strict')
    expect(authenticated.statusCode).toBe(200)
    await app.close()
    app = null
  })

  it('does not expose a sign-in path when the Operator key is not configured', async () => {
    const auth = {
      configured: false,
      authenticate: () => Promise.resolve(null),
      getSession: () => Promise.resolve(null),
      revokeSession: () => Promise.resolve(),
    }
    app = buildServer({
      operatorSessionService: auth as never,
      operatorConsoleService: { bootstrap: () => Promise.resolve({}) } as never,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/operator/session',
      payload: { accessKey: 'anything' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: 'OPERATOR_UNAVAILABLE' } })
    await app.close()
    app = null
  })
})
