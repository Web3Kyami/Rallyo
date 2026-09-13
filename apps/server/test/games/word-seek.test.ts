import { describe, expect, it } from 'vitest'

import {
  isValidWordShape,
  normalizeWord,
  wordSeekFeedback,
  wordSeekFeedbackMarks,
} from '../../src/games/word-seek/rules'
import {
  renderWordSeekEnded,
  renderWordSeekFeedback,
  renderWordSeekInvalidGuess,
  renderWordSeekStart,
  renderWordSeekWinner,
} from '../../src/games/word-seek/messages'
import { parseWordSeekConfig } from '../../src/games/word-seek/service'

describe('Word Seek rules', () => {
  it('normalizes case and accents without accepting spaces as part of a word', () => {
    expect(normalizeWord('Éxámple')).toBe('example')
    expect(isValidWordShape('CRANE', 5)).toBe(true)
    expect(isValidWordShape('two words', 5)).toBe(false)
    expect(isValidWordShape('seek', 5)).toBe(false)
  })

  it('uses two-pass duplicate-letter feedback', () => {
    expect(wordSeekFeedback('SPEED', 'ERASE')).toBe('🟨 🟥 🟨 🟨 🟥 SPEED')
    expect(wordSeekFeedback('EERIE', 'GEESE')).toBe('🟨 🟩 🟥 🟥 🟩 EERIE')
    expect(wordSeekFeedbackMarks('LLAMA', 'ALLOT')).toEqual([
      'YELLOW',
      'GREEN',
      'YELLOW',
      'ABSENT',
      'ABSENT',
    ])
  })

  it('normalizes supported configuration aliases', () => {
    expect(
      parseWordSeekConfig({
        wordLength: 6,
        timeoutSeconds: 90,
        allowedSource: 'project-brain',
      }),
    ).toMatchObject({ wordLength: 6, roundTimeoutSeconds: 90, source: 'PROJECT' })
  })
})

describe('Word Seek Telegram messages', () => {
  it('escapes the community, clue, and result fields', () => {
    expect(
      renderWordSeekStart({
        communityTitle: '<Rallyo>',
        wordLength: 5,
        points: 30,
        timeoutSeconds: 300,
        maxGuesses: 30,
        clue: '<safe clue>',
      }),
    ).toContain('&lt;Rallyo&gt;')
    expect(
      renderWordSeekStart({
        communityTitle: 'Rallyo',
        wordLength: 5,
        points: 30,
        timeoutSeconds: 300,
        maxGuesses: 30,
        clue: '<safe clue>',
      }),
    ).toContain('&lt;safe clue&gt;')
  })

  it('renders progress, winner, and timeout states', () => {
    expect(
      renderWordSeekFeedback({ feedback: '🟩 C R A N E', guessesUsed: 2, maxGuesses: 30 }),
    ).toContain('2/30')
    expect(
      renderWordSeekWinner({
        communityTitle: 'Rallyo',
        word: 'CRANE',
        winner: '@alice',
        points: 30,
        guessesUsed: 2,
      }),
    ).toContain('@alice found it first')
    expect(
      renderWordSeekEnded({ communityTitle: 'Rallyo', word: 'CRANE', reason: 'TIMEOUT' }),
    ).toContain('The word was <b>CRANE</b>.')
    expect(renderWordSeekInvalidGuess({ wordLength: 5, hasCorrectLength: true })).toContain(
      '5-letter',
    )
    expect(renderWordSeekInvalidGuess({ wordLength: 5, hasCorrectLength: false })).toContain(
      'approved word list',
    )
  })
})
