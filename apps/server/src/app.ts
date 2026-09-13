import Fastify from 'fastify'
import { timingSafeEqual } from 'node:crypto'

import type { WalletLinkService } from './core/wallet-link-service'

export type TelegramWebhookOptions = {
  readonly secretToken: string
  readonly handleUpdate: (update: unknown) => Promise<void>
}

export type ServerOptions = {
  readonly telegramWebhook?: TelegramWebhookOptions
  readonly walletLinkService?: WalletLinkService
  readonly walletLinkOrigin?: string
}

export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: true })
  const telegramWebhook = options.telegramWebhook
  const walletLinkService = options.walletLinkService
  const walletLinkOrigin = options.walletLinkOrigin

  app.get('/health', () => ({ status: 'ok' }))

  if (telegramWebhook) {
    app.post<{ Body: unknown }>('/telegram/webhook', async (request, reply) => {
      const receivedToken = request.headers['x-telegram-bot-api-secret-token']

      if (
        typeof receivedToken !== 'string' ||
        !secureTokenEquals(receivedToken, telegramWebhook.secretToken)
      ) {
        return reply.code(401).send({ error: 'Unauthorized webhook request.' })
      }

      await telegramWebhook.handleUpdate(request.body)
      return { ok: true }
    })
  }

  if (walletLinkService) {
    const setWalletCors = (reply: { header: (name: string, value: string) => unknown }) => {
      if (walletLinkOrigin) {
        reply.header('access-control-allow-origin', walletLinkOrigin)
        reply.header('access-control-allow-headers', 'content-type')
        reply.header('access-control-allow-methods', 'POST, OPTIONS')
      }
    }
    app.options('/api/wallet/*', async (_request, reply) => {
      setWalletCors(reply)
      return reply.code(204).send()
    })
    app.post<{ Body: { code?: string; address?: string } }>(
      '/api/wallet/challenge',
      async (request, reply) => {
        setWalletCors(reply)
        const { code, address } = request.body ?? {}
        if (typeof code !== 'string' || typeof address !== 'string') {
          return reply.code(400).send({ error: 'code and address are required.' })
        }
        try {
          return await walletLinkService.beginChallenge({ code, address })
        } catch (error) {
          return reply
            .code(400)
            .send({ error: error instanceof Error ? error.message : 'Challenge failed.' })
        }
      },
    )
    app.post<{
      Body: { challengeId?: string; message?: string; publicKey?: string; signature?: string }
    }>('/api/wallet/complete', async (request, reply) => {
      setWalletCors(reply)
      const { challengeId, message, publicKey, signature } = request.body ?? {}
      if (
        ![challengeId, message, publicKey, signature].every((value) => typeof value === 'string')
      ) {
        return reply
          .code(400)
          .send({ error: 'challengeId, message, publicKey, and signature are required.' })
      }
      try {
        return await walletLinkService.completeChallenge({
          challengeId: challengeId as string,
          message: message as string,
          publicKey: publicKey as string,
          signature: signature as string,
        })
      } catch (error) {
        return reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : 'Wallet link failed.' })
      }
    })
  }

  return app
}

function secureTokenEquals(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken)
  const expected = Buffer.from(expectedToken)

  return received.length === expected.length && timingSafeEqual(received, expected)
}
