import type { ScrambleRound } from './service'

export function renderScrambleStart(round: ScrambleRound, now: Date = round.startsAt): string {
  return `<b>🔀 SCRAMBLE · ${escapeHtml(round.difficulty ?? 'MEDIUM')}</b>\n\n<b>${escapeHtml(round.category)}</b>\n<code>${escapeHtml(round.scrambledTerm)}</code>\n\n<i>Unscramble the term. First correct reply wins ⭐ ${round.pointsRemaining} pts.\n⏱ ${remainingSeconds(round, now)}s · ${hintLine(round)}</i>`
}

export function renderScrambleHint(input: {
  readonly hint: string
  readonly hintNumber: number
  readonly maxHints: number
  readonly pointsRemaining: number
  readonly round?: ScrambleRound
  readonly now?: Date
}): string {
  if (input.round) {
    return `${renderScrambleStart(input.round, input.now ?? input.round.startsAt)}\n\n<b>💡 Hint ${input.hintNumber}/${input.maxHints}</b>\n<code>${escapeHtml(input.hint)}</code>\n\n<i>⭐ ${input.pointsRemaining} pts remain</i>`
  }
  return `<b>💡 SCRAMBLE HINT ${input.hintNumber}/${input.maxHints}</b>\n\n<code>${escapeHtml(input.hint)}</code>\n\n<i>${input.pointsRemaining} pts remain</i>`
}

export function renderScrambleWinner(input: {
  readonly round: ScrambleRound
  readonly winner: string
  readonly winnerMention?: string
}): string {
  return `<b>🏆 SCRAMBLE · SOLVED</b>\n\n<code>${escapeHtml(input.round.term)}</code>\n\n<b>${input.winnerMention ?? escapeHtml(input.winner)} got it first</b>\n✨ <b>+${input.round.pointsRemaining} pts</b>`
}

export function renderScrambleTimeout(round: ScrambleRound): string {
  return `<b>⏱ SCRAMBLE · TIME IS UP</b>\n\nThe answer was <code>${escapeHtml(round.term)}</code>.\n\nStart another round from community controls when you are ready.`
}

export function renderScrambleStopped(round: ScrambleRound): string {
  return `<b>⏹ SCRAMBLE · ENDED</b>\n\nThe answer was <code>${escapeHtml(round.term)}</code>. No points were awarded.`
}

export function renderScrambleNoActive(): string {
  return 'There is no Scramble round running right now. An admin can start one from /settings > Games.'
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
