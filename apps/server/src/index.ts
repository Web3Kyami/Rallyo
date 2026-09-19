import { parseEnvironment } from '@rallyo/core'

import { buildServer } from './app'
import { createDatabase } from './db/client'
import { WalletLinkService } from './core/wallet-link-service'
import { createTelegramRuntime } from './telegram/runtime'

const environment = parseEnvironment(process.env)
const telegramTransport = environment.TELEGRAM_TRANSPORT ?? 'polling'
const port = Number(process.env.RALLYO_PORT ?? 3000)

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('RALLYO_PORT must be an integer between 1 and 65535.')
}

const databaseResources = environment.DATABASE_URL ? createDatabase(environment.DATABASE_URL) : null
const walletLinkService = databaseResources ? new WalletLinkService(databaseResources.db) : null
const telegramRuntime =
  databaseResources && environment.TELEGRAM_BOT_TOKEN
    ? createTelegramRuntime({
        database: databaseResources.db,
        token: environment.TELEGRAM_BOT_TOKEN,
        ...(environment.APP_BASE_URL ? { appBaseUrl: environment.APP_BASE_URL } : {}),
      })
    : null

const telegramPairingSender = telegramRuntime
  ? async (input: { readonly telegramUserId: bigint; readonly code: string }) => {
      await telegramRuntime.bot.api.sendMessage(
        input.telegramUserId.toString(),
        `<b>RALLYO PAIRING CODE</b>\n\n<code>${input.code}</code>\n\nEnter this code in Rallyo. It expires in ten minutes and can be used once.`,
        { parse_mode: 'HTML' },
      )
    }
  : undefined
let telegramBotUrlPromise: Promise<string | null> | undefined
const telegramBotUrl = telegramRuntime
  ? async () => {
      telegramBotUrlPromise ??= telegramRuntime.bot
        .init()
        .then(() => `https://t.me/${telegramRuntime.bot.botInfo.username}`)
        .catch(() => null)
      return telegramBotUrlPromise
    }
  : undefined

if (telegramRuntime && telegramTransport === 'webhook' && !environment.TELEGRAM_WEBHOOK_SECRET) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_TRANSPORT=webhook.')
}

const app = buildServer({
  ...(databaseResources ? { database: databaseResources.db } : {}),
  ...(telegramRuntime && telegramTransport === 'webhook' && environment.TELEGRAM_WEBHOOK_SECRET
    ? {
        telegramWebhook: {
          secretToken: environment.TELEGRAM_WEBHOOK_SECRET,
          handleUpdate: (update) =>
            telegramRuntime.bot.handleUpdate(
              update as Parameters<typeof telegramRuntime.bot.handleUpdate>[0],
            ),
        },
      }
    : {}),
  ...(walletLinkService
    ? {
        walletLinkService,
        ...(environment.APP_BASE_URL ? { walletLinkOrigin: environment.APP_BASE_URL } : {}),
      }
    : {}),
  ...(environment.APP_BASE_URL ? { appCorsOrigin: environment.APP_BASE_URL } : {}),
  ...(environment.OPERATOR_ACCESS_KEY
    ? { operatorAccessKey: environment.OPERATOR_ACCESS_KEY }
    : {}),
  ...(telegramPairingSender ? { telegramPairingSender } : {}),
  ...(telegramBotUrl ? { telegramBotUrl } : {}),
})

await app.listen({ host: environment.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0', port })

let pollingStarted = false
const stopClueRevealScheduler = telegramRuntime?.startClueRevealScheduler() ?? null
const stopScrambleScheduler = telegramRuntime?.startScrambleScheduler() ?? null
const stopWordSeekTimeoutScheduler = telegramRuntime?.startWordSeekTimeoutScheduler() ?? null
const stopScheduleWorker = telegramRuntime?.startScheduleWorker() ?? null
const shutdown = async () => {
  stopScheduleWorker?.()
  stopClueRevealScheduler?.()
  stopScrambleScheduler?.()
  stopWordSeekTimeoutScheduler?.()
  if (pollingStarted && telegramRuntime) {
    pollingStarted = false
    await telegramRuntime.bot.stop()
  }
  await app.close()
  if (databaseResources) await databaseResources.close()
}

process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())

if (telegramRuntime && telegramTransport === 'polling') {
  pollingStarted = true
  void telegramRuntime.bot
    .start({
      onStart: (botInfo) => {
        app.log.info({ username: botInfo.username }, 'Telegram polling started')
      },
    })
    .catch((error: unknown) => {
      app.log.error({ err: error }, 'Telegram polling stopped with an error')
      process.exitCode = 1
      void shutdown()
    })
}
