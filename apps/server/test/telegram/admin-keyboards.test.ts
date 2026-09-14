import { describe, expect, it } from 'vitest'
import type { InlineKeyboard } from 'grammy'

import {
  adminKeyboard,
  activitySettingsKeyboard,
  communitySelectionKeyboard,
  contentKeyboard,
  confirmKeyboard,
  durationKeyboard,
  gameKeyboard,
  gamesKeyboard,
  helpMessage,
  pendingSocialTaskKeyboard,
  pointsKeyboard,
  questionCountKeyboard,
  questionSelectionKeyboard,
  seasonKeyboard,
  sourceKeyboard,
  startMessage,
  taskSettingsKeyboard,
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  telegramCallbackData,
  wordSeekVocabularyKeyboard,
} from '../../src/telegram/runtime'

const communityId = '00000000-0000-4000-8000-000000000000'

function callbackData(keyboard: InlineKeyboard): string[] {
  return keyboard.inline_keyboard.flatMap((row) =>
    row.flatMap((button) => ('callback_data' in button ? [button.callback_data] : [])),
  )
}

describe('Telegram admin keyboards', () => {
  it('keeps every settings and admin-control callback within Telegram limits', () => {
    const keyboards = [
      adminKeyboard(communityId),
      gamesKeyboard(communityId),
      gameKeyboard(communityId, 'quiz'),
      gameKeyboard(communityId, 'wordseek', true),
      gameKeyboard(communityId, 'scramble'),
      seasonKeyboard(communityId),
      taskSettingsKeyboard(communityId),
      activitySettingsKeyboard(communityId),
      contentKeyboard(communityId),
      communitySelectionKeyboard([{ id: communityId, title: 'Test community' }]),
      sourceKeyboard(communityId),
      questionCountKeyboard(communityId),
      durationKeyboard(communityId),
      pointsKeyboard(communityId),
      confirmKeyboard(communityId),
      questionSelectionKeyboard(
        communityId,
        Array.from({ length: 6 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          prompt: `Question ${index + 1}`,
          category: 'Test',
        })),
        0,
        [],
        1,
      ),
      wordSeekVocabularyKeyboard(communityId, [
        {
          id: '10000000-0000-4000-8000-000000000001',
          word: 'Rallyo',
          wordLength: 6,
          clue: null,
          status: 'DRAFT',
        },
      ]),
    ]

    const values = keyboards.flatMap(callbackData)
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) {
      const bytes = new TextEncoder().encode(value).byteLength
      expect(bytes).toBeGreaterThanOrEqual(1)
      expect(bytes).toBeLessThanOrEqual(TELEGRAM_CALLBACK_DATA_MAX_BYTES)
    }

    expect(callbackData(adminKeyboard(communityId))).toEqual([
      `admin:section:${communityId}:games`,
      `admin:section:${communityId}:season`,
      `admin:section:${communityId}:tasks`,
      `admin:section:${communityId}:content`,
      `admin:section:${communityId}:activity`,
      `admin:refresh:${communityId}`,
      `admin:open:${communityId}`,
    ])
    expect(
      callbackData(
        questionSelectionKeyboard(
          communityId,
          [
            {
              id: '10000000-0000-4000-8000-000000000001',
              prompt: 'Question',
              category: 'Test',
            },
          ],
          0,
          [],
          1,
        ),
      ),
    ).toContain(`admin:pick:${communityId}:0`)
  })

  it('rejects callback data outside Telegram limits before a request is sent', () => {
    expect(() => telegramCallbackData('x'.repeat(65))).toThrow('received 65')
    expect(telegramCallbackData('x'.repeat(64))).toHaveLength(64)
  })

  it('keeps onboarding and help copy focused on player actions', () => {
    expect(startMessage()).toContain('play and rank without a wallet')
    expect(startMessage()).toContain('Rallyo-native rewards')
    expect(helpMessage()).toContain('<b>Games</b>')
    expect(helpMessage()).not.toContain('/task_create')
    expect(helpMessage(true)).toContain('/task_create')
  })

  it('keeps social-task review callbacks compact', () => {
    const rows = [
      {
        submission: { id: '10000000-0000-4000-8000-000000000001' },
      },
    ] as unknown as Parameters<typeof pendingSocialTaskKeyboard>[0]

    const values = callbackData(pendingSocialTaskKeyboard(rows))
    expect(values).toEqual([
      'admin:task_approve:10000000-0000-4000-8000-000000000001',
      'admin:task_reject:10000000-0000-4000-8000-000000000001',
    ])
    expect(values.every((value) => new TextEncoder().encode(value).byteLength <= 64)).toBe(true)
  })
})
