import { matchesAcceptedAnswer, normalizeAnswer } from './answer-normalization'
import { scoreEventKey, type ScoreEvent } from './scoring'

export type InMemoryRound = {
  readonly id: string
  readonly communityId: string
  readonly seasonId: string
  readonly questionId: string
  state: 'LIVE' | 'LOCKED'
}

export type AnswerResult =
  'ACCEPTED' | 'DUPLICATE_UPDATE' | 'DUPLICATE_ANSWER' | 'ROUND_CLOSED' | 'WRONG'

export type FirstCorrectResult = AnswerResult | 'WON'

export class InMemoryGameStore {
  readonly #processedUpdateIds = new Set<string>()
  readonly #answerKeys = new Set<string>()
  readonly #scoreEventKeys = new Set<string>()
  readonly #scoreEvents: ScoreEvent[] = []

  processQuickQuizAnswer(input: {
    readonly updateId: string
    readonly round: InMemoryRound
    readonly playerId: string
    readonly rawAnswer: string
    readonly correctAnswer: string
    readonly points: number
    readonly now: Date
  }): AnswerResult {
    if (!this.#registerUpdate(input.updateId)) {
      return 'DUPLICATE_UPDATE'
    }

    if (input.round.state !== 'LIVE') {
      return 'ROUND_CLOSED'
    }

    if (!this.#registerAnswer(input.round.id, input.playerId)) {
      return 'DUPLICATE_ANSWER'
    }

    if (normalizeAnswer(input.rawAnswer) !== normalizeAnswer(input.correctAnswer)) {
      return 'WRONG'
    }

    this.#award(input.round, input.playerId, input.points, input.now)
    return 'ACCEPTED'
  }

  claimFirstCorrect(input: {
    readonly updateId: string
    readonly round: InMemoryRound
    readonly playerId: string
    readonly rawAnswer: string
    readonly acceptedAnswers: readonly string[]
    readonly points: number
    readonly now: Date
  }): FirstCorrectResult {
    if (!this.#registerUpdate(input.updateId)) {
      return 'DUPLICATE_UPDATE'
    }

    if (input.round.state !== 'LIVE') {
      return 'ROUND_CLOSED'
    }

    if (!this.#registerAnswer(input.round.id, input.playerId)) {
      return 'DUPLICATE_ANSWER'
    }

    if (!matchesAcceptedAnswer(input.rawAnswer, input.acceptedAnswers)) {
      return 'WRONG'
    }

    input.round.state = 'LOCKED'
    this.#award(input.round, input.playerId, input.points, input.now)
    return 'WON'
  }

  get scoreEvents(): readonly ScoreEvent[] {
    return this.#scoreEvents
  }

  #registerUpdate(updateId: string): boolean {
    if (this.#processedUpdateIds.has(updateId)) {
      return false
    }

    this.#processedUpdateIds.add(updateId)
    return true
  }

  #registerAnswer(roundId: string, playerId: string): boolean {
    const answerKey = `${roundId}:${playerId}`

    if (this.#answerKeys.has(answerKey)) {
      return false
    }

    this.#answerKeys.add(answerKey)
    return true
  }

  #award(round: InMemoryRound, playerId: string, points: number, createdAt: Date): void {
    const idempotencyKey = scoreEventKey(round.id, playerId)

    if (this.#scoreEventKeys.has(idempotencyKey)) {
      return
    }

    this.#scoreEventKeys.add(idempotencyKey)
    this.#scoreEvents.push({
      id: idempotencyKey,
      playerId,
      communityId: round.communityId,
      seasonId: round.seasonId,
      roundId: round.id,
      questionId: round.questionId,
      delta: points,
      idempotencyKey,
      createdAt,
    })
  }
}
