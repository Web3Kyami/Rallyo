import { InlineKeyboard } from 'grammy'

import {
  parseProjectQuizConfig,
  type ProjectQuizConfig,
} from '../core/community-game-config-service'
import type { ClueData, QuestionOption } from '../db/schema'

export type RoundMessageInput = {
  readonly id: string
  readonly mode: 'QUICK' | 'FIRST_CORRECT' | 'CLUE'
  readonly presentation?: string | null
  readonly projectQuizConfig?: Record<string, unknown> | null
  readonly prompt: string
  readonly options: readonly QuestionOption[] | null
  readonly clueData: ClueData | null
  readonly basePoints: number
  readonly startsAt: Date
  readonly locksAt: Date
}

export function renderRoundMessage(round: RoundMessageInput, now: Date = round.startsAt) {
  const presentation = round.presentation ?? (round.mode === 'QUICK' ? 'multiple_choice' : 'typed')

  if (round.presentation && presentation === 'multiple_choice') {
    return {
      text: `<b>PROJECT QUIZ</b>\n\n${escapeHtml(round.prompt)}\n\n<i>First correct answer wins · ${projectQuizPoints(round)} pts · ${roundDurationSeconds(round)} sec</i>`,
      ...(round.options?.length ? { replyMarkup: quickQuizKeyboard(round.id, round.options) } : {}),
    }
  }

  if (round.presentation && presentation === 'typed') {
    const config = projectQuizConfig(round)
    const clueNumber = clueNumberAt(round, now)
    const clues =
      config?.hintsEnabled && round.clueData ? round.clueData.clues.slice(0, clueNumber) : []
    const clueText = clues.length
      ? `\n\n${clues.map((clue, index) => `Hint ${index + 1}\n&gt; ${escapeHtml(clue)}`).join('\n\n')}`
      : ''
    const points = projectQuizPoints(round, config?.hintsEnabled ? clueNumber : undefined)

    return {
      text: `<b>PROJECT QUIZ / RACE</b>\n\n${escapeHtml(round.prompt)}${clueText}\n\n<i>First correct answer wins · ${points} pts · ${roundDurationSeconds(round)} sec</i>`,
    }
  }

  switch (round.mode) {
    case 'QUICK':
      return {
        text: `<b>QUICK QUIZ</b>\n\n${escapeHtml(round.prompt)}\n\n<i>${roundDurationSeconds(round)} sec · ${round.basePoints} pts</i>`,
        ...(round.options?.length
          ? { replyMarkup: quickQuizKeyboard(round.id, round.options) }
          : {}),
      }
    case 'FIRST_CORRECT':
      return {
        text: `<b>FIRST CORRECT</b>\n\n${escapeHtml(round.prompt)}\n\n<i>First correct reply wins ${round.basePoints} pts.</i>`,
      }
    case 'CLUE':
      return renderClueRoundMessage(round, clueNumberAt(round, now))
  }
}

export function renderClueRoundMessage(round: RoundMessageInput, clueNumber: 1 | 2 | 3) {
  const clues = round.clueData?.clues ?? []
  const visibleClues = clues.slice(0, clueNumber)
  const points = [30, 20, 10][clueNumber - 1]
  const clueText = visibleClues
    .map((clue, index) => `Clue ${index + 1}\n> ${escapeHtml(clue)}`)
    .join('\n\n')

  return {
    text: `<b>3-CLUE ROUND</b>\n\n${escapeHtml(round.prompt)}\n\n${clueText}\n\n<i>${points} pts available</i>`,
  }
}

export function renderClueRevealMessage(round: RoundMessageInput, clueNumber: 2 | 3) {
  const clue = round.clueData?.clues[clueNumber - 1]
  const points = projectQuizPoints(round, clueNumber)

  return {
    text: `<b>CLUE ${clueNumber}</b>\n\n&gt; ${escapeHtml(clue ?? '')}\n\n<i>${points} pts remaining</i>`,
  }
}

