import Fastify from 'fastify'
import { timingSafeEqual } from 'node:crypto'

import type { RallyoDatabase } from './db/client'
import {
  AppApiForbiddenError,
  AppApiNotFoundError,
  AppApiService,
  AppApiValidationError,
} from './core/app-api-service'
import { AppWalletAuthError, AppWalletAuthService } from './core/app-wallet-auth-service'
import { AppSessionError, AppSessionService } from './core/app-session-service'
import type { WalletLinkService } from './core/wallet-link-service'
import {
  OperatorActionError,
  OperatorConsoleNotFoundError,
  OperatorConsoleService,
} from './core/operator-console-service'
import { OperatorSessionError, OperatorSessionService } from './core/operator-session-service'

export type TelegramWebhookOptions = {
  readonly secretToken: string
  readonly handleUpdate: (update: unknown) => Promise<void>
}

export type ServerOptions = {
  readonly telegramWebhook?: TelegramWebhookOptions
  readonly walletLinkService?: WalletLinkService
  readonly walletLinkOrigin?: string
  readonly appCorsOrigin?: string
  readonly database?: RallyoDatabase
  readonly appSessionService?: AppSessionService
  readonly appApiService?: AppApiService
  readonly appWalletAuthService?: AppWalletAuthService
  readonly operatorAccessKey?: string
  readonly operatorSessionService?: OperatorSessionService
  readonly operatorConsoleService?: OperatorConsoleService
  readonly appSessionCookieSecure?: boolean
  readonly telegramPairingSender?: (input: {
    readonly telegramUserId: bigint
    readonly code: string
  }) => Promise<void>
  readonly telegramBotUrl?: () => Promise<string | null>
}

