import type { ScrambleRound } from './service'

export function renderScrambleStart(round: ScrambleRound, now: Date = round.startsAt): string {
  return `<b>🔀 SCRAMBLE</b>\n\n<b>${escapeHtml(round.category)}</b>\n<code>${escapeHtml(round.scrambledTerm)}</code>\n\n<i>Unscramble the term. First correct reply wins ${round.pointsRemaining} pts.\n${remainingSeconds(round, now)} sec · ${hintLine(round)}</i>`
}

export function renderScrambleHint(input: {
  readonly hint: string
  readonly hintNumber: number
  readonly maxHints: number
  readonly pointsRemaining: number
}): string {
  return `<b>💡 SCRAMBLE HINT ${input.hintNumber}/${input.maxHints}</b>\n\n<code>${escapeHtml(input.hint)}</code>\n\n<i>${input.pointsRemaining} pts remain</i>`
}

export function renderScrambleWinner(input: {
  readonly round: ScrambleRound
  readonly winner: string
}): string {
  return `<b>🏆 SCRAMBLE — SOLVED</b>\n\n<code>${escapeHtml(input.round.term)}</code>\n\n<b>${escapeHtml(input.winner)} got it first</b>\n✨ <b>+${input.round.pointsRemaining} pts</b>`
}

export function renderScrambleTimeout(round: ScrambleRound): string {
  return `<b>⏱ SCRAMBLE — TIMEOUT</b>\n\nThe answer was <code>${escapeHtml(round.term)}</code>.\n\nStart another round from community controls.`
}

export function renderScrambleStopped(round: ScrambleRound): string {
  return `<b>⏹ SCRAMBLE — STOPPED</b>\n\nThe answer was <code>${escapeHtml(round.term)}</code>. No points were awarded.`
}

export function renderScrambleNoActive(): string {
  return 'There is no active Scramble round right now.'
}

export function renderScrambleHintUnavailable(message: string): string {
  return `<b>SCRAMBLE</b>\n\n${escapeHtml(message)}`
}

function hintLine(round: ScrambleRound): string {
  if (!round.hintsEnabled || round.maxHints === 0) return 'Hints are off.'
  return `Use /scramble_hint for a hint (${round.maxHints} max).`
}

function remainingSeconds(round: ScrambleRound, now: Date): number {
  return Math.max(0, Math.ceil((round.locksAt.getTime() - now.getTime()) / 1_000))
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
