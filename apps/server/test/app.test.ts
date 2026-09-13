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
})