export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: true })
  const telegramWebhook = options.telegramWebhook
  const walletLinkService = options.walletLinkService
  const walletLinkOrigin = options.walletLinkOrigin
  const appCorsOrigin = options.appCorsOrigin
  const appSessionService =
    options.appSessionService ?? (options.database ? new AppSessionService(options.database) : null)
  const appApiService =
    options.appApiService ?? (options.database ? new AppApiService(options.database) : null)
  const appWalletAuthService =
    options.appWalletAuthService ??
    (options.database ? new AppWalletAuthService(options.database) : null)
  const operatorSessionService =
    options.operatorSessionService ??
    (options.database
      ? new OperatorSessionService(
          options.database,
          options.operatorAccessKey ?? process.env.OPERATOR_ACCESS_KEY,
        )
      : null)
  const operatorConsoleService =
    options.operatorConsoleService ??
    (options.database ? new OperatorConsoleService(options.database) : null)
  const secureSessionCookie =
    options.appSessionCookieSecure ?? process.env.NODE_ENV === 'production'
  const telegramPairingAttempts = new Map<
    string,
    { readonly startedAt: number; readonly count: number }
  >()
  const crossOriginSessionCookies = options.appCorsOrigin !== undefined

  if (appCorsOrigin) {
    app.addHook('onSend', async (request, reply) => {
      const requestOrigin = request.headers.origin
      if (requestOrigin && requestOrigin !== appCorsOrigin) return
      reply.header('access-control-allow-origin', appCorsOrigin)
      reply.header('access-control-allow-credentials', 'true')
      reply.header('access-control-allow-headers', 'content-type')
      reply.header('access-control-allow-methods', 'GET, HEAD, POST, PATCH, OPTIONS')
      reply.header('vary', 'Origin')
    })
    app.options('/api/*', async (_request, reply) => reply.code(204).send())
  }

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
      Body: {
        challengeId?: string
        message?: string
        publicKey?: string
        signature?: string
        format?: string
      }
    }>('/api/wallet/complete', async (request, reply) => {
      setWalletCors(reply)
      const { challengeId, message, publicKey, signature, format } = request.body ?? {}
      if (
        ![challengeId, message, publicKey, signature].every((value) => typeof value === 'string')
      ) {
        return reply
          .code(400)
          .send({ error: 'challengeId, message, publicKey, and signature are required.' })
      }
      if (format !== undefined && format !== 'mini-app' && format !== 'hub') {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'Unsupported wallet signature format.')
      }
      try {
        return await walletLinkService.completeChallenge({
          challengeId: challengeId as string,
          message: message as string,
          publicKey: publicKey as string,
          signature: signature as string,
          ...(format === undefined ? {} : { format }),
        })
      } catch (error) {
        return reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : 'Wallet link failed.' })
      }
    })
  }

  if (appSessionService) {
    app.post<{ Body: { code?: string } }>('/api/app/session/exchange', async (request, reply) => {
      const code = request.body?.code
      if (typeof code !== 'string' || code.length === 0) {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'A session code is required.')
      }
      try {
        const exchanged = await appSessionService.exchangeCode({ code })
        reply.header(
          'set-cookie',
          sessionCookie(exchanged.token, secureSessionCookie, crossOriginSessionCookies),
        )
        return {
          ok: true,
          redirectPath: exchanged.redirectPath,
          expiresAt: exchanged.expiresAt,
        }
      } catch (error) {
        return sendSessionError(reply, error)
      }
    })

    app.post('/api/app/session/logout', async (request, reply) => {
      await appSessionService.revokeSession(readSessionCookie(request.headers.cookie))
      reply.header('set-cookie', clearSessionCookie(secureSessionCookie, crossOriginSessionCookies))
      return { ok: true }
    })

    app.post<{ Body: { code?: string } }>('/api/app/telegram/pair', async (request, reply) => {
      const sessionToken = readSessionCookie(request.headers.cookie)
      const code = request.body?.code
      if (!sessionToken || typeof code !== 'string' || code.length === 0) {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'A Telegram pairing code is required.')
      }
      try {
        return await appSessionService.pairTelegram({ sessionToken, code })
      } catch (error) {
        if (error instanceof AppSessionError) {
          return sendApiError(reply, 400, 'TELEGRAM_PAIRING_FAILED', error.message)
        }
        return sendApiError(
          reply,
          500,
          'TELEGRAM_PAIRING_ERROR',
          'Telegram pairing could not be completed.',
        )
      }
    })

    app.post<{ Body: { username?: string } }>(
      '/api/app/telegram/request-pairing',
      async (request, reply) => {
        const username = request.body?.username
        if (typeof username !== 'string' || username.trim().length === 0) {
          return sendApiError(reply, 400, 'INVALID_REQUEST', 'A Telegram username is required.')
        }
        const rateLimitKey = `${request.ip}:${username.trim().toLocaleLowerCase('en-US')}`
        if (isTelegramPairingRateLimited(telegramPairingAttempts, rateLimitKey)) {
          return sendApiError(
            reply,
            429,
            'TELEGRAM_PAIRING_RATE_LIMITED',
            'Try again in a few minutes.',
          )
        }
        try {
          await appSessionService.requestTelegramPairing({
            username,
            ...(options.telegramPairingSender ? { send: options.telegramPairingSender } : {}),
          })
          return {
            ok: true,
            botUrl: (await options.telegramBotUrl?.()) ?? null,
          }
        } catch (error) {
          if (error instanceof AppSessionError) {
            return sendApiError(reply, 400, 'TELEGRAM_PAIRING_FAILED', error.message)
          }
          return sendApiError(
            reply,
            500,
            'TELEGRAM_PAIRING_ERROR',
            'Telegram pairing could not be started.',
          )
        }
      },
    )

    app.post<{ Body: { code?: string } }>('/api/app/telegram/exchange', async (request, reply) => {
      const code = request.body?.code
      if (typeof code !== 'string' || code.trim().length === 0) {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'A Telegram pairing code is required.')
      }
      try {
        const exchanged = await appSessionService.exchangeTelegramPairingCode({
          code: code.trim(),
        })
        reply.header(
          'set-cookie',
          sessionCookie(exchanged.token, secureSessionCookie, crossOriginSessionCookies),
        )
        return {
          ok: true,
          redirectPath: exchanged.redirectPath,
          expiresAt: exchanged.expiresAt,
        }
      } catch (error) {
        if (error instanceof AppSessionError) {
          return sendApiError(reply, 400, 'TELEGRAM_PAIRING_FAILED', error.message)
        }
        return sendApiError(
          reply,
          500,
          'TELEGRAM_PAIRING_ERROR',
          'Telegram pairing could not be completed.',
        )
      }
    })
  }

  if (appWalletAuthService) {
    const setWalletCors = (reply: { header: (name: string, value: string) => unknown }) => {
      if (walletLinkOrigin) {
        reply.header('access-control-allow-origin', walletLinkOrigin)
        reply.header('access-control-allow-credentials', 'true')
        reply.header('access-control-allow-headers', 'content-type')
        reply.header('access-control-allow-methods', 'POST, OPTIONS')
        reply.header('vary', 'Origin')
      }
    }
    app.options('/api/app/wallet/*', async (_request, reply) => {
      setWalletCors(reply)
      return reply.code(204).send()
    })
    app.post<{ Body: { address?: string } }>(
      '/api/app/wallet/challenge',
      async (request, reply) => {
        setWalletCors(reply)
        const address = request.body?.address
        request.log.info(
          {
            route: '/api/app/wallet/challenge',
            origin: request.headers.origin ?? null,
            contentType: request.headers['content-type'] ?? null,
            hasAddress: typeof address === 'string' && address.length > 0,
          },
          'wallet challenge request received',
        )
        if (typeof address !== 'string' || address.length === 0) {
          request.log.warn(
            { route: '/api/app/wallet/challenge', reason: 'missing-address' },
            'wallet challenge request rejected',
          )
          return sendApiError(reply, 400, 'INVALID_REQUEST', 'A Nimiq address is required.')
        }
        try {
          return await appWalletAuthService.beginChallenge({ address })
        } catch (error) {
          if (error instanceof AppWalletAuthError) {
            request.log.warn(
              { route: '/api/app/wallet/challenge', reason: error.message },
              'wallet challenge rejected',
            )
            return sendApiError(reply, 400, 'WALLET_AUTH_FAILED', error.message)
          }
          request.log.error(
            { err: error, route: '/api/app/wallet/challenge' },
            'wallet challenge server failure',
          )
          return sendApiError(reply, 500, 'WALLET_AUTH_ERROR', 'Wallet sign-in could not start.')
        }
      },
    )
    app.post<{
      Body: {
        challengeId?: string
        message?: string
        publicKey?: string
        signature?: string
        format?: string
      }
    }>('/api/app/wallet/complete', async (request, reply) => {
      setWalletCors(reply)
      const { challengeId, message, publicKey, signature, format } = request.body ?? {}
      request.log.info(
        {
          route: '/api/app/wallet/complete',
          origin: request.headers.origin ?? null,
          contentType: request.headers['content-type'] ?? null,
          format: format ?? 'default',
          hasChallengeId: typeof challengeId === 'string' && challengeId.length > 0,
          messageLength: typeof message === 'string' ? message.length : 0,
          publicKeyLength: typeof publicKey === 'string' ? publicKey.length : 0,
          signatureLength: typeof signature === 'string' ? signature.length : 0,
        },
        'wallet completion request received',
      )
      if (
        ![challengeId, message, publicKey, signature].every((value) => typeof value === 'string')
      ) {
        request.log.warn(
          { route: '/api/app/wallet/complete', reason: 'missing-fields' },
          'wallet completion request rejected',
        )
        return sendApiError(
          reply,
          400,
          'INVALID_REQUEST',
          'challengeId, message, publicKey, and signature are required.',
        )
      }
      if (format !== undefined && format !== 'mini-app' && format !== 'hub') {
        request.log.warn(
          { route: '/api/app/wallet/complete', reason: 'unsupported-format' },
          'wallet completion request rejected',
        )
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'Unsupported wallet signature format.')
      }
      try {
        const completed = await appWalletAuthService.completeChallenge({
          challengeId: challengeId as string,
          message: message as string,
          publicKey: publicKey as string,
          signature: signature as string,
          ...(format === undefined ? {} : { format }),
        })
        reply.header(
          'set-cookie',
          sessionCookie(completed.token, secureSessionCookie, crossOriginSessionCookies),
        )
        return {
          ok: true,
          redirectPath: completed.redirectPath,
          expiresAt: completed.expiresAt,
        }
      } catch (error) {
        if (error instanceof AppWalletAuthError) {
          request.log.warn(
            { route: '/api/app/wallet/complete', reason: error.message },
            'wallet completion rejected',
          )
          return sendApiError(reply, 400, 'WALLET_AUTH_FAILED', error.message)
        }
        request.log.error(
          { err: error, route: '/api/app/wallet/complete' },
          'wallet completion server failure',
        )
        return sendApiError(
          reply,
          500,
          'WALLET_AUTH_ERROR',
          'Wallet sign-in could not be completed.',
        )
      }
    })
  }

  if (appSessionService && appApiService) {
    app.get('/api/app/me', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return await appApiService.bootstrap(actor)
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get('/api/app/progression', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return await appApiService.progression(actor)
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.post('/api/app/progression/daily-checkin', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return await appApiService.claimDailyCheckin(actor)
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get('/api/app/league', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return await appApiService.globalLeague(actor)
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get('/api/app/communities', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return { communities: await appApiService.listCommunities(actor) }
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get<{ Params: { communityId: string } }>(
      '/api/app/communities/:communityId',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return await appApiService.community(actor, request.params.communityId)
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.get<{ Params: { communityId: string } }>(
      '/api/app/communities/:communityId/leaderboard',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return { leaderboard: await appApiService.leaderboard(actor, request.params.communityId) }
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.get<{ Querystring: { communityId?: string } }>('/api/app/tasks', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return { tasks: await appApiService.tasks(actor, request.query.communityId) }
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get<{ Params: { taskId: string } }>('/api/app/tasks/:taskId', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return await appApiService.task(actor, request.params.taskId)
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get('/api/app/rewards', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return await appApiService.rewards(actor)
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get('/api/app/admin/communities', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        return { communities: await appApiService.adminCommunities(actor) }
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get<{ Params: { communityId: string } }>(
      '/api/app/admin/communities/:communityId',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return await appApiService.adminOverview(actor, request.params.communityId)
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.patch<{
      Params: { communityId: string; gameKey: string }
      Body: { gameKey?: unknown; enabled?: unknown; config?: unknown }
    }>('/api/app/admin/communities/:communityId/games/:gameKey', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        if (typeof request.params.gameKey !== 'string') {
          return sendApiError(reply, 400, 'INVALID_REQUEST', 'A game key is required.')
        }
        return {
          capability: await appApiService.adminSetGameCapability(
            actor,
            request.params.communityId,
            {
              gameKey: request.params.gameKey,
              enabled: request.body?.enabled as boolean,
              ...(request.body?.config === undefined ? {} : { config: request.body.config }),
            },
          ),
        }
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.get<{ Params: { communityId: string } }>(
      '/api/app/admin/communities/:communityId/tasks',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return await appApiService.adminTasks(actor, request.params.communityId)
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.post<{
      Params: { communityId: string }
      Body: {
        title?: unknown
        instructions?: unknown
        points?: unknown
        startsAt?: unknown
        endsAt?: unknown
        maxSubmissionsPerPlayer?: unknown
        cooldownDays?: unknown
      }
    }>('/api/app/admin/communities/:communityId/tasks', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        const body = request.body ?? {}
        return {
          task: await appApiService.adminCreateTask(actor, request.params.communityId, {
            title: readAdminString(body.title, 'Task title'),
            instructions: readAdminString(body.instructions, 'Task instructions'),
            points: readAdminSafeInteger(body.points, 'Task points'),
            startsAt: readAdminDate(body.startsAt, 'Task start'),
            endsAt: readAdminDate(body.endsAt, 'Task end'),
            ...(body.maxSubmissionsPerPlayer === undefined
              ? {}
              : {
                  maxSubmissionsPerPlayer: readAdminSafeInteger(
                    body.maxSubmissionsPerPlayer,
                    'Submission cap',
                  ),
                }),
            ...(body.cooldownDays === undefined
              ? {}
              : { cooldownDays: readAdminSafeInteger(body.cooldownDays, 'Cooldown days') }),
          }),
        }
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.post<{ Params: { communityId: string } }>(
      '/api/app/admin/communities/:communityId/tasks/archive-expired',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return await appApiService.adminArchiveExpiredTasks(actor, request.params.communityId)
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.post<{ Params: { communityId: string; submissionId: string } }>(
      '/api/app/admin/communities/:communityId/tasks/submissions/:submissionId/approve',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return {
            result: await appApiService.adminApproveSubmission(
              actor,
              request.params.communityId,
              request.params.submissionId,
            ),
          }
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.post<{
      Params: { communityId: string; submissionId: string }
      Body: { reason?: unknown }
    }>(
      '/api/app/admin/communities/:communityId/tasks/submissions/:submissionId/reject',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          const reason = request.body?.reason
          if (reason !== undefined && typeof reason !== 'string') {
            return sendApiError(reply, 400, 'INVALID_REQUEST', 'Rejection reason must be text.')
          }
          return {
            result: await appApiService.adminRejectSubmission(
              actor,
              request.params.communityId,
              request.params.submissionId,
              reason,
            ),
          }
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.get<{ Params: { communityId: string } }>(
      '/api/app/admin/communities/:communityId/content',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return await appApiService.adminContent(actor, request.params.communityId)
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.post<{
      Params: { communityId: string }
      Body: {
        sourceTitle?: unknown
        sourceText?: unknown
        prompt?: unknown
        correctAnswer?: unknown
        category?: unknown
        difficulty?: unknown
      }
    }>(
      '/api/app/admin/communities/:communityId/content/questions/drafts',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          const body = request.body ?? {}
          const difficulty = body.difficulty
          if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') {
            return sendApiError(reply, 400, 'INVALID_REQUEST', 'Question difficulty is invalid.')
          }
          return {
            question: await appApiService.adminCreateQuestionDraft(
              actor,
              request.params.communityId,
              {
                sourceTitle: readAdminString(body.sourceTitle, 'Source title'),
                sourceText: readAdminString(body.sourceText, 'Source text'),
                prompt: readAdminString(body.prompt, 'Question prompt'),
                correctAnswer: readAdminString(body.correctAnswer, 'Correct answer'),
                category: readAdminString(body.category, 'Question category'),
                difficulty,
              },
            ),
          }
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.post<{ Params: { communityId: string; questionId: string } }>(
      '/api/app/admin/communities/:communityId/content/questions/:questionId/approve',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return {
            question: await appApiService.adminApproveQuestion(
              actor,
              request.params.communityId,
              request.params.questionId,
            ),
          }
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )

    app.post<{
      Params: { communityId: string }
      Body: { word?: unknown; clue?: unknown; sourceRef?: unknown }
    }>('/api/app/admin/communities/:communityId/content/words/drafts', async (request, reply) => {
      const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
      if (!actor) return
      try {
        const body = request.body ?? {}
        if (body.clue !== undefined && typeof body.clue !== 'string') {
          return sendApiError(reply, 400, 'INVALID_REQUEST', 'Word clue must be text.')
        }
        if (body.sourceRef !== undefined && typeof body.sourceRef !== 'string') {
          return sendApiError(reply, 400, 'INVALID_REQUEST', 'Word source reference must be text.')
        }
        return {
          word: await appApiService.adminCreateWordDraft(actor, request.params.communityId, {
            word: readAdminString(body.word, 'Project word'),
            ...(body.clue === undefined ? {} : { clue: body.clue }),
            ...(body.sourceRef === undefined ? {} : { sourceRef: body.sourceRef }),
          }),
        }
      } catch (error) {
        return sendAppApiError(reply, error)
      }
    })

    app.post<{ Params: { communityId: string; wordId: string } }>(
      '/api/app/admin/communities/:communityId/content/words/:wordId/approve',
      async (request, reply) => {
        const actor = await requireAppSession(request.headers.cookie, appSessionService, reply)
        if (!actor) return
        try {
          return {
            word: await appApiService.adminApproveWord(
              actor,
              request.params.communityId,
              request.params.wordId,
            ),
          }
        } catch (error) {
          return sendAppApiError(reply, error)
        }
      },
    )
  }

  if (operatorSessionService && operatorConsoleService) {
    app.post<{ Body: { accessKey?: string } }>('/api/operator/session', async (request, reply) => {
      if (!operatorSessionService.configured) {
        return sendApiError(
          reply,
          503,
          'OPERATOR_UNAVAILABLE',
          'Operator access is not configured on this server.',
        )
      }
      const accessKey = request.body?.accessKey
      if (typeof accessKey !== 'string' || accessKey.length === 0) {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'An Operator access key is required.')
      }
      try {
        const issued = await operatorSessionService.authenticate({ accessKey })
        if (!issued) {
          return sendApiError(reply, 401, 'OPERATOR_AUTH_FAILED', 'Operator access was denied.')
        }
        reply.header(
          'set-cookie',
          operatorSessionCookie(issued.token, secureSessionCookie, crossOriginSessionCookies),
        )
        return { ok: true, expiresAt: issued.expiresAt }
      } catch (error) {
        if (error instanceof OperatorSessionError) {
          return sendApiError(reply, 500, 'OPERATOR_SESSION_ERROR', error.message)
        }
        return sendApiError(
          reply,
          500,
          'OPERATOR_SESSION_ERROR',
          'Operator sign-in could not start.',
        )
      }
    })

    app.post('/api/operator/session/logout', async (request, reply) => {
      await operatorSessionService.revokeSession(
        readCookie(request.headers.cookie, 'rallyo_operator_session'),
      )
      reply.header(
        'set-cookie',
        clearOperatorSessionCookie(secureSessionCookie, crossOriginSessionCookies),
      )
      return { ok: true }
    })

    app.get('/api/operator/me', async (request, reply) => {
      const actor = await requireOperatorSession(
        request.headers.cookie,
        operatorSessionService,
        reply,
      )
      if (!actor) return
      try {
        return { session: actor, ...(await operatorConsoleService.bootstrap()) }
      } catch (error) {
        return sendOperatorError(reply, error)
      }
    })

    app.get('/api/operator/overview', async (request, reply) => {
      const actor = await requireOperatorSession(
        request.headers.cookie,
        operatorSessionService,
        reply,
      )
      if (!actor) return
      try {
        return await operatorConsoleService.overview()
      } catch (error) {
        return sendOperatorError(reply, error)
      }
    })

    app.get<{ Querystring: { query?: string } }>(
      '/api/operator/communities',
      async (request, reply) => {
        const actor = await requireOperatorSession(
          request.headers.cookie,
          operatorSessionService,
          reply,
        )
        if (!actor) return
        try {
          return { communities: await operatorConsoleService.listCommunities(request.query.query) }
        } catch (error) {
          return sendOperatorError(reply, error)
        }
      },
    )

    app.get<{ Params: { communityId: string } }>(
      '/api/operator/communities/:communityId',
      async (request, reply) => {
        const actor = await requireOperatorSession(
          request.headers.cookie,
          operatorSessionService,
          reply,
        )
        if (!actor) return
        try {
          return await operatorConsoleService.community(request.params.communityId)
        } catch (error) {
          return sendOperatorError(reply, error)
        }
      },
    )

    app.get<{ Querystring: { query?: string } }>(
      '/api/operator/players',
      async (request, reply) => {
        const actor = await requireOperatorSession(
          request.headers.cookie,
          operatorSessionService,
          reply,
        )
        if (!actor) return
        try {
          return { players: await operatorConsoleService.searchPlayers(request.query.query) }
        } catch (error) {
          return sendOperatorError(reply, error)
        }
      },
    )

    app.get<{ Params: { playerId: string } }>(
      '/api/operator/players/:playerId',
      async (request, reply) => {
        const actor = await requireOperatorSession(
          request.headers.cookie,
          operatorSessionService,
          reply,
        )
        if (!actor) return
        try {
          return await operatorConsoleService.player(request.params.playerId)
        } catch (error) {
          return sendOperatorError(reply, error)
        }
      },
    )

    app.post<{
      Params: { playerId: string }
      Body: { walletIdentityId?: string }
    }>('/api/operator/players/:playerId/wallet/revoke', async (request, reply) => {
      const actor = await requireOperatorSession(
        request.headers.cookie,
        operatorSessionService,
        reply,
      )
      if (!actor) return
      if (typeof request.body?.walletIdentityId !== 'string') {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'A wallet identity is required.')
      }
      try {
        return await operatorConsoleService.revokeWallet({
          playerId: request.params.playerId,
          walletIdentityId: request.body.walletIdentityId,
          operatorSessionId: actor.sessionId,
        })
      } catch (error) {
        return sendOperatorError(reply, error)
      }
    })

    app.post<{ Params: { playerId: string } }>(
      '/api/operator/players/:playerId/telegram/revoke-pairing',
      async (request, reply) => {
        const actor = await requireOperatorSession(
          request.headers.cookie,
          operatorSessionService,
          reply,
        )
        if (!actor) return
        try {
          return await operatorConsoleService.revokePairingCodes({
            playerId: request.params.playerId,
            operatorSessionId: actor.sessionId,
          })
        } catch (error) {
          return sendOperatorError(reply, error)
        }
      },
    )

    app.post<{ Params: { playerId: string } }>(
      '/api/operator/players/:playerId/telegram/prepare-recovery',
      async (request, reply) => {
        const actor = await requireOperatorSession(
          request.headers.cookie,
          operatorSessionService,
          reply,
        )
        if (!actor) return
        try {
          return await operatorConsoleService.prepareTelegramRecovery({
            playerId: request.params.playerId,
            operatorSessionId: actor.sessionId,
          })
        } catch (error) {
          return sendOperatorError(reply, error)
        }
      },
    )
  }

  return app
}

async function requireAppSession(
  cookieHeader: string | undefined,
  service: AppSessionService,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
) {
  const session = await service.getSession(readSessionCookie(cookieHeader))
  if (!session) {
    sendApiError(reply, 401, 'UNAUTHENTICATED', 'Open Rallyo from Telegram to continue.')
    return null
  }
  return session
}

async function requireOperatorSession(
  cookieHeader: string | undefined,
  service: OperatorSessionService,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
) {
  if (!service.configured) {
    sendApiError(reply, 503, 'OPERATOR_UNAVAILABLE', 'Operator access is not configured.')
    return null
  }
  try {
    const session = await service.getSession(readCookie(cookieHeader, 'rallyo_operator_session'))
    if (!session) {
      sendApiError(reply, 401, 'OPERATOR_UNAUTHENTICATED', 'Operator sign-in is required.')
      return null
    }
    return session
  } catch {
    sendApiError(reply, 500, 'OPERATOR_SESSION_ERROR', 'Operator session could not be checked.')
    return null
  }
}

function sendSessionError(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof AppSessionError) {
    return sendApiError(reply, 401, 'SESSION_CODE_INVALID', error.message)
  }
  return sendApiError(reply, 500, 'SESSION_ERROR', 'The Rallyo session could not be created.')
}

function sendAppApiError(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof AppApiForbiddenError) {
    return sendApiError(reply, 403, 'FORBIDDEN', error.message)
  }
  if (error instanceof AppApiNotFoundError) {
    return sendApiError(reply, 404, 'NOT_FOUND', error.message)
  }
  if (error instanceof AppApiValidationError) {
    return sendApiError(reply, 400, 'INVALID_REQUEST', error.message)
  }
  return sendApiError(reply, 500, 'APP_API_ERROR', 'Rallyo could not load this state.')
}

function readAdminString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppApiValidationError(`${label} is required.`)
  }
  return value
}

function readAdminSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new AppApiValidationError(`${label} must be a safe integer.`)
  }
  return value
}

function readAdminDate(value: unknown, label: string): Date {
  if (typeof value !== 'string') throw new AppApiValidationError(`${label} must be an ISO date.`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new AppApiValidationError(`${label} must be an ISO date.`)
  return new Date(timestamp)
}

function sendOperatorError(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof OperatorConsoleNotFoundError) {
    return sendApiError(reply, 404, 'NOT_FOUND', error.message)
  }
  if (error instanceof OperatorActionError) {
    return sendApiError(reply, 400, 'OPERATOR_ACTION_FAILED', error.message)
  }
  return sendApiError(
    reply,
    500,
    'OPERATOR_API_ERROR',
    'The Operator console could not load this state.',
  )
}

function sendApiError(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({ error: { code, message } })
}

function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, 'rallyo_session')
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(`${name}=`.length)
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function isTelegramPairingRateLimited(
  attempts: Map<string, { readonly startedAt: number; readonly count: number }>,
  key: string,
  now = Date.now(),
): boolean {
  const windowMs = 10 * 60_000
  const maxAttempts = 5
  const current = attempts.get(key)
  if (!current || now - current.startedAt >= windowMs) {
    attempts.set(key, { startedAt: now, count: 1 })
    return false
  }
  if (current.count >= maxAttempts) return true
  attempts.set(key, { ...current, count: current.count + 1 })
  return false
}

function sessionCookie(token: string, secure: boolean, crossOrigin: boolean): string {
  return [
    `rallyo_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${secure && crossOrigin ? 'None' : 'Lax'}`,
    'Max-Age=2592000',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

function clearSessionCookie(secure: boolean, crossOrigin: boolean): string {
  return [
    'rallyo_session=',
    'Path=/',
    'HttpOnly',
    `SameSite=${secure && crossOrigin ? 'None' : 'Lax'}`,
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

function operatorSessionCookie(token: string, secure: boolean, crossOrigin: boolean): string {
  return [
    `rallyo_operator_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${secure && crossOrigin ? 'None' : 'Strict'}`,
    'Max-Age=43200',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

function clearOperatorSessionCookie(secure: boolean, crossOrigin: boolean): string {
  return [
    'rallyo_operator_session=',
    'Path=/',
    'HttpOnly',
    `SameSite=${secure && crossOrigin ? 'None' : 'Strict'}`,
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

function secureTokenEquals(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken)
  const expected = Buffer.from(expectedToken)

  return received.length === expected.length && timingSafeEqual(received, expected)
}
