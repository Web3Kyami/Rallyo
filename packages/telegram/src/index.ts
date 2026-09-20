import { Bot, type Context } from 'grammy'
import type { Update } from 'grammy/types'

type RallyoCommandDefinition = {
  readonly command: string
  readonly description: string
  readonly helpSection: 'Play' | 'Account' | 'Admin'
  readonly privatePlayer?: boolean
  readonly community?: boolean
  readonly communityAdmin?: boolean
}

export const RALLYO_COMMAND_DEFINITIONS: readonly RallyoCommandDefinition[] = [
  {
    command: 'help',
    description: 'the Rallyo guide',
    helpSection: 'Play',
    privatePlayer: true,
    community: true,
    communityAdmin: true,
  },
  {
    command: 'me',
    description: 'your Rallyo record',
    helpSection: 'Play',
    privatePlayer: true,
    community: true,
    communityAdmin: true,
  },
  {
    command: 'leaderboard',
    description: 'community ranking',
    helpSection: 'Play',
    privatePlayer: true,
    community: true,
    communityAdmin: true,
  },
  {
    command: 'stats',
    description: 'community competition stats',
    helpSection: 'Play',
    privatePlayer: true,
    community: true,
    communityAdmin: true,
  },
  {
    command: 'tasks',
    description: 'active tasks',
    helpSection: 'Play',
    privatePlayer: true,
    community: true,
    communityAdmin: true,
  },
  {
    command: 'submit',
    description: 'submit task proof',
    helpSection: 'Play',
    privatePlayer: true,
    community: true,
    communityAdmin: true,
  },
  {
    command: 'pair',
    description: 'connect Telegram to Rallyo',
    helpSection: 'Account',
    privatePlayer: true,
  },
  {
    command: 'game',
    description: 'configure and start a game',
    helpSection: 'Admin',
    communityAdmin: true,
  },
  {
    command: 'stop',
    description: 'stop the active game',
    helpSection: 'Admin',
    communityAdmin: true,
  },
  {
    command: 'settings',
    description: 'full community controls',
    helpSection: 'Admin',
    communityAdmin: true,
  },
  {
    command: 'award',
    description: "adjust a player's points",
    helpSection: 'Admin',
    communityAdmin: true,
  },
]

function commandsFor(scope: 'privatePlayer' | 'community' | 'communityAdmin') {
  return RALLYO_COMMAND_DEFINITIONS.filter((definition) => definition[scope]).map(
    ({ command, description }) => ({ command, description }),
  )
}

export const RALLYO_PRIVATE_COMMANDS = commandsFor('privatePlayer')
export const RALLYO_GROUP_COMMANDS = commandsFor('community')
export const RALLYO_ADMIN_COMMANDS = commandsFor('communityAdmin')

export const RALLYO_HIDDEN_COMMANDS = [
  'start',
  'link',
  'task_submit',
  'task_create',
  'task_review',
  'task_expire',
  'wordseek',
  'wordseek_add',
  'wordseek_words',
  'scramble',
  'scramble_stop',
  'scramble_hint',
] as const

export function helpCommandLines(
  isAdmin = false,
  scope: 'privatePlayer' | 'community' | 'communityAdmin' = isAdmin
    ? 'communityAdmin'
    : 'privatePlayer',
): string {
  const visible = RALLYO_COMMAND_DEFINITIONS.filter((definition) => definition[scope])
  const sections = (['Play', 'Account', 'Admin'] as const)
    .map((section) => {
      const commands = visible.filter((definition) => definition.helpSection === section)
      if (commands.length === 0) return null
      return [
        `<b>${section}</b>`,
        ...commands.map((definition) => `/${definition.command} · ${definition.description}`),
      ].join('\n')
    })
    .filter((section): section is string => section !== null)

  return ['<b>ℹ️ RALLYO</b>', '', ...sections].join('\n\n')
}

export async function configureRallyoBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(RALLYO_PRIVATE_COMMANDS, {
    scope: { type: 'all_private_chats' },
  })
  await bot.api.setMyCommands(RALLYO_GROUP_COMMANDS, {
    scope: { type: 'all_group_chats' },
  })
  await bot.api.setMyCommands(RALLYO_ADMIN_COMMANDS, {
    scope: { type: 'all_chat_administrators' },
  })
}

export async function configureRallyoCommunityCommands(bot: Bot, chatId: number): Promise<void> {
  await bot.api.setMyCommands(RALLYO_GROUP_COMMANDS, {
    scope: { type: 'chat', chat_id: chatId },
  })
  await bot.api.setMyCommands(RALLYO_ADMIN_COMMANDS, {
    scope: { type: 'chat_administrators', chat_id: chatId },
  })
}

export type TelegramHandlers = {
  readonly onUpdate: (updateId: number, next: () => Promise<void>) => Promise<void>
  readonly onStart: (context: Context) => Promise<void>
  readonly onHelp: (context: Context) => Promise<void>
  readonly onSettings: (context: Context) => Promise<void>
  readonly onMe: (context: Context) => Promise<void>
  readonly onLink: (context: Context) => Promise<void>
  readonly onPair: (context: Context) => Promise<void>
  readonly onGame: (context: Context) => Promise<void>
  readonly onStop: (context: Context) => Promise<void>
  readonly onLeaderboard: (context: Context) => Promise<void>
  readonly onStats: (context: Context) => Promise<void>
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
  bot.command('game', handlers.onGame)
  bot.command('stop', handlers.onStop)
  bot.command('leaderboard', handlers.onLeaderboard)
  bot.command('stats', handlers.onStats)
  bot.command('wordseek', handlers.onWordSeek)
  bot.command('wordseek_add', handlers.onWordSeekAdd)
  bot.command('wordseek_words', handlers.onWordSeekWords)
  bot.command('tasks', handlers.onTasks)
  bot.command('submit', handlers.onTaskSubmit)
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
