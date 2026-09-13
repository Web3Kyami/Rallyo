import { normalizeAnswer } from '@rallyo/core'

export const WORD_LENGTHS = [4, 5, 6] as const
export type WordLength = (typeof WORD_LENGTHS)[number]

export type FeedbackMark = 'GREEN' | 'YELLOW' | 'ABSENT'

const GREEN = '🟩'
const YELLOW = '🟨'
const ABSENT = '🟥'

export function normalizeWord(input: string): string {
  return normalizeAnswer(input)
}

export function isWordLength(value: number): value is WordLength {
  return WORD_LENGTHS.includes(value as WordLength)
}

export function isValidWordShape(input: string, expectedLength: number): boolean {
  const normalized = normalizeWord(input)
  return (
    isWordLength(expectedLength) &&
    normalized.length === expectedLength &&
    /^\p{L}+$/u.test(normalized)
  )
}

export function wordSeekFeedback(guessInput: string, solutionInput: string): string {
  const guess = normalizeWord(guessInput).toLocaleUpperCase('en-US')
  const solution = normalizeWord(solutionInput).toLocaleUpperCase('en-US')
  const marks = wordSeekFeedbackMarks(guess, solution)
  return `${marks.map(markEmoji).join(' ')} ${guess}`
}

export function wordSeekFeedbackMarks(guess: string, solution: string): FeedbackMark[] {
  const normalizedGuess = normalizeWord(guess)
  const normalizedSolution = normalizeWord(solution)
  const solutionCounts = new Map<string, number>()
  const result: FeedbackMark[] = Array.from(
    { length: normalizedGuess.length },
    () => 'ABSENT' as const,
  )

  for (const letter of normalizedSolution) {
    solutionCounts.set(letter, (solutionCounts.get(letter) ?? 0) + 1)
  }

  for (let index = 0; index < normalizedGuess.length; index += 1) {
    const guessLetter = normalizedGuess[index]
    const solutionLetter = normalizedSolution[index]
    if (guessLetter && guessLetter === solutionLetter) {
      result[index] = 'GREEN'
      solutionCounts.set(guessLetter, (solutionCounts.get(guessLetter) ?? 0) - 1)
    }
  }

  for (let index = 0; index < normalizedGuess.length; index += 1) {
    const guessLetter = normalizedGuess[index]
    if (guessLetter && result[index] === 'ABSENT' && (solutionCounts.get(guessLetter) ?? 0) > 0) {
      result[index] = 'YELLOW'
      solutionCounts.set(guessLetter, (solutionCounts.get(guessLetter) ?? 0) - 1)
    }
  }

  return result
}

function markEmoji(mark: FeedbackMark): string {
  return mark === 'GREEN' ? GREEN : mark === 'YELLOW' ? YELLOW : ABSENT
}
