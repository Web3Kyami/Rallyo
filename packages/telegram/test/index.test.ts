import { describe, expect, it, vi } from 'vitest'
import type { Update } from 'grammy/types'

import { RALLYO_ADMIN_COMMANDS, RALLYO_GROUP_COMMANDS, RALLYO_PRIVATE_COMMANDS, createRallyoBot } from '../src'

describe('Rallyo grammY routing', () => {
  it('publishes focused slash-command menus for private chats, groups, and group admins', () => {
    expect(RALLYO_PRIVATE_COMMANDS.map(({ command }) => command)).toEqual([
      'start',
      'help',
      'me',
      'pair',
    ])
    expect(RALLYO_GROUP_COMMANDS.map(({ command }) => command)).toContain('tasks')
    expect(RALLYO_GROUP_COMMANDS.map(({ command }) => command)).not.toContain('link')
    expect(RALLYO_ADMIN_COMMANDS.map(({ command }) => command)).toContain('settings')
    expect(RALLYO_ADMIN_COMMANDS.map(({ command }) => command)).toContain('task_review')
  })

  it('delivers ordinary group text to the community text handler', async () => {
    const onGroupText = vi.fn(() => Promise.resolve())
    const handler = vi.fn(() => Promise.resolve())
    const bot = createRallyoBot('123456:TESTTOKEN', {
      onUpdate: (_updateId, next) => next(),
      onStart: handler,
      onHelp: handler,
      onSettings: handler,
      onMe: handler,
      onLink: handler,
      onPair: handler,
      onWordSeek: handler,
      onWordSeekAdd: handler,
      onWordSeekWords: handler,
      onTasks: handler,
      onTaskSubmit: handler,
      onTaskCreate: handler,
      onTaskReview: handler,
      onTaskExpire: handler,
      onManualAward: handler,
      onScrambleStart: handler,
      onScrambleStop: handler,
      onScrambleHint: handler,
      onMyChatMember: handler,
      onGroupText,
      onProofMessage: handler,
      onAdminCallback: handler,
      onPlayerCallback: handler,
    })
    bot.botInfo = {
      id: 1,
      is_bot: true,
      first_name: 'Rallyo',
      username: 'rallyo_bot',
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    }
    bot.api.config.use(() => Promise.resolve({ ok: true, result: true }) as never)

    const update: Update = {
      update_id: 7001,
      message: {
        message_id: 41,
        date: 1_760_000_000,
        chat: { id: -1007001, type: 'supergroup', title: 'Rallyo community' },
        from: { id: 77, is_bot: false, first_name: 'Player' },
        text: 'Rallyo answer',
      },
    }

    await bot.handleUpdate(update)

    expect(onGroupText).toHaveBeenCalledOnce()
  })
})
