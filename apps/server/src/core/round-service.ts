import { matchesAcceptedAnswer, normalizeAnswer, scoreEventKey } from '@rallyo/core'
import { and, desc, eq, gt, gte, lte, lt, or, sql } from 'drizzle-orm'
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres'
import type { ExtractTablesWithRelations } from 'drizzle-orm'

import * as schema from '../db/schema'
import { claimTelegramUpdate } from '../db/telegram-updates'
import {
  DEFAULT_PROJECT_QUIZ_CONFIG,
  parseProjectQuizConfig,
  type ProjectQuizConfig,
} from './community-game-config-service'
import { awardScoreEvent } from './score-event-service'
import type { CommunityGameConfigService } from './community-game-config-service'

type Database = NodePgDatabase<typeof schema>
type Transaction = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>

export type AnswerSubmissionResult =
  | { readonly status: 'ACCEPTED'; readonly points: number }
  | { readonly status: 'DUPLICATE_UPDATE' | 'DUPLICATE_ANSWER' | 'ROUND_CLOSED' | 'WRONG' }

export type FirstCorrectSubmissionResult =
  | { readonly status: 'WON'; readonly points: number }
  | { readonly status: 'DUPLICATE_UPDATE' | 'DUPLICATE_ANSWER' | 'ROUND_CLOSED' | 'WRONG' }

export type ClueRoundSubmissionResult =
  | { readonly status: 'WON'; readonly points: number }
  | { readonly status: 'DUPLICATE_UPDATE' | 'DUPLICATE_ANSWER' | 'ROUND_CLOSED' | 'WRONG' }

export class ScoreAwardError extends Error {
  constructor(roundId: string, playerId: string) {
    super(`Score event for round ${roundId} and player ${playerId} was not created.`)
    this.name = 'ScoreAwardError'
  }
}

export class RoundStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoundStartError'
  }
}

export class RoundService {
  constructor(
    private readonly database: Database,
    private readonly gameConfigurations?: CommunityGameConfigService,
  ) {}

