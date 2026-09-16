import { describe, expect, it } from 'vitest'

import { validateGeneratedQuestionPack } from '../../src/core/question-bank-service'

describe('generated question validation', () => {
  it('accepts case-insensitive MCQ answers and keeps aliases', () => {
    const [question] = validateGeneratedQuestionPack([
      {
        mode: 'QUICK',
        prompt: 'Which project mark is shown here?',
        correctAnswer: 'Rallyo',
        acceptedAnswers: ['Rallyo', 'Rallyo game'],
        options: [
          { label: 'rallyo', value: 'rallyo' },
          { label: 'Nimiq', value: 'Nimiq' },
        ],
        category: 'Logos',
        difficulty: 'medium',
        sourceRefs: ['source-1'],
      },
    ])

    expect(question?.difficulty).toBe('MEDIUM')
    expect(question?.acceptedAnswers).toContain('Rallyo game')
  })

  it('rejects image candidates without prepared reusable media', () => {
    expect(() =>
      validateGeneratedQuestionPack([
        {
          mode: 'FIRST_CORRECT',
          presentationType: 'IMAGE_IDENTIFY',
          prompt: 'Which project mark is shown here?',
          correctAnswer: 'Rallyo',
          acceptedAnswers: ['Rallyo'],
          category: 'Logos',
          difficulty: 'hard',
          sourceRefs: ['source-1'],
        },
      ]),
    ).toThrow('prepared media')

    expect(() =>
      validateGeneratedQuestionPack([
        {
          mode: 'FIRST_CORRECT',
          presentationType: 'IMAGE_IDENTIFY',
          prompt: 'Which project mark is shown here?',
          correctAnswer: 'Rallyo',
          acceptedAnswers: ['Rallyo'],
          category: 'Logos',
          difficulty: 'hard',
          media: { type: 'photo' },
          sourceRefs: ['source-1'],
        },
      ]),
    ).toThrow('Telegram file ID or asset reference')
  })
})
