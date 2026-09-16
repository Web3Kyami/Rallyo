import { describe, expect, it, vi } from 'vitest'
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
  cleanupAdminWizardMessages,
  pointsKeyboard,
  questionCountKeyboard,
  questionConfirmKeyboard,
  questionModeKeyboard,
  questionSelectionKeyboard,
  seasonKeyboard,
  seasonConfirmKeyboard,
  seasonDurationKeyboard,
  seasonNameKeyboard,
  seasonWinnerKeyboard,
  sourceKeyboard,
  startMessage,
  renderSocialTaskCard,
  renderSocialTaskDecisionNotification,
  renderTopCommunities,
  socialTaskCardKeyboard,
  taskActionKeyboard,
  taskCapKeyboard,
  taskConfirmKeyboard,
  taskDurationKeyboard,
  taskPlatformKeyboard,
  taskProofKeyboard,
  taskSettingsKeyboard,
  taskTypeKeyboard,
  taskCommunitySelectionKeyboard,
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  telegramCallbackData,
  updateAdminSettingsMessage,
  wordSeekVocabularyKeyboard,
  wordClueKeyboard,
  wordConfirmKeyboard,
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
      seasonNameKeyboard(communityId),
      seasonDurationKeyboard(communityId),
      seasonWinnerKeyboard(communityId),
      seasonConfirmKeyboard(communityId),
      taskSettingsKeyboard(communityId),
      taskTypeKeyboard(communityId),
      taskPlatformKeyboard(communityId),
      taskActionKeyboard(communityId),
      taskProofKeyboard(communityId),
      taskCapKeyboard(communityId, 'RECURRING'),
      taskCapKeyboard(communityId, 'CAMPAIGN'),
      taskDurationKeyboard(communityId),
      taskConfirmKeyboard(communityId),
      activitySettingsKeyboard(communityId),
      contentKeyboard(communityId),
      questionModeKeyboard(communityId),
      questionConfirmKeyboard(communityId),
      wordClueKeyboard(communityId),
      wordConfirmKeyboard(communityId),
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
    expect(callbackData(seasonDurationKeyboard(communityId))).toContain(
      `a:season_duration_custom:${communityId}`,
    )
  })

  it('rejects callback data outside Telegram limits before a request is sent', () => {
    expect(() => telegramCallbackData('x'.repeat(65))).toThrow('received 65')
    expect(telegramCallbackData('x'.repeat(64))).toHaveLength(64)
  })

  it('edits the existing settings message and falls back to a fresh root when stale', async () => {
    const editMessageText = vi.fn().mockResolvedValue(undefined)
    const reply = vi.fn().mockResolvedValue(undefined)
    const context = { editMessageText, reply } as never
    const page = { text: 'Games', keyboard: gamesKeyboard(communityId) }
    const fallback = { text: 'Settings', keyboard: adminKeyboard(communityId) }

    await updateAdminSettingsMessage(context, page, fallback)
    expect(editMessageText).toHaveBeenCalledWith('Games', expect.any(Object))
    expect(reply).not.toHaveBeenCalled()

    editMessageText.mockRejectedValueOnce(new Error('stale message'))
    await updateAdminSettingsMessage(context, page, fallback)
    expect(reply).toHaveBeenCalledWith('Settings', expect.any(Object))
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

  it('renders guided task cards with a proof button and cap details', () => {
    const task = {
      id: '10000000-0000-4000-8000-000000000002',
      title: 'Share the launch post',
      instructions: 'Share the approved launch post and keep the link handy.',
      points: 25,
      taskType: 'RECURRING',
      platform: 'X',
      action: 'SHARE_REPOST',
      targetUrl: 'https://example.com/post',
      proofType: 'URL',
      requiresHandle: false,
      maxApprovedSubmissionsPerPlayerPerDay: 1,
      completionCapPerPlayer: null,
      startsAt: new Date('2026-09-13T00:00:00.000Z'),
      endsAt: new Date('2026-09-20T00:00:00.000Z'),
    } as unknown as Parameters<typeof renderSocialTaskCard>[0]
    const text = renderSocialTaskCard(task, new Date('2026-09-14T00:00:00.000Z'), {
      used: 0,
      limit: 1,
      remaining: 1,
    })
    expect(text).toContain('Reward · <b>+25 points</b>')
    expect(text).toContain('Today · 1 submission remaining')
    expect(text).toContain('Open reference')
    expect(callbackData(socialTaskCardKeyboard(task))).toEqual([
      `player:task:${task.id}`,
      'player:tasks',
    ])
  })

  it('renders approval and rejection notices for player DMs', () => {
    expect(
      renderSocialTaskDecisionNotification({
        status: 'APPROVED',
        taskTitle: 'Share the launch post',
        communityTitle: 'Rallyo builders',
        points: 25,
        seasonTotal: 80,
        rank: 3,
      }),
    ).toContain('Current rank · #3')
    expect(
      renderSocialTaskDecisionNotification({
        status: 'REJECTED',
        taskTitle: 'Share the launch post',
        communityTitle: 'Rallyo builders',
        reason: 'The proof link does not show the required action.',
      }),
    ).toContain('The proof link does not show the required action.')
  })

  it('keeps DM community selectors scoped to compact admin callbacks', () => {
    const values = callbackData(
      taskCommunitySelectionKeyboard([
        { id: communityId, title: 'A community' },
        { id: '10000000-0000-4000-8000-000000000003', title: 'Another community' },
      ]),
    )
    expect(values).toHaveLength(2)
    expect(values.every((value) => new TextEncoder().encode(value).byteLength <= 64)).toBe(true)
    expect(
      renderTopCommunities([
        { title: 'One', points: 42, rank: 2 },
        { title: 'Two', points: 12, rank: 8 },
      ]),
    ).toContain('Rank #2')
  })

  it('treats wizard message deletion as best effort', async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error('Telegram refused deletion'))
    const context = {
      api: { deleteMessage },
      chat: { id: 77 },
      message: { message_id: 88 },
    } as never
    await expect(
      cleanupAdminWizardMessages(context, {
        data: { _wizardChatId: 77, _wizardPromptMessageId: 99 },
      }),
    ).resolves.toBeUndefined()
    expect(deleteMessage).toHaveBeenCalledTimes(2)
  })
})