  async startLiveRound(input: {
    readonly communityId: string
    readonly seasonId: string
    readonly quizId?: string
    readonly questionId: string
    readonly startsAt: Date
    readonly locksAt?: Date
    readonly now: Date
  }) {
    const projectQuizConfiguration = this.gameConfigurations
      ? await this.gameConfigurations.getProjectQuizConfig(input.communityId)
      : { row: null, configured: false, config: DEFAULT_PROJECT_QUIZ_CONFIG }
    const locksAt =
      input.locksAt ??
      new Date(
        input.startsAt.getTime() + projectQuizConfiguration.config.answerTimeoutSeconds * 1_000,
      )

    if (this.gameConfigurations) {
      await this.gameConfigurations.requireEnabled(input.communityId, 'project_quiz')
    }

    if (input.startsAt > input.now) {
      throw new RoundStartError('Live round start time cannot be in the future.')
    }

    if (locksAt <= input.startsAt) {
      throw new RoundStartError('Round lock time must be after its start time.')
    }

    return this.database.transaction(async (tx) => {
      const [community] = await tx
        .select({ id: schema.communities.id, status: schema.communities.status })
        .from(schema.communities)
        .where(eq(schema.communities.id, input.communityId))
        .for('update')

      if (!community || community.status !== 'ACTIVE') {
        throw new RoundStartError('Community is not active.')
      }

      const [season] = await tx
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(
          and(
            eq(schema.seasons.id, input.seasonId),
            eq(schema.seasons.communityId, input.communityId),
            eq(schema.seasons.status, 'ACTIVE'),
            lte(schema.seasons.startsAt, input.startsAt),
            gte(schema.seasons.endsAt, locksAt),
          ),
        )

      if (!season) {
        throw new RoundStartError('Season is not active for the requested round window.')
      }

      const [question] = await tx
        .select({ id: schema.questions.id })
        .from(schema.questions)
        .where(
          and(
            eq(schema.questions.id, input.questionId),
            eq(schema.questions.status, 'APPROVED'),
            ...(projectQuizConfiguration.configured
              ? [projectQuizSourceCondition(projectQuizConfiguration.config.contentSource)]
              : []),
            or(
              eq(schema.questions.scope, 'GLOBAL'),
              and(
                eq(schema.questions.scope, 'COMMUNITY'),
                eq(schema.questions.communityId, input.communityId),
              ),
            ),
          ),
        )

      if (!question) {
        throw new RoundStartError('Question is not approved for this community.')
      }

      const [questionRules] = await tx
        .select({
          mode: schema.questions.mode,
          basePoints: schema.questions.basePoints,
          options: schema.questions.options,
          clueData: schema.questions.clueData,
        })
        .from(schema.questions)
        .where(eq(schema.questions.id, input.questionId))

      if (!questionRules) {
        throw new RoundStartError('Question could not be loaded for this round.')
      }

      const roundRules = resolveRoundRules(
        questionRules,
        projectQuizConfiguration.config,
        projectQuizConfiguration.configured,
        this.gameConfigurations !== undefined,
      )

      if (roundRules.presentation === 'multiple_choice' && !questionRules.options?.length) {
        throw new RoundStartError('Multiple-choice Project Quiz questions need answer options.')
      }

      const [existingRound] = await tx
        .select({ id: schema.rounds.id })
        .from(schema.rounds)
        .where(
          and(
            eq(schema.rounds.communityId, input.communityId),
            eq(schema.rounds.state, 'LIVE'),
            lte(schema.rounds.startsAt, input.now),
            gt(schema.rounds.locksAt, input.startsAt),
          ),
        )
        .limit(1)

      if (existingRound) {
        throw new RoundStartError('Community already has a live round.')
      }

      const [round] = await tx
        .insert(schema.rounds)
        .values({
          communityId: input.communityId,
          seasonId: input.seasonId,
          ...(input.quizId ? { quizId: input.quizId } : {}),
          questionId: input.questionId,
          state: 'LIVE',
          startsAt: input.startsAt,
          locksAt,
          ...(roundRules.config
            ? {
                presentation: roundRules.presentation,
                projectQuizConfig: roundRules.config,
              }
            : {}),
        })
        .returning()

      if (!round) {
        throw new RoundStartError('Round could not be created.')
      }

      await tx.insert(schema.questionUsages).values({
        questionId: input.questionId,
        communityId: input.communityId,
        roundId: round.id,
        usedAt: input.startsAt,
      })

      return round
    })
  }

  async attachTelegramMessageId(roundId: string, telegramMessageId: bigint): Promise<boolean> {
    const rows = await this.database
      .update(schema.rounds)
      .set({ telegramMessageId: telegramMessageId, version: sql`${schema.rounds.version} + 1` })
      .where(
        and(
          eq(schema.rounds.id, roundId),
          eq(schema.rounds.state, 'LIVE'),
          sql`${schema.rounds.telegramMessageId} IS NULL`,
        ),
      )
      .returning({ id: schema.rounds.id })

    return rows.length > 0
  }

  async submitQuickQuizAnswer(input: {
    readonly telegramUpdateId: bigint
    readonly telegramInputId: string
    readonly roundId: string
    readonly playerId: string
    readonly rawAnswer: string
    readonly now: Date
    readonly updateAlreadyClaimed?: boolean
  }): Promise<AnswerSubmissionResult> {
    return this.database.transaction(async (tx) => {
      if (!input.updateAlreadyClaimed && !(await claimTelegramUpdate(tx, input.telegramUpdateId))) {
        return { status: 'DUPLICATE_UPDATE' }
      }

      const round = await getLiveRound(tx, input.roundId, input.now)

      if (!round) {
        return { status: 'ROUND_CLOSED' }
      }

      if (round.presentation === 'multiple_choice') {
        return claimConfiguredMultipleChoiceWinner(tx, round, input)
      }

      if (round.mode !== 'QUICK') {
        return { status: 'ROUND_CLOSED' }
      }

      const normalizedAnswer = normalizeAnswer(input.rawAnswer)
      const isCorrect = normalizedAnswer === normalizeAnswer(round.correctAnswer)
      const insertedAnswers = await tx
        .insert(schema.answers)
        .values({
          roundId: round.id,
          playerId: input.playerId,
          telegramInputId: input.telegramInputId,
          rawAnswer: input.rawAnswer,
          normalizedAnswer,
          isCorrect,
        })
        .onConflictDoNothing({ target: [schema.answers.roundId, schema.answers.playerId] })
        .returning({ id: schema.answers.id })

      if (insertedAnswers.length === 0) {
        return { status: 'DUPLICATE_ANSWER' }
      }

      if (!isCorrect) {
        return { status: 'WRONG' }
      }

      await awardScore(tx, round, input.playerId, round.basePoints)
      return { status: 'ACCEPTED', points: round.basePoints }
    })
  }

