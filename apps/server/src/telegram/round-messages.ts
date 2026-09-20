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
  readonly difficulty?: string | null
  readonly presentationType?:
    'TEXT' | 'MCQ' | 'IMAGE_IDENTIFY' | 'IMAGE_CLUE' | 'MATH' | 'PROGRESSIVE_CLUE' | null
  readonly prompt: string
  readonly options: readonly QuestionOption[] | null
  readonly clueData: ClueData | null
  readonly hints?: readonly string[] | null
  readonly mediaType?: string | null
  readonly mediaFileId?: string | null
  readonly mediaAssetRef?: string | null
  readonly mediaSource?: string | null
  readonly mediaCredit?: string | null
  readonly mediaAlt?: string | null
  readonly mediaSpoiler?: boolean
  readonly basePoints: number
  readonly startsAt: Date
  readonly locksAt: Date
}

export function renderRoundMessage(round: RoundMessageInput, now: Date = round.startsAt) {
  const presentation = round.presentation ?? (round.mode === 'QUICK' ? 'multiple_choice' : 'typed')
  const presentationType = contentPresentation(round, presentation)
  const difficulty = (round.difficulty ?? 'MEDIUM').toUpperCase()
  const title = presentationTitle(presentationType)
  const timing = `⭐ ${projectQuizPoints(round)} pts · ⏱ ${roundDurationSeconds(round)}s`
  const media = round.mediaFileId
    ? {
        type: 'photo' as const,
        media: round.mediaFileId,
        hasSpoiler: Boolean(round.mediaSpoiler),
      }
    : undefined

  if (presentationType === 'MCQ' || (round.presentation && presentation === 'multiple_choice')) {
    return {
      text: `<b>${title}</b> · ${difficulty}\n\n${escapeHtml(round.prompt)}\n\n<i>Choose the correct answer. First correct wins.</i>\n${timing}`,
      ...(media
        ? {
            media,
            caption: `<b>${title}</b> · ${difficulty}\n\n${escapeHtml(round.prompt)}\n\n<i>Choose the correct answer. First correct wins.</i>\n${timing}`,
          }
        : {}),
      ...(round.options?.length ? { replyMarkup: quickQuizKeyboard(round.id, round.options) } : {}),
    }
  }

  if (
    presentationType !== 'PROGRESSIVE_CLUE' &&
    (round.presentation || presentationType !== 'TEXT')
  ) {
    const config = projectQuizConfig(round)
    const clueNumber = clueNumberAt(round, now)
    const clues = config?.hintsEnabled
      ? (round.hints ?? round.clueData?.clues ?? []).slice(0, clueNumber)
      : []
    const clueText = clues.length
      ? `\n\n${clues.map((clue, index) => `<i>Hint ${index + 1}</i>\n${escapeHtml(clue)}`).join('\n\n')}`
      : ''
    const points = projectQuizPoints(round, config?.hintsEnabled ? clueNumber : undefined)
    const text = `<b>${title}</b> · ${difficulty}\n\n${escapeHtml(round.prompt)}${clueText}\n\n<i>Reply with your answer. First correct wins.</i>\n⭐ ${points} pts · ⏱ ${roundDurationSeconds(round)}s`

    return {
      text,
      ...(media ? { media, caption: text } : {}),
    }
  }

  switch (round.mode) {
    case 'QUICK':
      return {
        text: `<b>🧠 PROJECT QUIZ / RACE</b> · ${difficulty}\n\n${escapeHtml(round.prompt)}\n\n<i>Choose the correct answer.</i>\n⭐ ${round.basePoints} pts · ⏱ ${roundDurationSeconds(round)}s`,
        ...(round.options?.length
          ? { replyMarkup: quickQuizKeyboard(round.id, round.options) }
          : {}),
      }
    case 'FIRST_CORRECT':
      return {
        text: `<b>🧠 PROJECT QUIZ / RACE</b> · ${difficulty}\n\n${escapeHtml(round.prompt)}\n\n<i>Reply with your answer. First correct wins.</i>\n⭐ ${round.basePoints} pts · ⏱ ${roundDurationSeconds(round)}s`,
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
    .map((clue, index) => `<i>Clue ${index + 1}</i>\n${escapeHtml(clue)}`)
    .join('\n\n')

  return {
    text: `<b>🧠 PROJECT QUIZ / RACE · PROGRESSIVE CLUE</b>\n\n${escapeHtml(round.prompt)}\n\n${clueText}\n\n<i>⭐ ${points} pts available · ⏱ ${roundDurationSeconds(round)}s</i>`,
  }
}

export function renderClueRevealMessage(round: RoundMessageInput, clueNumber: 2 | 3) {
  const clue = round.clueData?.clues[clueNumber - 1]
  const points = projectQuizPoints(round, clueNumber)

  return {
    text: `<b>💡 CLUE ${clueNumber}</b>\n\n${escapeHtml(clue ?? '')}\n\n<i>${points} pts remaining</i>`,
  }
}

export function renderClueRoundAnswered(input: {
  readonly prompt: string
  readonly answer: string
  readonly clueNumber: 1 | 2 | 3
  readonly winner?: string
  readonly winnerMention?: string
  readonly points: number
}) {
  const winner = input.winner
    ? `\n\n<b>${input.winnerMention ?? escapeHtml(input.winner)} got it first</b>`
    : ''
  return `<b>✅ CORRECT · PROJECT QUIZ</b>\n\n${escapeHtml(input.prompt)}${winner}\n\nAnswer: <b>${escapeHtml(input.answer)}</b>\n\n<i>Answered on clue ${input.clueNumber}</i>\n<b>+${input.points} pts</b>`
}

export function renderFirstCorrectAnswered(input: {
  readonly prompt: string
  readonly answer: string
  readonly winner: string
  readonly winnerMention?: string
  readonly points: number
}) {
  return `<b>✅ CORRECT · PROJECT QUIZ</b>\n\n${escapeHtml(input.prompt)}\n\n${input.winnerMention ?? escapeHtml(input.winner)} got it first\n\nAnswer: <b>${escapeHtml(input.answer)}</b>\n\n<b>+${input.points} pts</b>`
}

export function renderProjectQuizAnswered(input: {
  readonly prompt: string
  readonly answer: string
  readonly winner: string
  readonly winnerMention?: string
  readonly points: number
  readonly rank?: number | null
}) {
  const rank = input.rank ? `\n<i>Current rank: #${input.rank}</i>` : ''
  return `<b>✅ CORRECT · PROJECT QUIZ</b>\n\n${escapeHtml(input.prompt)}\n\n${input.winnerMention ?? escapeHtml(input.winner)} got it first\n\nAnswer: <b>${escapeHtml(input.answer)}</b>\n\n<b>+${input.points} pts</b>${rank}`
}

export function renderQuizTimeout(input: {
  readonly prompt: string
  readonly answer: string
}): string {
  return `<b>⏱ TIME'S UP</b>\n\n${escapeHtml(input.prompt)}\n\nAnswer: <b>${escapeHtml(input.answer)}</b>`
}

export function renderQuizSummary(
  rows: readonly {
    readonly sequence: number
    readonly prompt: string
    readonly answer: string
    readonly winner?: string
    readonly points?: number | null
  }[],
): string {
  const lines = rows.map((row) => {
    const winner = row.winner
      ? `Winner: ${row.winner}${row.points ? ` · +${row.points}` : ''}`
      : 'No winner'
    return `${row.sequence}. ${escapeHtml(row.prompt)}\nAnswer: <b>${escapeHtml(row.answer)}</b>\n${winner}`
  })
  return `<b>🏁 QUIZ COMPLETE</b>\n\n${lines.join('\n\n')}`
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

function contentPresentation(
  round: RoundMessageInput,
  legacyPresentation: string,
): NonNullable<RoundMessageInput['presentationType']> {
  if (round.presentationType && round.presentationType !== 'TEXT') return round.presentationType
  if (legacyPresentation === 'multiple_choice') return 'MCQ'
  if (legacyPresentation === 'typed') return round.mode === 'CLUE' ? 'PROGRESSIVE_CLUE' : 'TEXT'
  if (round.mode === 'QUICK') return 'MCQ'
  if (round.mode === 'CLUE') return 'PROGRESSIVE_CLUE'
  return 'TEXT'
}

function presentationTitle(
  presentation: NonNullable<RoundMessageInput['presentationType']>,
): string {
  switch (presentation) {
    case 'MCQ':
      return '🧠 PROJECT QUIZ / RACE'
    case 'IMAGE_IDENTIFY':
      return '🖼️ PROJECT QUIZ / RACE · IMAGE IDENTIFY'
    case 'IMAGE_CLUE':
      return '🔍 PROJECT QUIZ / RACE · IMAGE CLUE'
    case 'MATH':
      return '➗ PROJECT QUIZ / RACE · MATH'
    case 'PROGRESSIVE_CLUE':
      return '💡 PROJECT QUIZ / RACE · PROGRESSIVE CLUE'
    case 'TEXT':
      return '🧠 PROJECT QUIZ / RACE'
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
