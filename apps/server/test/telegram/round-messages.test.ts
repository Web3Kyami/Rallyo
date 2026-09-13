import { describe, expect, it } from 'vitest'

import {
  clueNumberAt,
  quickQuizKeyboard,
  renderClueRevealMessage,
  renderClueRoundAnswered,
  renderFirstCorrectAnswered,
  renderProjectQuizAnswered,
  renderRoundMessage,
} from '../../src/telegram/round-messages'

const startsAt = new Date('2026-09-12T12:00:00.000Z')
const locksAt = new Date('2026-09-12T12:01:00.000Z')

describe('Telegram round messages', () => {
  it('renders escaped Quick Quiz content and stable answer callback data', () => {
    const message = renderRoundMessage({
      id: 'round-1',
      mode: 'QUICK',
      prompt: '<unsafe prompt>',
      options: [
        { label: 'Sign', value: 'sign a message' },
        { label: 'Send', value: 'send NIM' },
      ],
      clueData: null,
      basePoints: 20,
      startsAt,
      locksAt,
    })

    expect(message.text).toContain('&lt;unsafe prompt&gt;')
    expect(message.replyMarkup?.inline_keyboard).toEqual([
      [{ text: 'Sign', callback_data: 'player:quick:round-1:0' }],
      [{ text: 'Send', callback_data: 'player:quick:round-1:1' }],
    ])
  })

  it('reveals Clue Round clues by elapsed time', () => {
    const message = renderRoundMessage(
      {
        id: 'round-2',
        mode: 'CLUE',
        prompt: 'Guess the feature',
        options: null,
        clueData: { clues: ['one', 'two', 'three'] },
        basePoints: 30,
        startsAt,
        locksAt,
      },
      new Date('2026-09-12T12:00:30.000Z'),
    )

    expect(clueNumberAt({ startsAt, locksAt }, new Date('2026-09-12T12:00:30.000Z'))).toBe(2)
    expect(message.text).toContain('Clue 1')
    expect(message.text).toContain('Clue 2')
    expect(message.text).not.toContain('Clue 3')
  })

  it('crosses the clue reveal thresholds at one-third and two-thirds of the window', () => {
    const round = { startsAt, locksAt }

    expect(clueNumberAt(round, new Date('2026-09-12T12:00:19.999Z'))).toBe(1)
    expect(clueNumberAt(round, new Date('2026-09-12T12:00:20.000Z'))).toBe(2)
    expect(clueNumberAt(round, new Date('2026-09-12T12:00:39.999Z'))).toBe(2)
    expect(clueNumberAt(round, new Date('2026-09-12T12:00:40.000Z'))).toBe(3)
  })

  it('renders each later clue as a standalone notification', () => {
    const round = {
      id: 'round-4',
      mode: 'CLUE' as const,
      prompt: 'Guess the proof method.',
      options: null,
      clueData: { clues: ['first', 'second', 'third'] },
      basePoints: 30,
      startsAt,
      locksAt,
    }

    expect(renderClueRevealMessage(round, 2).text).toBe(
      '<b>CLUE 2</b>\n\n&gt; second\n\n<i>20 pts remaining</i>',
    )
    expect(renderClueRevealMessage(round, 3).text).toContain('<b>CLUE 3</b>')
    expect(renderClueRevealMessage(round, 3).text).toContain('10 pts remaining')
  })

  it('keeps a Clue result self-contained and clearly closed', () => {
    expect(
      renderClueRoundAnswered({
        prompt: 'Guess the proof method.',
        answer: 'sign a message',
        clueNumber: 2,
        points: 20,
      }),
    ).toContain('<b>🏆 CLUE ROUND — ANSWERED</b>')
    expect(
      renderClueRoundAnswered({
        prompt: 'Guess the proof method.',
        answer: 'sign a message',
        clueNumber: 2,
        points: 20,
      }),
    ).toContain('Answered on Clue 2')
  })

  it('creates an empty keyboard for non-option questions', () => {
    expect(quickQuizKeyboard('round-3', [])).toBeUndefined()
  })

  it('renders a rewarding First Correct winner message without losing the question', () => {
    expect(
      renderFirstCorrectAnswered({
        prompt: '<What proves control?>',
        answer: 'sign a message',
        winner: '@alice',
        points: 15,
      }),
    ).toBe(
      '<b>🏆 FIRST CORRECT — ANSWERED</b>\n\n&lt;What proves control?&gt;\n\n✅ <b>sign a message</b>\n\n<b>@alice got it first</b>\n✨ <b>+15 pts</b>',
    )
  })

  it('renders the Project Quiz race with typed-answer rules and rank', () => {
    const message = renderRoundMessage({
      id: 'project-round',
      mode: 'QUICK',
      presentation: 'typed',
      projectQuizConfig: {
        presentation: 'typed',
        hintsEnabled: false,
        hintTimingSeconds: [20, 40],
        startingPoints: 20,
        pointReductions: [0, 5, 10],
        answerTimeoutSeconds: 60,
        contentSource: 'ANY_APPROVED',
        automaticRounds: true,
      },
      prompt: 'Who gets the point?',
      options: null,
      clueData: null,
      basePoints: 15,
      startsAt,
      locksAt,
    })

    expect(message.text).toContain('<b>PROJECT QUIZ / RACE</b>')
    expect(message.text).toContain('First correct answer wins · 20 pts · 60 sec')
    expect(
      renderProjectQuizAnswered({
        prompt: 'Who gets the point?',
        answer: 'Alice',
        winner: '@alice',
        points: 20,
        rank: 4,
      }),
    ).toContain('Current rank: #4')
  })

  it('uses configured hint timings and reductions', () => {
    const round = {
      id: 'hint-round',
      mode: 'FIRST_CORRECT' as const,
      presentation: 'typed' as const,
      projectQuizConfig: {
        presentation: 'typed',
        hintsEnabled: true,
        hintTimingSeconds: [15, 35],
        startingPoints: 30,
        pointReductions: [0, 10, 20],
        answerTimeoutSeconds: 60,
        contentSource: 'ANY_APPROVED',
        automaticRounds: true,
      },
      prompt: 'Name the proof.',
      options: null,
      clueData: { clues: ['First', 'Second', 'Third'] },
      basePoints: 30,
      startsAt,
      locksAt,
    }

    expect(clueNumberAt(round, new Date('2026-09-12T12:00:15.000Z'))).toBe(2)
    expect(renderClueRevealMessage(round, 2).text).toContain('20 pts remaining')
  })
})
