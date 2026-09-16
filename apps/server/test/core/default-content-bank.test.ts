import { describe, expect, it } from 'vitest'

import { DEFAULT_QUIZ_BANK } from '../../src/content/default-quiz-bank'
import { generalWordsForLength } from '../../src/games/word-seek/dictionary'
import { GENERAL_SCRAMBLE_TERMS } from '../../src/games/scramble/terms'

describe('Rallyo default content bank', () => {
  it('ships a substantial playable bank outside service code', () => {
    const vocabularyCount = [4, 5, 6].reduce(
      (total, length) => total + generalWordsForLength(length as 4 | 5 | 6).length,
      0,
    )
    expect(vocabularyCount).toBeGreaterThanOrEqual(140)
    expect(DEFAULT_QUIZ_BANK.length).toBeGreaterThanOrEqual(30)
    expect(GENERAL_SCRAMBLE_TERMS.length).toBeGreaterThanOrEqual(20)
  })
})
