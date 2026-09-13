import { describe, expect, it } from 'vitest'

import { parseScrambleConfig } from '../../src/games/scramble/config'
import {
  isScrambleableTerm,
  renderHintPattern,
  revealPositionsForHint,
  scrambleTerm,
  selectScrambleTerm,
} from '../../src/games/scramble/rules'
import {
  renderScrambleHint,
  renderScrambleStart,
  renderScrambleWinner,
} from '../../src/games/scramble/messages'

describe('Scramble rules', () => {
  it('scrambles terms without changing punctuation or producing the original answer', () => {
    const scrambled = scrambleTerm('Nimiq Pay!', () => 0)

    expect(scrambled).not.toBeNull()
    expect(scrambled).not.toBe('Nimiq Pay!')
    expect(scrambled).toMatch(/!$/u)
    expect(scrambled?.replace(/[^!]/gu, '')).toBe('!')
  })

  it('handles short, duplicate, and unusable terms safely', () => {
    expect(isScrambleableTerm('AI', 2, 15)).toBe(true)
    expect(isScrambleableTerm('AAA', 2, 15)).toBe(false)
    expect(isScrambleableTerm('?', 2, 15)).toBe(false)
    expect(scrambleTerm('AAA')).toBeNull()
  })

  it('avoids recent terms and falls back after the pool is exhausted', () => {
    const candidates = [
      { term: 'alpha', category: 'test' },
      { term: 'bravo', category: 'test' },
    ]
    const selected = selectScrambleTerm(candidates, new Set(['alpha']), { random: () => 0 })
    expect(selected?.term).toBe('bravo')

    const fallback = selectScrambleTerm(candidates, new Set(['alpha', 'bravo']), {
      random: () => 0,
    })
    expect(fallback?.term).toBe('alpha')
  })

  it('reveals progressive positional hints while retaining one hidden character', () => {
    const first = revealPositionsForHint('telegram', [], 1, 2)
    const second = revealPositionsForHint('telegram', first, 2, 2)
    expect(renderHintPattern('telegram', first)).toBe('tele????')
    expect(renderHintPattern('telegram', second)).toBe('telegra?')
  })

  it('normalizes configuration aliases and rejects deductions', () => {
    expect(
      parseScrambleConfig({ source: 'project', maxHints: 1, hintTimingSeconds: [10] }),
    ).toMatchObject({
      source: 'PROJECT_BRAIN',
      maxHints: 1,
    })
    expect(() =>
      parseScrambleConfig({
        points: 3,
        maxHints: 1,
        pointReductions: [3],
        hintTimingSeconds: [10],
      }),
    ).toThrow('leave at least one point')
  })
})

describe('Scramble Telegram messages', () => {
  const round = {
    id: 'round-1',
    communityId: 'community-1',
    seasonId: 'season-1',
    source: 'GENERAL' as const,
    sourceTermId: null,
    term: '<Nimiq Pay>',
    normalizedAnswer: 'nimiq pay',
    scrambledTerm: 'Pay Nimiq',
    category: '<Project>',
    status: 'LIVE' as const,
    startsAt: new Date('2026-09-13T12:00:00.000Z'),
    locksAt: new Date('2026-09-13T12:01:00.000Z'),
    points: 10,
    pointsRemaining: 10,
    hintsEnabled: true,
    maxHints: 2,
    hintCount: 0,
    hintTimingSeconds: [20, 40],
    pointReductions: [2, 4],
    revealedPositions: [],
    winnerPlayerId: null,
    telegramMessageId: null,
    outcomeNotifiedAt: null,
    endedAt: null,
    createdAt: new Date('2026-09-13T12:00:00.000Z'),
  }

  it('escapes challenge and winner content', () => {
    expect(renderScrambleStart(round)).toContain('&lt;Project&gt;')
    expect(renderScrambleStart(round)).toContain('Pay Nimiq')
    expect(
      renderScrambleWinner({ round: { ...round, pointsRemaining: 8 }, winner: '<alice>' }),
    ).toContain('&lt;alice&gt;')
    expect(
      renderScrambleHint({ hint: '<N?miq>', hintNumber: 1, maxHints: 2, pointsRemaining: 8 }),
    ).toContain('&lt;N?miq&gt;')
  })
})
