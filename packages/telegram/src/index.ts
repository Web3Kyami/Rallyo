import { Bot, type Context } from 'grammy'
import type { Update } from 'grammy/types'



export const RALLYO_PRIVATE_COMMANDS = [
  { command: 'start', description: 'Open Rallyo and player actions' },
  { command: 'help', description: 'Show the Rallyo guide' },
  { command: 'me', description: 'Show your score and Rallyo status' },
  { command: 'pair', description: 'Get a one-time Rallyo pairing code' },
]

export const RALLYO_GROUP_COMMANDS = [
  { command: 'help', description: 'Show the Rallyo guide' },
  { command: 'me', description: 'Show your score and Rallyo status' },
  { command: 'tasks', description: 'Show active community tasks' },
  { command: 'task_submit', description: 'Submit proof for the selected task' },
  { command: 'wordseek', description: 'Start or join Word Seek' },
  { command: 'scramble', description: 'Start Scramble' },
  { command: 'scramble_hint', description: 'Reveal the next Scramble hint' },
]

export const RALLYO_ADMIN_COMMANDS = [
  ...RALLYO_GROUP_COMMANDS,
  { command: 'settings', description: 'Open community settings' },
  { command: 'wordseek_add', description: 'Add a project word for Word Seek' },
  { command: 'wordseek_words', description: 'Review Word Seek project words' },
  { command: 'task_create', description: 'Create a social task' },
  { command: 'task_review', description: 'Review social task submissions' },
  { command: 'task_expire', description: 'Archive expired social tasks' },
  { command: 'award', description: 'Award community points with a reason' },
  { command: 'scramble_stop', description: 'Stop the active Scramble round' },
]

export async function configureRallyoBotCommands(bot: Bot): Promise<void> {
  await Promise.all([
    bot.api.setMyCommands(RALLYO_PRIVATE_COMMANDS, {
      scope: { type: 'all_private_chats' },
    }),
    bot.api.setMyCommands(RALLYO_GROUP_COMMANDS, {
      scope: { type: 'all_group_chats' },
    }),
    bot.api.setMyCommands(RALLYO_ADMIN_COMMANDS, {
      scope: { type: 'all_chat_administrators' },
    }),
  ])
}

export type TelegramHandlers = {
  readonly onUpdate: (updateId: number, next: () => Promise<void>) => Promise<void>
  readonly onStart: (context: Context) => Promise<void>
  readonly onHelp: (context: Context) => Promise<void>
  readonly onSettings: (context: Context) => Promise<void>
  readonly onMe: (context: Context) => Promise<void>
  readonly onLink: (context: Context) => Promise<void>
  readonly onPair: (context: Context) => Promise<void>
  readonly onWordSeek: (context: Context) => Promise<void>
  readonly onWordSeekAdd: (context: Context) => Promise<void>
  readonly onWordSeekWords: (context: Context) => Promise<void>
  readonly onTasks: (context: Context) => Promise<void>
  readonly onTaskSubmit: (context: Context) => Promise<void>
  readonly onTaskCreate: (context: Context) => Promise<void>
  readonly onTaskReview: (context: Context) => Promise<void>
  readonly onTaskExpire: (context: Context) => Promise<void>
  readonly onManualAward: (context: Context) => Promise<void>
  readonly onScrambleStart: (context: Context) => Promise<void>
  readonly onScrambleStop: (context: Context) => Promise<void>
  readonly onScrambleHint: (context: Context) => Promise<void>
  readonly onMyChatMember: (context: Context) => Promise<void>
  readonly onGroupText: (context: Context) => Promise<void>
  readonly onProofMessage: (context: Context) => Promise<void>
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
  bot.command('pair', handlers.onPair)
  bot.command('wordseek', handlers.onWordSeek)
  bot.command('wordseek_add', handlers.onWordSeekAdd)
  bot.command('wordseek_words', handlers.onWordSeekWords)
  bot.command('tasks', handlers.onTasks)
  bot.command('task_submit', handlers.onTaskSubmit)
  bot.command('task_create', handlers.onTaskCreate)
  bot.command('task_review', handlers.onTaskReview)
  bot.command('task_expire', handlers.onTaskExpire)
  bot.command('award', handlers.onManualAward)
  bot.command('scramble', handlers.onScrambleStart)
  bot.command('scramble_stop', handlers.onScrambleStop)
  bot.command('scramble_hint', handlers.onScrambleHint)
  bot.on('my_chat_member', handlers.onMyChatMember)
  bot.callbackQuery(/^(?:admin|a):/, handlers.onAdminCallback)
  bot.callbackQuery(/^player:/, handlers.onPlayerCallback)
  bot.on(['message:photo', 'message:document'], handlers.onProofMessage)
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
