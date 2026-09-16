import { describe, expect, it } from 'vitest'

import {
  createMathQuestion,
  prepareOfflineContent,
  validatePreparedQuizItem,
} from '../../src/core/content-preparation'

describe('prepared game content', () => {
  it('creates deterministic math answers before a round is posted', () => {
    expect(createMathQuestion('MEDIUM', 42)).toEqual(createMathQuestion('MEDIUM', 42))
    const question = createMathQuestion('EASY', 7)
    expect(question.presentationType).toBe('MATH')
    expect(Number(question.answer)).not.toBeNaN()
  })

  it('rejects image content without prepared media', () => {
    expect(() =>
      validatePreparedQuizItem({
        question: 'Who is shown?',
        answer: 'A player',
        category: 'People',
        presentationType: 'IMAGE_IDENTIFY',
      }),
    ).toThrow('prepared media')
  })

  it('rejects media metadata without a reusable asset reference', () => {
    expect(() =>
      validatePreparedQuizItem({
        question: 'Which mark is shown?',
        answer: 'Rallyo',
        category: 'Logos',
        presentationType: 'IMAGE_IDENTIFY',
        media: { type: 'photo' },
      }),
    ).toThrow('Telegram file ID or asset reference')
  })

  it('validates media metadata and keeps AI preparation provider-neutral', async () => {
    const item = await prepareOfflineContent(
      {
        generate: () =>
          Promise.resolve([
            {
              question: 'Which logo is shown?',
              answer: 'Rallyo',
              category: 'Logos',
              presentationType: 'IMAGE_IDENTIFY',
              media: { type: 'photo', fileId: 'telegram-file-id', spoiler: true },
            },
          ]),
      },
      'prepared source',
    )
    expect(item[0]?.media?.fileId).toBe('telegram-file-id')
    expect(item[0]?.media?.spoiler).toBe(true)
  })
})