  async claimFirstCorrect(input: {
    readonly telegramUpdateId: bigint
    readonly telegramInputId: string
    readonly roundId: string
    readonly playerId: string
    readonly rawAnswer: string
    readonly now: Date
    readonly updateAlreadyClaimed?: boolean
  }): Promise<FirstCorrectSubmissionResult> {
    return this.claimProjectQuizAnswer(input)
  }

  async claimProjectQuizAnswer(input: {
    readonly telegramUpdateId: bigint
    readonly telegramInputId: string
    readonly roundId: string
    readonly playerId: string
    readonly rawAnswer: string
    readonly clueNumber?: 1 | 2 | 3
    readonly now: Date
    readonly updateAlreadyClaimed?: boolean
  }): Promise<FirstCorrectSubmissionResult> {
    return this.database.transaction(async (tx) => {
      if (!input.updateAlreadyClaimed && !(await claimTelegramUpdate(tx, input.telegramUpdateId))) {
        return { status: 'DUPLICATE_UPDATE' }
      }

      const round = await getLiveRound(tx, input.roundId, input.now)
      if (!round) return { status: 'ROUND_CLOSED' }

      const presentation = effectivePresentation(round)
      if (presentation !== 'typed') return { status: 'ROUND_CLOSED' }
      if (!round.presentation && round.mode !== 'FIRST_CORRECT' && round.mode !== 'CLUE') {
        return { status: 'ROUND_CLOSED' }
      }
      if (input.clueNumber && round.clueData && input.clueNumber > round.clueData.clues.length) {
        return { status: 'ROUND_CLOSED' }
      }
      if (round.mode === 'CLUE' && (!round.clueData || !input.clueNumber)) {
        return { status: 'ROUND_CLOSED' }
      }

      if (!matchesAcceptedAnswer(input.rawAnswer, round.acceptedAnswers)) {
        return { status: 'WRONG' }
      }

      const lockedRounds = await tx
        .update(schema.rounds)
        .set({
          state: 'LOCKED',
          version: sql`${schema.rounds.version} + 1`,
        })
        .where(
          and(
            eq(schema.rounds.id, round.id),
            eq(schema.rounds.state, 'LIVE'),
            gt(schema.rounds.locksAt, input.now),
          ),
        )
        .returning({ id: schema.rounds.id })

      if (lockedRounds.length === 0) return { status: 'ROUND_CLOSED' }

      const insertedAnswers = await tx
        .insert(schema.answers)
        .values({
          roundId: round.id,
          playerId: input.playerId,
          telegramInputId: input.telegramInputId,
          rawAnswer: input.rawAnswer,
          normalizedAnswer: normalizeAnswer(input.rawAnswer),
          isCorrect: true,
        })
        .onConflictDoNothing({ target: [schema.answers.roundId, schema.answers.playerId] })
        .returning({ id: schema.answers.id })

      if (insertedAnswers.length === 0) throw new ScoreAwardError(round.id, input.playerId)

      const points = pointsForRound(
        round,
        input.clueNumber ?? configuredClueNumberAt(round, input.now),
      )
      await awardScore(tx, round, input.playerId, points)
      return { status: 'WON', points }
    })
  }

  async claimClueRoundAnswer(input: {
    readonly telegramUpdateId: bigint
    readonly telegramInputId: string
    readonly roundId: string
    readonly playerId: string
    readonly rawAnswer: string
    readonly clueNumber: 1 | 2 | 3
    readonly now: Date
    readonly updateAlreadyClaimed?: boolean
  }): Promise<ClueRoundSubmissionResult> {
    return this.claimProjectQuizAnswer(input)
  }

