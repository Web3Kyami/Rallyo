import { Bot, type Context } from 'grammy'
import type { Update } from 'grammy/types'

export type TelegramHandlers = {
  readonly onUpdate: (updateId: number, next: () => Promise<void>) => Promise<void>
  readonly onStart: (context: Context) => Promise<void>
  readonly onHelp: (context: Context) => Promise<void>
  readonly onSettings: (context: Context) => Promise<void>
  readonly onMe: (context: Context) => Promise<void>
  readonly onLink: (context: Context) => Promise<void>
  readonly onWordSeek: (context: Context) => Promise<void>
  readonly onWordSeekAdd: (context: Context) => Promise<void>
  readonly onWordSeekWords: (context: Context) => Promise<void>
  readonly onScrambleStart: (context: Context) => Promise<void>
  readonly onScrambleStop: (context: Context) => Promise<void>
  readonly onScrambleHint: (context: Context) => Promise<void>
  readonly onMyChatMember: (context: Context) => Promise<void>
  readonly onGroupText: (context: Context) => Promise<void>
  readonly onAdminCallback: (context: Context) => Promise<void>
  readonly onPlayerCallback: (context: Context) => Promise<void>
}

export function createRallyoBot(token: string, handlers: TelegramHandlers): Bot {
  const bot = new Bot(token)

  bot.use(async (context, next) => {
    await handlers.onUpdate(context.update.update_id, next)
  })

  bot.command('start', handlers.onStart)
  bot.command('help', handlers.onHelp)
  bot.command('settings', handlers.onSettings)
  bot.command('me', handlers.onMe)
  bot.command('link', handlers.onLink)
  bot.command('wordseek', handlers.onWordSeek)
  bot.command('wordseek_add', handlers.onWordSeekAdd)
  bot.command('wordseek_words', handlers.onWordSeekWords)
  bot.command('scramble', handlers.onScrambleStart)
  bot.command('scramble_stop', handlers.onScrambleStop)
  bot.command('scramble_hint', handlers.onScrambleHint)
  bot.on('my_chat_member', handlers.onMyChatMember)
  bot.callbackQuery(/^admin:/, handlers.onAdminCallback)
  bot.callbackQuery(/^player:/, handlers.onPlayerCallback)
  bot.on('message:text', handlers.onGroupText)

  bot.catch((error) => {
    console.error('Telegram update failed', {
      updateId: error.ctx.update.update_id,
      error: error.error instanceof Error ? error.error.message : String(error.error),
    })
  })

  return bot
}

export function telegramUpdateId(update: Update): bigint {
  return BigInt(update.update_id)
}
