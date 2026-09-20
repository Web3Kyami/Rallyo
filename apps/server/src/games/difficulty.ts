import { z } from 'zod'

export const gameDifficultySchema = z.enum(['AUTO', 'EASY', 'MEDIUM', 'HARD'])
export type GameDifficulty = z.infer<typeof gameDifficultySchema>
export type ResolvedDifficulty = Exclude<GameDifficulty, 'AUTO'>

export const GAME_DIFFICULTIES = gameDifficultySchema.options

export function parseGameDifficulty(
  value: unknown,
  fallback: GameDifficulty = 'AUTO',
): GameDifficulty {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value
  const result = gameDifficultySchema.safeParse(normalized)
  return result.success ? result.data : fallback
}

export function resolveGameDifficulty(
  configured: GameDifficulty,
  random: () => number = Math.random,
): ResolvedDifficulty {
  if (configured !== 'AUTO') return configured
  const rawSample = random()
  const sample = Number.isFinite(rawSample) ? Math.min(0.999999, Math.max(0, rawSample)) : 0
  if (sample < 0.5) return 'EASY'
  if (sample < 0.85) return 'MEDIUM'
  return 'HARD'
}

export function difficultyLabel(difficulty: GameDifficulty | ResolvedDifficulty): string {
  return difficulty.charAt(0) + difficulty.slice(1).toLocaleLowerCase('en-US')
}

export type QuizDifficultyPreset = {
  readonly answerTimeoutSeconds: number
  readonly hintsEnabled: boolean
  readonly hintTimingSeconds: readonly number[]
  readonly pointReductions: readonly number[]
}

export type WordSeekDifficultyPreset = {
  readonly roundTimeoutSeconds: number
  readonly maxGuesses: number
  readonly hintEnabled: boolean
}

export type ScrambleDifficultyPreset = {
  readonly timeoutSeconds: number
  readonly minLength: number
  readonly maxLength: number
  readonly maxHints: number
  readonly hintTimingSeconds: readonly number[]
  readonly pointReductions: readonly number[]
}

export function quizDifficultyPreset(difficulty: ResolvedDifficulty): QuizDifficultyPreset {
  switch (difficulty) {
    case 'EASY':
      return {
        answerTimeoutSeconds: 30,
        hintsEnabled: true,
        hintTimingSeconds: [12, 22],
        pointReductions: [0, 3, 6],
      }
    case 'MEDIUM':
      return {
        answerTimeoutSeconds: 20,
        hintsEnabled: false,
        hintTimingSeconds: [9, 15],
        pointReductions: [0, 5, 10],
      }
    case 'HARD':
      return {
        answerTimeoutSeconds: 15,
        hintsEnabled: false,
        hintTimingSeconds: [8, 12],
        pointReductions: [0, 8, 14],
      }
  }
}

export function wordSeekDifficultyPreset(difficulty: ResolvedDifficulty): WordSeekDifficultyPreset {
  switch (difficulty) {
    case 'EASY':
      return { roundTimeoutSeconds: 180, maxGuesses: 30, hintEnabled: true }
    case 'MEDIUM':
      return { roundTimeoutSeconds: 120, maxGuesses: 20, hintEnabled: true }
    case 'HARD':
      return { roundTimeoutSeconds: 90, maxGuesses: 12, hintEnabled: false }
  }
}

export function scrambleDifficultyPreset(difficulty: ResolvedDifficulty): ScrambleDifficultyPreset {
  switch (difficulty) {
    case 'EASY':
      return {
        timeoutSeconds: 45,
        minLength: 3,
        maxLength: 10,
        maxHints: 2,
        hintTimingSeconds: [15, 30],
        pointReductions: [2, 4],
      }
    case 'MEDIUM':
      return {
        timeoutSeconds: 35,
        minLength: 4,
        maxLength: 15,
        maxHints: 2,
        hintTimingSeconds: [12, 24],
        pointReductions: [3, 6],
      }
    case 'HARD':
      return {
        timeoutSeconds: 25,
        minLength: 5,
        maxLength: 24,
        maxHints: 1,
        hintTimingSeconds: [15],
        pointReductions: [5],
      }
  }
}