  async liveRoundForCommunity(communityId: string, now: Date) {
    const rows = await this.database
      .select({
        id: schema.rounds.id,
        communityId: schema.rounds.communityId,
        seasonId: schema.rounds.seasonId,
        questionId: schema.rounds.questionId,
        state: schema.rounds.state,
        startsAt: schema.rounds.startsAt,
        locksAt: schema.rounds.locksAt,
        presentation: schema.rounds.presentation,
        projectQuizConfig: schema.rounds.projectQuizConfig,
        telegramMessageId: schema.rounds.telegramMessageId,
        mode: schema.questions.mode,
        prompt: schema.questions.prompt,
        options: schema.questions.options,
        correctAnswer: schema.questions.correctAnswer,
        acceptedAnswers: schema.questions.acceptedAnswers,
        clueData: schema.questions.clueData,
        basePoints: schema.questions.basePoints,
      })
      .from(schema.rounds)
      .innerJoin(schema.questions, eq(schema.rounds.questionId, schema.questions.id))
      .innerJoin(schema.seasons, eq(schema.rounds.seasonId, schema.seasons.id))
      .where(
        and(
          eq(schema.rounds.communityId, communityId),
          eq(schema.rounds.state, 'LIVE'),
          lte(schema.rounds.startsAt, now),
          gt(schema.rounds.locksAt, now),
          eq(schema.seasons.status, 'ACTIVE'),
          lte(schema.seasons.startsAt, now),
          gt(schema.seasons.endsAt, now),
        ),
      )
      .orderBy(desc(schema.rounds.startsAt))
      .limit(1)

    return rows[0] ?? null
  }

  async lockedRoundForCommunity(communityId: string, now: Date) {
    const rows = await this.database
      .select({
        id: schema.rounds.id,
        communityId: schema.rounds.communityId,
        seasonId: schema.rounds.seasonId,
        questionId: schema.rounds.questionId,
        state: schema.rounds.state,
        startsAt: schema.rounds.startsAt,
        locksAt: schema.rounds.locksAt,
        presentation: schema.rounds.presentation,
        projectQuizConfig: schema.rounds.projectQuizConfig,
        telegramMessageId: schema.rounds.telegramMessageId,
        mode: schema.questions.mode,
        prompt: schema.questions.prompt,
        options: schema.questions.options,
        correctAnswer: schema.questions.correctAnswer,
        acceptedAnswers: schema.questions.acceptedAnswers,
        clueData: schema.questions.clueData,
        basePoints: schema.questions.basePoints,
      })
      .from(schema.rounds)
      .innerJoin(schema.questions, eq(schema.rounds.questionId, schema.questions.id))
      .innerJoin(schema.seasons, eq(schema.rounds.seasonId, schema.seasons.id))
      .where(
        and(
          eq(schema.rounds.communityId, communityId),
          eq(schema.rounds.state, 'LOCKED'),
          gt(schema.rounds.locksAt, now),
          eq(schema.seasons.status, 'ACTIVE'),
          lte(schema.seasons.startsAt, now),
          gt(schema.seasons.endsAt, now),
        ),
      )
      .orderBy(desc(schema.rounds.startsAt))
      .limit(1)

    return rows[0] ?? null
  }

