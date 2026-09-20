import { describe, expect, it } from 'vitest'

import {
  parseGameDifficulty,
  quizDifficultyPreset,
  resolveGameDifficulty,
  scrambleDifficultyPreset,
  wordSeekDifficultyPreset,
} from '../../src/games/difficulty'

describe('shared game difficulty', () => {
  it('accepts the four public presets and normalizes labels', () => {
    expect(parseGameDifficulty('easy')).toBe('EASY')
    expect(parseGameDifficulty('unknown')).toBe('AUTO')
    expect(parseGameDifficulty(undefined)).toBe('AUTO')
  })

  it('uses the documented deterministic AUTO distribution', () => {
    expect(resolveGameDifficulty('AUTO', () => 0)).toBe('EASY')
    expect(resolveGameDifficulty('AUTO', () => 0.4999)).toBe('EASY')
    expect(resolveGameDifficulty('AUTO', () => 0.5)).toBe('MEDIUM')
    expect(resolveGameDifficulty('AUTO', () => 0.8499)).toBe('MEDIUM')
    expect(resolveGameDifficulty('AUTO', () => 0.85)).toBe('HARD')

    const values = Array.from({ length: 100 }, (_, index) =>
      resolveGameDifficulty('AUTO', () => index / 100),
    )
    expect(values.filter((value) => value === 'EASY')).toHaveLength(50)
    expect(values.filter((value) => value === 'MEDIUM')).toHaveLength(35)
    expect(values.filter((value) => value === 'HARD')).toHaveLength(15)
  })

  it('makes the presets materially different for every community game', () => {
    expect(quizDifficultyPreset('EASY').answerTimeoutSeconds).toBeGreaterThan(
      quizDifficultyPreset('HARD').answerTimeoutSeconds,
    )
    expect(wordSeekDifficultyPreset('EASY').maxGuesses).toBeGreaterThan(
      wordSeekDifficultyPreset('HARD').maxGuesses,
    )
    expect(scrambleDifficultyPreset('EASY').minLength).toBeLessThan(
      scrambleDifficultyPreset('HARD').minLength,
    )
  })

  it('keeps quiz clue policy aligned with the presentation contract', () => {
    expect(quizDifficultyPreset('EASY').hintsEnabled).toBe(true)
    expect(quizDifficultyPreset('MEDIUM').hintsEnabled).toBe(false)
    expect(quizDifficultyPreset('HARD').hintsEnabled).toBe(false)
  })
})
