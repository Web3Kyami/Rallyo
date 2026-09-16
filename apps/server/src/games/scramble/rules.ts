import { normalizeAnswer } from '@rallyo/core'
import type { ResolvedDifficulty } from '../difficulty'

export type ScrambleCandidate = {
  readonly term: string
  readonly category: string
  readonly sourceTermId?: string
  readonly difficulty?: string
}

export type SelectedScramble = ScrambleCandidate & {
  readonly normalizedAnswer: string
  readonly scrambledTerm: string
}

type RandomSource = () => number

export function isScrambleableTerm(term: string, minLength = 2, maxLength = 64): boolean {
  const characters = Array.from(term.trim())
  const letterPositions = letterPositionsFor(characters)
  if (
    characters.length < minLength ||
    characters.length > maxLength ||
    letterPositions.length < 2
  ) {
    return false
  }

  const normalizedLetters = letterPositions.map((position) =>
    normalizeAnswer(characters[position] ?? ''),
  )
  return new Set(normalizedLetters).size > 1 && normalizeAnswer(term).length > 0
}

export function scrambleTerm(term: string, random: RandomSource = Math.random): string | null {
  const characters = Array.from(term.trim())
  const letterPositions = letterPositionsFor(characters)
  if (!isScrambleableTerm(term, 2, Number.MAX_SAFE_INTEGER)) return null

  const letters = letterPositions.map((position) => characters[position]!)
  const shuffled = shuffle(letters, random)
  let output = putLettersInPlace(characters, letterPositions, shuffled)

  if (normalizeAnswer(output) === normalizeAnswer(term)) {
    const rotated = letters.slice(1).concat(letters[0]!)
    output = putLettersInPlace(characters, letterPositions, rotated)
  }

  return normalizeAnswer(output) === normalizeAnswer(term) ? null : output
}

export function selectScrambleTerm(
  candidates: readonly ScrambleCandidate[],
  recentNormalizedAnswers: ReadonlySet<string>,
  options: {
    readonly minLength?: number
    readonly maxLength?: number
    readonly difficulty?: ResolvedDifficulty
    readonly random?: RandomSource
  } = {},
): SelectedScramble | null {
  const minLength = options.minLength ?? 2
  const maxLength = options.maxLength ?? 64
  const random = options.random ?? Math.random
  const usable = uniqueCandidates(candidates).filter((candidate) =>
    isScrambleableTerm(candidate.term, minLength, maxLength),
  )
  if (usable.length === 0) return null

  const difficultyCandidates = options.difficulty
    ? usable.filter((candidate) => {
        const value = (candidate.difficulty ?? 'AUTO').toUpperCase()
        return value === 'AUTO' || value === options.difficulty
      })
    : usable
  const scopedCandidates = difficultyCandidates.length > 0 ? difficultyCandidates : usable

  const projectCandidates = scopedCandidates.filter((candidate) => candidate.sourceTermId)
  const generalCandidates = scopedCandidates.filter((candidate) => !candidate.sourceTermId)
  const preferred = projectCandidates.length > 0 ? projectCandidates : generalCandidates
  const freshPreferred = preferred.filter(
    (candidate) => !recentNormalizedAnswers.has(normalizeAnswer(candidate.term)),
  )
  const freshGeneral = generalCandidates.filter(
    (candidate) => !recentNormalizedAnswers.has(normalizeAnswer(candidate.term)),
  )
  const pool =
    freshPreferred.length > 0
      ? freshPreferred
      : projectCandidates.length > 0 && freshGeneral.length > 0
        ? freshGeneral
        : preferred.length > 0
          ? preferred
          : scopedCandidates
  const candidate = pool[randomIndex(random, pool.length)]
  if (!candidate) return null

  const scrambledTerm = scrambleTerm(candidate.term, random)
  if (!scrambledTerm) return null

  return {
    ...candidate,
    term: candidate.term.trim(),
    normalizedAnswer: normalizeAnswer(candidate.term),
    scrambledTerm,
  }
}

export function maximumUsefulHints(term: string, configuredMaxHints: number): number {
  const letters = letterPositionsFor(Array.from(term.trim()))
  return Math.min(configuredMaxHints, Math.max(0, letters.length - 1))
}

export function revealPositionsForHint(
  term: string,
  revealedPositions: readonly number[],
  hintNumber: number,
  maxHints: number,
): readonly number[] {
  const characters = Array.from(term.trim())
  const letterPositions = letterPositionsFor(characters)
  const boundedMaxHints = Math.max(1, maxHints)
  const targetCount = Math.min(
    Math.max(0, letterPositions.length - 1),
    Math.ceil(((letterPositions.length - 1) * hintNumber) / boundedMaxHints),
  )
  const revealed = new Set(revealedPositions)
  for (const position of letterPositions) {
    if (revealed.size >= targetCount) break
    revealed.add(position)
  }
  return [...revealed].sort((left, right) => left - right)
}

export function renderHintPattern(term: string, revealedPositions: readonly number[]): string {
  const revealed = new Set(revealedPositions)
  return Array.from(term.trim())
    .map((character, position) => {
      if (!isLetterOrNumber(character)) return character
      return revealed.has(position) ? character : '?'
    })
    .join('')
}

function uniqueCandidates(candidates: readonly ScrambleCandidate[]): ScrambleCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = normalizeAnswer(candidate.term)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function shuffle(values: readonly string[], random: RandomSource): string[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(random, index + 1)
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

function randomIndex(random: RandomSource, length: number): number {
  const value = random()
  const bounded = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0
  return Math.floor(bounded * length)
}

function putLettersInPlace(
  characters: readonly string[],
  positions: readonly number[],
  letters: readonly string[],
): string {
  const result = [...characters]
  positions.forEach((position, index) => {
    result[position] = letters[index]!
  })
  return result.join('')
}

function letterPositionsFor(characters: readonly string[]): number[] {
  return characters.flatMap((character, index) => (isLetterOrNumber(character) ? [index] : []))
}

function isLetterOrNumber(character: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(character)
}
