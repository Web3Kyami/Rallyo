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

export type TelegramWebhookOptions = {
  readonly secretToken: string
  readonly handleUpdate: (update: unknown) => Promise<void>
}

export type ServerOptions = {
  readonly telegramWebhook?: TelegramWebhookOptions
  readonly walletLinkService?: WalletLinkService
  readonly walletLinkOrigin?: string
  readonly database?: RallyoDatabase
  readonly appSessionService?: AppSessionService
  readonly appApiService?: AppApiService
  readonly appWalletAuthService?: AppWalletAuthService
  readonly appSessionCookieSecure?: boolean
}

export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: true })
  const telegramWebhook = options.telegramWebhook
  const walletLinkService = options.walletLinkService
  const walletLinkOrigin = options.walletLinkOrigin
  const appSessionService =
    options.appSessionService ?? (options.database ? new AppSessionService(options.database) : null)
  const appApiService =
    options.appApiService ?? (options.database ? new AppApiService(options.database) : null)
  const appWalletAuthService =
    options.appWalletAuthService ??
    (options.database ? new AppWalletAuthService(options.database) : null)
  const secureSessionCookie =
    options.appSessionCookieSecure ?? process.env.NODE_ENV === 'production'

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

  if (appSessionService) {
    app.post<{ Body: { code?: string } }>('/api/app/session/exchange', async (request, reply) => {
      const code = request.body?.code
      if (typeof code !== 'string' || code.length === 0) {
        return sendApiError(reply, 400, 'INVALID_REQUEST', 'A session code is required.')
      }
      try {
        const exchanged = await appSessionService.exchangeCode({ code })
        reply.header('set-cookie', sessionCookie(exchanged.token, secureSessionCookie))
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
      reply.header('set-cookie', clearSessionCookie(secureSessionCookie))
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
  }

  if (appWalletAuthService) {
    const setWalletCors = (reply: { header: (name: string, value: string) => unknown }) => {
      if (walletLinkOrigin) {
        reply.header('access-control-allow-origin', walletLinkOrigin)
        reply.header('access-control-allow-headers', 'content-type')
        reply.header('access-control-allow-methods', 'POST, OPTIONS')
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
        if (typeof address !== 'string' || address.length === 0) {
          return sendApiError(reply, 400, 'INVALID_REQUEST', 'A Nimiq address is required.')
        }
        try {
          return await appWalletAuthService.beginChallenge({ address })
        } catch (error) {
          if (error instanceof AppWalletAuthError) {
            return sendApiError(reply, 400, 'WALLET_AUTH_FAILED', error.message)
          }
          return sendApiError(reply, 500, 'WALLET_AUTH_ERROR', 'Wallet sign-in could not start.')
        }
      },
    )
    app.post<{
      Body: { challengeId?: string; message?: string; publicKey?: string; signature?: string }
    }>('/api/app/wallet/complete', async (request, reply) => {
      setWalletCors(reply)
      const { challengeId, message, publicKey, signature } = request.body ?? {}
      if (
        ![challengeId, message, publicKey, signature].every((value) => typeof value === 'string')
      ) {
        return sendApiError(
          reply,
          400,
          'INVALID_REQUEST',
          'challengeId, message, publicKey, and signature are required.',
        )
      }
      try {
        const completed = await appWalletAuthService.completeChallenge({
          challengeId: challengeId as string,
          message: message as string,
          publicKey: publicKey as string,
          signature: signature as string,
        })
        reply.header('set-cookie', sessionCookie(completed.token, secureSessionCookie))
        return {
          ok: true,
          redirectPath: completed.redirectPath,
          expiresAt: completed.expiresAt,
        }
      } catch (error) {
        if (error instanceof AppWalletAuthError) {
          return sendApiError(reply, 400, 'WALLET_AUTH_FAILED', error.message)
        }
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

function sendApiError(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({ error: { code, message } })
}

function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('rallyo_session='))
    ?.slice('rallyo_session='.length)
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function sessionCookie(token: string, secure: boolean): string {
  return [
    `rallyo_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=2592000',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

function clearSessionCookie(secure: boolean): string {
  return [
    'rallyo_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

function secureTokenEquals(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken)
  const expected = Buffer.from(expectedToken)

  return received.length === expected.length && timingSafeEqual(received, expected)
}