  async clueRoundsForReveal(now: Date) {
    return this.database
      .select({
        id: schema.rounds.id,
        communityId: schema.rounds.communityId,
        telegramChatId: schema.communities.telegramChatId,
        startsAt: schema.rounds.startsAt,
        locksAt: schema.rounds.locksAt,
        presentation: schema.rounds.presentation,
        projectQuizConfig: schema.rounds.projectQuizConfig,
        telegramMessageId: schema.rounds.telegramMessageId,
        clueNumberPresented: schema.rounds.clueNumberPresented,
        mode: schema.questions.mode,
        prompt: schema.questions.prompt,
        options: schema.questions.options,
        correctAnswer: schema.questions.correctAnswer,
        acceptedAnswers: schema.questions.acceptedAnswers,
        clueData: schema.questions.clueData,
        basePoints: schema.questions.basePoints,
      })
      .from(schema.rounds)
      .innerJoin(schema.communities, eq(schema.rounds.communityId, schema.communities.id))
      .innerJoin(schema.questions, eq(schema.rounds.questionId, schema.questions.id))
      .innerJoin(schema.seasons, eq(schema.rounds.seasonId, schema.seasons.id))
      .where(
        and(
          eq(schema.rounds.state, 'LIVE'),
          sql`${schema.questions.clueData} IS NOT NULL`,
          lte(schema.rounds.startsAt, now),
          gt(schema.rounds.locksAt, now),
          sql`${schema.rounds.telegramMessageId} IS NOT NULL`,
          lt(schema.rounds.clueNumberPresented, 3),
          eq(schema.communities.status, 'ACTIVE'),
          eq(schema.seasons.status, 'ACTIVE'),
          lte(schema.seasons.startsAt, now),
          gt(schema.seasons.endsAt, now),
        ),
      )
      .orderBy(schema.rounds.startsAt)
  }

  async markClueNumberPresented(roundId: string, clueNumber: 1 | 2 | 3): Promise<boolean> {
    const rows = await this.database
      .update(schema.rounds)
      .set({ clueNumberPresented: clueNumber, version: sql`${schema.rounds.version} + 1` })
      .where(
        and(
          eq(schema.rounds.id, roundId),
          eq(schema.rounds.state, 'LIVE'),
          lt(schema.rounds.clueNumberPresented, clueNumber),
        ),
      )
      .returning({ id: schema.rounds.id })

    return rows.length > 0
  }

  async leaderboardForSeason(communityId: string, seasonId: string) {
    const points = sql<string>`sum(${schema.scoreEvents.delta})`.as('points')
    const rows = await this.database
      .select({ playerId: schema.scoreEvents.playerId, points })
      .from(schema.scoreEvents)
      .where(
        and(
          eq(schema.scoreEvents.communityId, communityId),
          eq(schema.scoreEvents.seasonId, seasonId),
        ),
      )
      .groupBy(schema.scoreEvents.playerId)
      .orderBy(desc(points), schema.scoreEvents.playerId)

    return rows.map((row, index) => ({
      playerId: row.playerId,
      points: parseScoreTotal(row.points),
      rank: index + 1,
    }))
  }

  async lifetimeXpForPlayer(playerId: string): Promise<number> {
    const result = await this.database
      .select({ points: sql<string>`coalesce(sum(${schema.scoreEvents.delta}), 0)` })
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.playerId, playerId))

    return parseScoreTotal(result[0]?.points ?? '0')
  }

  async rankForPlayerInSeason(
    communityId: string,
    seasonId: string,
    playerId: string,
  ): Promise<number | null> {
    const leaderboard = await this.leaderboardForSeason(communityId, seasonId)
    return leaderboard.find((row) => row.playerId === playerId)?.rank ?? null
  }

  async selectEligibleQuestions(input: {
    readonly communityId: string
    readonly cooldownDays: number
    readonly now: Date
    readonly mode: (typeof schema.questionMode.enumValues)[number]
    readonly limit: number
  }) {
    const cutoff = new Date(input.now.getTime() - input.cooldownDays * 24 * 60 * 60 * 1000)
    const recentlyUsed = this.database
      .select({ id: schema.questionUsages.id })
      .from(schema.questionUsages)
      .where(
        and(
          eq(schema.questionUsages.communityId, input.communityId),
          eq(schema.questionUsages.questionId, schema.questions.id),
          gte(schema.questionUsages.usedAt, cutoff),
        ),
      )

    return this.database
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.status, 'APPROVED'),
          eq(schema.questions.mode, input.mode),
          or(
            eq(schema.questions.scope, 'GLOBAL'),
            and(
              eq(schema.questions.scope, 'COMMUNITY'),
              eq(schema.questions.communityId, input.communityId),
            ),
          ),
          sql`not exists (${recentlyUsed})`,
        ),
      )
      .limit(input.limit)
  }
}