export function renderClueRoundAnswered(input: {
  readonly prompt: string
  readonly answer: string
  readonly clueNumber: 1 | 2 | 3
  readonly points: number
}) {
  return `<b>🏆 CLUE ROUND — ANSWERED</b>\n\n${escapeHtml(input.prompt)}\n\n✅ <b>${escapeHtml(input.answer)}</b>\n\n<i>Answered on Clue ${input.clueNumber}</i>\n✨ <b>+${input.points} pts</b>`
}

export function renderFirstCorrectAnswered(input: {
  readonly prompt: string
  readonly answer: string
  readonly winner: string
  readonly points: number
}) {
  return `<b>🏆 FIRST CORRECT — ANSWERED</b>\n\n${escapeHtml(input.prompt)}\n\n✅ <b>${escapeHtml(input.answer)}</b>\n\n<b>${escapeHtml(input.winner)} got it first</b>\n✨ <b>+${input.points} pts</b>`
}

export function renderProjectQuizAnswered(input: {
  readonly prompt: string
  readonly answer: string
  readonly winner: string
  readonly points: number
  readonly rank?: number | null
}) {
  const rank = input.rank ? `\n<i>Current rank: #${input.rank}</i>` : ''
  return `<b>PROJECT QUIZ: CORRECT</b>\n\n${escapeHtml(input.prompt)}\n\n✅ <b>${escapeHtml(input.answer)}</b>\n\n<b>${escapeHtml(input.winner)} won</b>\n✨ <b>+${input.points} pts</b>${rank}`
}

export function quickQuizKeyboard(roundId: string, options: readonly QuestionOption[]) {
  if (options.length === 0) {
    return undefined
  }

  const keyboard = new InlineKeyboard()

  for (const [index, option] of options.entries()) {
    if (index > 0) keyboard.row()
    keyboard.text(option.label, `player:quick:${roundId}:${index}`)
  }

  return keyboard
}

export function clueNumberAt(
  round: Pick<RoundMessageInput, 'startsAt' | 'locksAt'> &
    Partial<Pick<RoundMessageInput, 'mode' | 'presentation' | 'projectQuizConfig'>>,
  now: Date,
) {
  const config = projectQuizConfig(round)
  if (config && !config.hintsEnabled) return 1

  if (config?.hintsEnabled) {
    const elapsed = Math.max(0, now.getTime() - round.startsAt.getTime()) / 1_000
    if (config.hintTimingSeconds[1] !== undefined && elapsed >= config.hintTimingSeconds[1])
      return 3
    if (config.hintTimingSeconds[0] !== undefined && elapsed >= config.hintTimingSeconds[0])
      return 2
    return 1
  }

  const duration = round.locksAt.getTime() - round.startsAt.getTime()
  const elapsed = Math.max(0, now.getTime() - round.startsAt.getTime())
  const fraction = duration > 0 ? elapsed / duration : 1
  return Math.min(3, Math.floor(fraction * 3) + 1) as 1 | 2 | 3
}

function projectQuizConfig(
  round: Pick<RoundMessageInput, 'projectQuizConfig'>,
): ProjectQuizConfig | null {
  return round.projectQuizConfig ? parseProjectQuizConfig(round.projectQuizConfig) : null
}

function projectQuizPoints(
  round: Pick<RoundMessageInput, 'basePoints' | 'projectQuizConfig'>,
  clueNumber?: 1 | 2 | 3,
): number {
  const config = projectQuizConfig(round)
  if (!config)
    return clueNumber ? ([30, 20, 10][clueNumber - 1] ?? round.basePoints) : round.basePoints

  const reduction = config.hintsEnabled
    ? (config.pointReductions[Math.max(0, (clueNumber ?? 1) - 1)] ??
      config.pointReductions.at(-1) ??
      0)
    : 0
  return Math.max(1, config.startingPoints - reduction)
}

function roundDurationSeconds(round: Pick<RoundMessageInput, 'startsAt' | 'locksAt'>) {
  return Math.max(1, Math.ceil((round.locksAt.getTime() - round.startsAt.getTime()) / 1000))
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
