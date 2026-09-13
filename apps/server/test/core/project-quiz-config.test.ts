import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROJECT_QUIZ_CONFIG,
  parseProjectQuizConfig,
} from '../../src/core/community-game-config-service'

describe('Project Quiz configuration', () => {
  it('defaults to a typed first-correct race', () => {
    expect(DEFAULT_PROJECT_QUIZ_CONFIG).toMatchObject({
      presentation: 'typed',
      hintsEnabled: false,
      startingPoints: 20,
      answerTimeoutSeconds: 60,
      contentSource: 'ANY_APPROVED',
      automaticRounds: true,
    })
  })

  it('normalizes multiple-choice and hint aliases', () => {
    expect(
      parseProjectQuizConfig({
        answerPresentation: 'MULTIPLE_CHOICE',
        hintsEnabled: true,
        hintTimingsSeconds: [15, 35],
        startingPoints: 30,
        pointReductions: [0, 10, 20],
        answerTimeoutSeconds: 90,
        sourcePolicy: 'PROJECT_BRAIN',
      }),
    ).toMatchObject({
      presentation: 'multiple_choice',
      hintTimingSeconds: [15, 35],
      startingPoints: 30,
      pointReductions: [0, 10, 20],
      answerTimeoutSeconds: 90,
      contentSource: 'PROJECT_BRAIN',
    })
  })

  it('rejects invalid timing and point reductions', () => {
    expect(() => parseProjectQuizConfig({ hintTimingSeconds: [30, 20] })).toThrow()
    expect(() =>
      parseProjectQuizConfig({ hintsEnabled: true, startingPoints: 10, pointReductions: [10] }),
    ).toThrow()
  })
})