function parseScoreTotal(value: string | number): number {
  const points = Number(value)

  if (!Number.isSafeInteger(points) || points < 0) {
    throw new Error('Score total is outside the supported integer range.')
  }

  return points
}

function projectQuizSourceCondition(contentSource: ProjectQuizConfig['contentSource']) {
  switch (contentSource) {
    case 'PROJECT_BRAIN':
      return eq(schema.questions.source, 'PROJECT_AI')
    case 'CURATED_DEFAULT':
      return eq(schema.questions.source, 'DEFAULT')
    case 'MANUAL':
      return eq(schema.questions.source, 'MANUAL')
    case 'ANY_APPROVED':
      return sql`true`
  }
}

function resolveRoundRules(
  question: {
    readonly mode: (typeof schema.questionMode.enumValues)[number]
    readonly basePoints: number
  },
  config: ProjectQuizConfig,
  configured: boolean,
  useProjectQuizDefault: boolean,
): {
  readonly presentation: ProjectQuizConfig['presentation']
  readonly config?: ProjectQuizConfig
} {
  if (configured) {
    return { presentation: config.presentation, config }
  }

  if (useProjectQuizDefault && question.mode === 'CLUE') {
    return {
      presentation: 'typed',
      config: {
        ...config,
        hintsEnabled: true,
        startingPoints: 30,
        pointReductions: [0, 10, 20],
      },
    }
  }

  if (useProjectQuizDefault) {
    return {
      presentation: 'typed',
      config: { ...config, startingPoints: question.basePoints },
    }
  }

  return {
    presentation: 'typed',
  }
}

function effectivePresentation(round: {
  readonly presentation: string | null
  readonly mode: (typeof schema.questionMode.enumValues)[number]
}): ProjectQuizConfig['presentation'] {
  if (round.presentation === 'multiple_choice') return 'multiple_choice'
  if (round.presentation === 'typed') return 'typed'
  return round.mode === 'QUICK' ? 'multiple_choice' : 'typed'
}

function pointsForRound(
  round: {
    readonly mode: (typeof schema.questionMode.enumValues)[number]
    readonly basePoints: number
    readonly projectQuizConfig: schema.CapabilityConfig | null
  },
  clueNumber?: 1 | 2 | 3,
): number {
  if (round.projectQuizConfig) {
    const config = parseProjectQuizConfig(round.projectQuizConfig)
    const reductionIndex = Math.max(0, (clueNumber ?? 1) - 1)
    const reduction = config.hintsEnabled
      ? (config.pointReductions[reductionIndex] ?? config.pointReductions.at(-1) ?? 0)
      : 0
    return Math.max(1, config.startingPoints - reduction)
  }

  if (round.mode === 'CLUE' && clueNumber) {
    return [30, 20, 10][clueNumber - 1] ?? round.basePoints
  }

  return round.basePoints
}

function configuredClueNumberAt(
  round: {
    readonly projectQuizConfig: schema.CapabilityConfig | null
    readonly startsAt?: Date
  },
  now: Date,
): 1 | 2 | 3 {
  if (!round.projectQuizConfig || !round.startsAt) return 1

  const config = parseProjectQuizConfig(round.projectQuizConfig)
  if (!config.hintsEnabled) return 1

  const elapsedSeconds = Math.max(0, now.getTime() - round.startsAt.getTime()) / 1_000
  if (config.hintTimingSeconds[1] !== undefined && elapsedSeconds >= config.hintTimingSeconds[1]) {
    return 3
  }
  if (config.hintTimingSeconds[0] !== undefined && elapsedSeconds >= config.hintTimingSeconds[0]) {
    return 2
  }
  return 1
}

