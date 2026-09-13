import { describe, expect, it } from 'vitest'

import { InMemoryGameStore } from '../src/in-memory-game-store'
import { isQuestionCoolingDown } from '../src/question-cooldown'
import { InvalidRoundTransitionError, transitionRound } from '../src/round-state'
import { isSeasonActiveAt } from '../src/season'
import { leaderboardForSeason, lifetimeXpForPlayer } from '../src/scoring'

const now = new Date('2026-09-12T12:00:00.000Z')

function liveRound() {
  return {
    id: 'round-1',
    communityId: 'community-1',
    seasonId: 'season-1',
    questionId: 'question-1',
    state: 'LIVE' as const,
  }
}

describe('round state machine', () => {
  it('cannot transition a round backwards', () => {
    expect(() => transitionRound('LOCKED', 'LIVE')).toThrow(InvalidRoundTransitionError)
  })
})

describe('season boundaries', () => {
  it('accepts only active seasons containing the current instant', () => {
    expect(
      isSeasonActiveAt(
        {
          startsAt: new Date('2026-09-12T11:00:00.000Z'),
          endsAt: new Date('2026-09-12T13:00:00.000Z'),
          status: 'ACTIVE',
        },
        now,
      ),
    ).toBe(true)

    expect(
      isSeasonActiveAt(
        {
          startsAt: new Date('2026-09-12T10:00:00.000Z'),
          endsAt: now,
          status: 'ACTIVE',
        },
        now,
      ),
    ).toBe(false)
  })
})

describe('deterministic scoring', () => {
  it('rejects a duplicate player answer and only awards one score event', () => {
    const store = new InMemoryGameStore()
    const round = liveRound()

    expect(
      store.processQuickQuizAnswer({
        updateId: 'update-1',
        round,
        playerId: 'player-1',
        rawAnswer: 'Sign a message',
        correctAnswer: 'sign a message',
        points: 20,
        now,
      }),
    ).toBe('ACCEPTED')

    expect(
      store.processQuickQuizAnswer({
        updateId: 'update-2',
        round,
        playerId: 'player-1',
        rawAnswer: 'sign a message',
        correctAnswer: 'sign a message',
        points: 20,
        now,
      }),
    ).toBe('DUPLICATE_ANSWER')

    expect(store.scoreEvents).toHaveLength(1)
  })

  it('treats a replayed Telegram update as harmless', () => {
    const store = new InMemoryGameStore()
    const round = liveRound()
    const answer = {
      updateId: 'update-replayed',
      round,
      playerId: 'player-1',
      rawAnswer: 'Sign a message',
      correctAnswer: 'sign a message',
      points: 20,
      now,
    }

    expect(store.processQuickQuizAnswer(answer)).toBe('ACCEPTED')
    expect(store.processQuickQuizAnswer(answer)).toBe('DUPLICATE_UPDATE')
    expect(store.scoreEvents).toHaveLength(1)
  })

  it('allows only one First Correct winner', () => {
    const store = new InMemoryGameStore()
    const round = liveRound()

    expect(
      store.claimFirstCorrect({
        updateId: 'update-1',
        round,
        playerId: 'player-1',
        rawAnswer: 'Sign a message',
        acceptedAnswers: ['signMessage', 'sign a message'],
        points: 15,
        now,
      }),
    ).toBe('WON')

    expect(
      store.claimFirstCorrect({
        updateId: 'update-2',
        round,
        playerId: 'player-2',
        rawAnswer: 'signMessage',
        acceptedAnswers: ['signMessage', 'sign a message'],
        points: 15,
        now,
      }),
    ).toBe('ROUND_CLOSED')

    expect(store.scoreEvents).toHaveLength(1)
    expect(store.scoreEvents[0]?.playerId).toBe('player-1')
  })

  it('rejects an answer after a round is locked', () => {
    const store = new InMemoryGameStore()
    const round = { ...liveRound(), state: 'LOCKED' as const }

    expect(
      store.processQuickQuizAnswer({
        updateId: 'update-1',
        round,
        playerId: 'player-1',
        rawAnswer: 'sign a message',
        correctAnswer: 'sign a message',
        points: 20,
        now,
      }),
    ).toBe('ROUND_CLOSED')
  })

  it('derives season leaderboard and lifetime XP from score events', () => {
    const events = [
      {
        id: 'event-1',
        playerId: 'player-1',
        communityId: 'community-1',
        seasonId: 'season-1',
        roundId: 'round-1',
        questionId: 'question-1',
        delta: 20,
        idempotencyKey: 'key-1',
        createdAt: now,
      },
      {
        id: 'event-2',
        playerId: 'player-2',
        communityId: 'community-1',
        seasonId: 'season-1',
        roundId: 'round-2',
        questionId: 'question-2',
        delta: 30,
        idempotencyKey: 'key-2',
        createdAt: now,
      },
      {
        id: 'event-3',
        playerId: 'player-1',
        communityId: 'community-1',
        seasonId: 'season-0',
        roundId: 'round-0',
        questionId: 'question-0',
        delta: 10,
        idempotencyKey: 'key-3',
        createdAt: now,
      },
    ]

    expect(leaderboardForSeason(events, 'community-1', 'season-1')).toEqual([
      { playerId: 'player-2', points: 30, rank: 1 },
      { playerId: 'player-1', points: 20, rank: 2 },
    ])
    expect(lifetimeXpForPlayer(events, 'player-1')).toBe(30)
  })

  it('excludes questions used within the community cooldown window', () => {
    expect(
      isQuestionCoolingDown(
        'question-1',
        'community-1',
        [{ questionId: 'question-1', communityId: 'community-1', usedAt: new Date('2026-08-20') }],
        30,
        now,
      ),
    ).toBe(true)

    expect(
      isQuestionCoolingDown(
        'question-1',
        'community-2',
        [{ questionId: 'question-1', communityId: 'community-1', usedAt: new Date('2026-09-11') }],
        30,
        now,
      ),
    ).toBe(false)
  })
})