async function claimConfiguredMultipleChoiceWinner(
  database: Transaction,
  round: {
    readonly id: string
    readonly communityId: string
    readonly seasonId: string
    readonly questionId: string
    readonly startsAt: Date
    readonly mode: (typeof schema.questionMode.enumValues)[number]
    readonly basePoints: number
    readonly acceptedAnswers: readonly string[]
    readonly projectQuizConfig: schema.CapabilityConfig | null
  },
  input: {
    readonly telegramInputId: string
    readonly playerId: string
    readonly rawAnswer: string
    readonly now: Date
  },
): Promise<AnswerSubmissionResult> {
  if (!matchesAcceptedAnswer(input.rawAnswer, round.acceptedAnswers)) {
    const insertedAnswers = await database
      .insert(schema.answers)
      .values({
        roundId: round.id,
        playerId: input.playerId,
        telegramInputId: input.telegramInputId,
        rawAnswer: input.rawAnswer,
        normalizedAnswer: normalizeAnswer(input.rawAnswer),
        isCorrect: false,
      })
      .onConflictDoNothing({ target: [schema.answers.roundId, schema.answers.playerId] })
      .returning({ id: schema.answers.id })

    return insertedAnswers.length === 0 ? { status: 'DUPLICATE_ANSWER' } : { status: 'WRONG' }
  }

  const lockedRounds = await database
    .update(schema.rounds)
    .set({ state: 'LOCKED', version: sql`${schema.rounds.version} + 1` })
    .where(
      and(
        eq(schema.rounds.id, round.id),
        eq(schema.rounds.state, 'LIVE'),
        gt(schema.rounds.locksAt, input.now),
      ),
    )
    .returning({ id: schema.rounds.id })

  if (lockedRounds.length === 0) return { status: 'ROUND_CLOSED' }

  const insertedAnswers = await database
    .insert(schema.answers)
    .values({
      roundId: round.id,
      playerId: input.playerId,
      telegramInputId: input.telegramInputId,
      rawAnswer: input.rawAnswer,
      normalizedAnswer: normalizeAnswer(input.rawAnswer),
      isCorrect: true,
    })
    .onConflictDoNothing({ target: [schema.answers.roundId, schema.answers.playerId] })
    .returning({ id: schema.answers.id })

  if (insertedAnswers.length === 0) throw new ScoreAwardError(round.id, input.playerId)

  const points = pointsForRound(round, configuredClueNumberAt(round, input.now))
  await awardScore(database, round, input.playerId, points)
  return { status: 'ACCEPTED', points }
}

async function getLiveRound(database: Database, roundId: string, now: Date) {
  const rows = await database
    .select({
      id: schema.rounds.id,
      communityId: schema.rounds.communityId,
      seasonId: schema.rounds.seasonId,
      questionId: schema.rounds.questionId,
      startsAt: schema.rounds.startsAt,
      locksAt: schema.rounds.locksAt,
      mode: schema.questions.mode,
      presentation: schema.rounds.presentation,
      projectQuizConfig: schema.rounds.projectQuizConfig,
      basePoints: schema.questions.basePoints,
      correctAnswer: schema.questions.correctAnswer,
      acceptedAnswers: schema.questions.acceptedAnswers,
      clueData: schema.questions.clueData,
    })
    .from(schema.rounds)
    .innerJoin(schema.questions, eq(schema.rounds.questionId, schema.questions.id))
    .innerJoin(schema.seasons, eq(schema.rounds.seasonId, schema.seasons.id))
    .where(
      and(
        eq(schema.rounds.id, roundId),
        eq(schema.rounds.state, 'LIVE'),
        lte(schema.rounds.startsAt, now),
        gt(schema.rounds.locksAt, now),
        eq(schema.seasons.status, 'ACTIVE'),
        lte(schema.seasons.startsAt, now),
        gt(schema.seasons.endsAt, now),
      ),
    )
    .for('update')

  return rows[0] ?? null
}

async function awardScore(
  database: Database,
  round: {
    readonly id: string
    readonly communityId: string
    readonly seasonId: string
    readonly questionId: string
  },
  playerId: string,
  points: number,
): Promise<void> {
  const idempotencyKey = scoreEventKey(round.id, playerId)
  const event = await awardScoreEvent(database, {
    playerId,
    communityId: round.communityId,
    seasonId: round.seasonId,
    sourceType: 'QUIZ',
    sourceId: round.id,
    roundId: round.id,
    questionId: round.questionId,
    points,
    reason: 'CORRECT_ANSWER',
    idempotencyKey,
  })

  if (!event.created) {
    throw new ScoreAwardError(round.id, playerId)
  }
}
