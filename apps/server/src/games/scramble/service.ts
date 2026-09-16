import { claimTelegramUpdate } from '../../db/telegram-updates'
import { matchesAcceptedAnswer, normalizeAnswer } from '@rallyo/core'
import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../../db/schema'
import type { CommunityGameConfigService } from '../../core/community-game-config-service'
import { awardScoreEvent } from '../../core/score-event-service'
import { GENERAL_SCRAMBLE_TERMS } from './terms'
import { resolveGameDifficulty, scrambleDifficultyPreset } from '../difficulty'
import {
  isScrambleableTerm,
  maximumUsefulHints,
  renderHintPattern,
  revealPositionsForHint,
  selectScrambleTerm,
  type ScrambleCandidate,
} from './rules'

type Database = NodePgDatabase<typeof schema>

export type ScrambleRound = Omit<typeof schema.scrambleRounds.$inferSelect, 'difficulty'> & {
  readonly difficulty?: string
}

export type ScrambleGuessResult =
  | { readonly status: 'WON'; readonly points: number; readonly round: ScrambleRound }
  | { readonly status: 'WRONG' | 'DUPLICATE_GUESS' | 'ROUND_CLOSED' | 'DUPLICATE_UPDATE' }
  | { readonly status: 'TIMEOUT'; readonly round: ScrambleRound }

export type ScrambleHintResult =
  | {
      readonly status: 'HINT'
      readonly round: ScrambleRound
      readonly hint: string
      readonly pointsRemaining: number
    }
  | { readonly status: 'NOT_READY'; readonly availableAt: Date }
  | { readonly status: 'DISABLED' | 'MAX_HINTS' | 'ROUND_CLOSED' }
  | { readonly status: 'TIMEOUT'; readonly round: ScrambleRound }

export class ScrambleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScrambleError'
  }
}

export class ScrambleStartError extends ScrambleError {}

export class ScrambleService {
  constructor(
    private readonly database: Database,
    private readonly gameConfigurations: CommunityGameConfigService,
  ) {}

  async startRound(input: {
    readonly communityId: string
    readonly seasonId?: string
    readonly now: Date
    readonly random?: () => number
  }): Promise<ScrambleRound> {
    try {
      await this.gameConfigurations.requireEnabled(input.communityId, 'scramble')
    } catch (error) {
      throw new ScrambleStartError(error instanceof Error ? error.message : 'Scramble is disabled.')
    }
    const storedConfig = await this.gameConfigurations.getScrambleConfig(input.communityId)
    const { config } = storedConfig
    const rawConfig = storedConfig.row?.config ?? {}
    const difficulty = resolveGameDifficulty(config.difficulty, input.random)
    const preset = scrambleDifficultyPreset(difficulty)
    const timeoutSeconds = configuredNumber(rawConfig, 'timeoutSeconds', preset.timeoutSeconds)
    const minLength = configuredNumber(rawConfig, 'minLength', preset.minLength)
    const maxLength = configuredNumber(rawConfig, 'maxLength', preset.maxLength)
    const maxHints = configuredNumber(rawConfig, 'maxHints', preset.maxHints)

    return this.database.transaction(async (tx) => {
      const [community] = await tx
        .select({ id: schema.communities.id, status: schema.communities.status })
        .from(schema.communities)
        .where(eq(schema.communities.id, input.communityId))
        .for('update')

      if (!community || community.status !== 'ACTIVE') {
        throw new ScrambleStartError('Community is not active.')
      }

      const seasonConditions = [
        eq(schema.seasons.communityId, input.communityId),
        eq(schema.seasons.status, 'ACTIVE'),
        lte(schema.seasons.startsAt, input.now),
        gt(schema.seasons.endsAt, input.now),
        ...(input.seasonId ? [eq(schema.seasons.id, input.seasonId)] : []),
      ]
      const [season] = await tx
        .select({ id: schema.seasons.id, endsAt: schema.seasons.endsAt })
        .from(schema.seasons)
        .where(and(...seasonConditions))
        .orderBy(desc(schema.seasons.startsAt))
        .limit(1)

      if (!season) throw new ScrambleStartError('An active season is required for Scramble.')

      const [existingScramble] = await tx
        .select()
        .from(schema.scrambleRounds)
        .where(
          and(
            eq(schema.scrambleRounds.communityId, input.communityId),
            eq(schema.scrambleRounds.status, 'LIVE'),
          ),
        )
        .for('update')
        .limit(1)

      if (existingScramble && existingScramble.locksAt > input.now) {
        throw new ScrambleStartError('Community already has a live Scramble round.')
      }

      if (existingScramble) {
        await tx
          .update(schema.scrambleRounds)
          .set({ status: 'TIMED_OUT', endedAt: input.now })
          .where(eq(schema.scrambleRounds.id, existingScramble.id))
      }

      const [quizRound] = await tx
        .select({ id: schema.rounds.id })
        .from(schema.rounds)
        .where(
          and(
            eq(schema.rounds.communityId, input.communityId),
            eq(schema.rounds.state, 'LIVE'),
            gt(schema.rounds.locksAt, input.now),
          ),
        )
        .limit(1)
      if (quizRound) throw new ScrambleStartError('Community already has a live quiz round.')

      const candidates = await this.candidatesForSource(tx, input.communityId)
      const recentRows =
        config.noRepeatRounds > 0
          ? await tx
              .select({ normalizedAnswer: schema.scrambleRounds.normalizedAnswer })
              .from(schema.scrambleRounds)
              .where(eq(schema.scrambleRounds.communityId, input.communityId))
              .orderBy(desc(schema.scrambleRounds.createdAt))
              .limit(config.noRepeatRounds)
          : []
      const selected = selectScrambleTerm(
        candidates,
        new Set(recentRows.map((row) => row.normalizedAnswer)),
        {
          difficulty,
          minLength,
          maxLength,
          ...(input.random ? { random: input.random } : {}),
        },
      )

      if (!selected) {
        throw new ScrambleStartError(
          config.source === 'PROJECT_BRAIN'
            ? 'No approved Project Brain terms are available for Scramble.'
            : 'No usable general Scramble terms are available.',
        )
      }

      const locksAt = new Date(input.now.getTime() + timeoutSeconds * 1_000)
      if (locksAt >= season.endsAt) {
        throw new ScrambleStartError(
          'The active season ends before this Scramble round can finish.',
        )
      }

      const usefulHints = maximumUsefulHints(selected.term, Math.min(config.maxHints, maxHints))
      const hintTimingSeconds = (
        Array.isArray(rawConfig.hintTimingSeconds)
          ? config.hintTimingSeconds
          : preset.hintTimingSeconds
      ).slice(0, usefulHints)
      const pointReductions = (
        Array.isArray(rawConfig.pointReductions) ? config.pointReductions : preset.pointReductions
      ).slice(0, usefulHints)
      const [round] = await tx
        .insert(schema.scrambleRounds)
        .values({
          communityId: input.communityId,
          seasonId: season.id,
          source: selected.sourceTermId ? 'PROJECT_BRAIN' : 'GENERAL',
          ...(selected.sourceTermId ? { sourceTermId: selected.sourceTermId } : {}),
          term: selected.term,
          normalizedAnswer: selected.normalizedAnswer,
          scrambledTerm: selected.scrambledTerm,
          category: selected.category,
          difficulty,
          status: 'LIVE',
          startsAt: input.now,
          locksAt,
          points: config.points,
          pointsRemaining: config.points,
          hintsEnabled: config.hintsEnabled && usefulHints > 0,
          maxHints: usefulHints,
          hintTimingSeconds,
          pointReductions,
          revealedPositions: [],
        })
        .returning()

      if (!round) throw new ScrambleStartError('Scramble round could not be created.')
      return round
    })
  }

  async activeRoundForCommunity(communityId: string, now: Date): Promise<ScrambleRound | null> {
    const [round] = await this.database
      .select()
      .from(schema.scrambleRounds)
      .where(
        and(
          eq(schema.scrambleRounds.communityId, communityId),
          eq(schema.scrambleRounds.status, 'LIVE'),
          lte(schema.scrambleRounds.startsAt, now),
          gt(schema.scrambleRounds.locksAt, now),
        ),
      )
      .orderBy(desc(schema.scrambleRounds.startsAt))
      .limit(1)
    return round ?? null
  }

  async attachTelegramMessageId(roundId: string, telegramMessageId: bigint): Promise<boolean> {
    const rows = await this.database
      .update(schema.scrambleRounds)
      .set({ telegramMessageId })
      .where(
        and(
          eq(schema.scrambleRounds.id, roundId),
          eq(schema.scrambleRounds.status, 'LIVE'),
          isNull(schema.scrambleRounds.telegramMessageId),
        ),
      )
      .returning({ id: schema.scrambleRounds.id })
    return rows.length === 1
  }

  async submitGuess(input: {
    readonly telegramUpdateId: bigint
    readonly telegramInputId: string
    readonly roundId: string
    readonly playerId: string
    readonly rawAnswer: string
    readonly now: Date
    readonly updateAlreadyClaimed?: boolean
  }): Promise<ScrambleGuessResult> {
    return this.database.transaction(async (tx) => {
      if (!input.updateAlreadyClaimed && !(await claimTelegramUpdate(tx, input.telegramUpdateId))) {
        return { status: 'DUPLICATE_UPDATE' as const }
      }

      const [round] = await tx
        .select()
        .from(schema.scrambleRounds)
        .where(eq(schema.scrambleRounds.id, input.roundId))
        .for('update')
      if (!round || round.status !== 'LIVE') return { status: 'ROUND_CLOSED' as const }

      if (round.locksAt <= input.now) {
        const [timedOut] = await tx
          .update(schema.scrambleRounds)
          .set({ status: 'TIMED_OUT', endedAt: input.now })
          .where(
            and(eq(schema.scrambleRounds.id, round.id), eq(schema.scrambleRounds.status, 'LIVE')),
          )
          .returning()
        return timedOut
          ? { status: 'TIMEOUT' as const, round: timedOut }
          : { status: 'ROUND_CLOSED' as const }
      }

      const normalizedAnswer = normalizeAnswer(input.rawAnswer)
      if (!normalizedAnswer) return { status: 'WRONG' as const }

      const [existingInput] = await tx
        .select({ id: schema.scrambleGuesses.id })
        .from(schema.scrambleGuesses)
        .where(eq(schema.scrambleGuesses.telegramInputId, input.telegramInputId))
        .limit(1)
      if (existingInput) return { status: 'DUPLICATE_GUESS' as const }

      const [existingAnswer] = await tx
        .select({ id: schema.scrambleGuesses.id })
        .from(schema.scrambleGuesses)
        .where(
          and(
            eq(schema.scrambleGuesses.roundId, round.id),
            eq(schema.scrambleGuesses.playerId, input.playerId),
            eq(schema.scrambleGuesses.normalizedAnswer, normalizedAnswer),
          ),
        )
        .limit(1)
      if (existingAnswer) return { status: 'DUPLICATE_GUESS' as const }

      const isCorrect = matchesAcceptedAnswer(input.rawAnswer, [round.term])
      await tx.insert(schema.scrambleGuesses).values({
        roundId: round.id,
        playerId: input.playerId,
        telegramInputId: input.telegramInputId,
        rawAnswer: input.rawAnswer,
        normalizedAnswer,
        isCorrect,
      })

      if (!isCorrect) return { status: 'WRONG' as const }

      const [winner] = await tx
        .update(schema.scrambleRounds)
        .set({ status: 'WON', winnerPlayerId: input.playerId, endedAt: input.now })
        .where(
          and(eq(schema.scrambleRounds.id, round.id), eq(schema.scrambleRounds.status, 'LIVE')),
        )
        .returning()
      if (!winner) return { status: 'ROUND_CLOSED' as const }

      await awardScoreEvent(tx, {
        playerId: input.playerId,
        communityId: winner.communityId,
        seasonId: winner.seasonId,
        sourceType: 'SCRAMBLE',
        sourceId: winner.id,
        points: winner.pointsRemaining,
        reason: 'SCRAMBLE_CORRECT_ANSWER',
        idempotencyKey: `scramble:${winner.id}:winner`,
      })

      return { status: 'WON' as const, points: winner.pointsRemaining, round: winner }
    })
  }

  async requestHint(input: {
    readonly roundId: string
    readonly now: Date
  }): Promise<ScrambleHintResult> {
    return this.database.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(schema.scrambleRounds)
        .where(eq(schema.scrambleRounds.id, input.roundId))
        .for('update')
      if (!round || round.status !== 'LIVE') return { status: 'ROUND_CLOSED' as const }

      if (round.locksAt <= input.now) {
        const [timedOut] = await tx
          .update(schema.scrambleRounds)
          .set({ status: 'TIMED_OUT', endedAt: input.now })
          .where(
            and(eq(schema.scrambleRounds.id, round.id), eq(schema.scrambleRounds.status, 'LIVE')),
          )
          .returning()
        return timedOut
          ? { status: 'TIMEOUT' as const, round: timedOut }
          : { status: 'ROUND_CLOSED' as const }
      }

      if (!round.hintsEnabled || round.maxHints === 0) return { status: 'DISABLED' as const }
      if (round.hintCount >= round.maxHints) return { status: 'MAX_HINTS' as const }

      const nextTiming = round.hintTimingSeconds[round.hintCount]
      if (nextTiming === undefined) return { status: 'MAX_HINTS' as const }
      const availableAt = new Date(round.startsAt.getTime() + nextTiming * 1_000)
      if (input.now < availableAt) return { status: 'NOT_READY' as const, availableAt }

      const hintCount = round.hintCount + 1
      const revealedPositions = revealPositionsForHint(
        round.term,
        round.revealedPositions,
        hintCount,
        round.maxHints,
      )
      const reductions = round.pointReductions.slice(0, hintCount)
      const pointsRemaining = Math.max(
        1,
        round.points - reductions.reduce((total, reduction) => total + reduction, 0),
      )
      const [updated] = await tx
        .update(schema.scrambleRounds)
        .set({ hintCount, revealedPositions, pointsRemaining })
        .where(
          and(eq(schema.scrambleRounds.id, round.id), eq(schema.scrambleRounds.status, 'LIVE')),
        )
        .returning()
      if (!updated) return { status: 'ROUND_CLOSED' as const }

      return {
        status: 'HINT' as const,
        round: updated,
        hint: renderHintPattern(updated.term, updated.revealedPositions),
        pointsRemaining: updated.pointsRemaining,
      }
    })
  }

  async stopRound(communityId: string, now: Date): Promise<ScrambleRound | null> {
    const [round] = await this.database
      .update(schema.scrambleRounds)
      .set({ status: 'STOPPED', endedAt: now })
      .where(
        and(
          eq(schema.scrambleRounds.communityId, communityId),
          eq(schema.scrambleRounds.status, 'LIVE'),
        ),
      )
      .returning()
    return round ?? null
  }

  async expireDueRounds(now: Date): Promise<ScrambleRound[]> {
    return this.database.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(schema.scrambleRounds)
        .where(
          and(eq(schema.scrambleRounds.status, 'LIVE'), lte(schema.scrambleRounds.locksAt, now)),
        )
        .orderBy(schema.scrambleRounds.locksAt)
        .for('update', { skipLocked: true })

      const expired: ScrambleRound[] = []
      for (const round of due) {
        const [updated] = await tx
          .update(schema.scrambleRounds)
          .set({ status: 'TIMED_OUT', endedAt: now })
          .where(
            and(eq(schema.scrambleRounds.id, round.id), eq(schema.scrambleRounds.status, 'LIVE')),
          )
          .returning()
        if (updated) expired.push(updated)
      }
      return expired
    })
  }

  async pendingOutcomeRounds() {
    return this.database
      .select({
        round: schema.scrambleRounds,
        winnerDisplayName: schema.telegramIdentities.displayName,
        winnerTelegramUserId: schema.telegramIdentities.telegramUserId,
        telegramChatId: schema.communities.telegramChatId,
      })
      .from(schema.scrambleRounds)
      .innerJoin(schema.communities, eq(schema.scrambleRounds.communityId, schema.communities.id))
      .leftJoin(
        schema.telegramIdentities,
        eq(schema.telegramIdentities.playerId, schema.scrambleRounds.winnerPlayerId),
      )
      .where(
        and(
          inArray(schema.scrambleRounds.status, ['WON', 'TIMED_OUT', 'STOPPED']),
          isNull(schema.scrambleRounds.outcomeNotifiedAt),
        ),
      )
      .orderBy(schema.scrambleRounds.endedAt)
  }

  async markOutcomeNotified(roundId: string, now: Date): Promise<boolean> {
    const rows = await this.database
      .update(schema.scrambleRounds)
      .set({ outcomeNotifiedAt: now })
      .where(
        and(eq(schema.scrambleRounds.id, roundId), isNull(schema.scrambleRounds.outcomeNotifiedAt)),
      )
      .returning({ id: schema.scrambleRounds.id })
    return rows.length === 1
  }

  async pendingPresentationRounds() {
    return this.database
      .select({ round: schema.scrambleRounds, telegramChatId: schema.communities.telegramChatId })
      .from(schema.scrambleRounds)
      .innerJoin(schema.communities, eq(schema.scrambleRounds.communityId, schema.communities.id))
      .where(
        and(
          eq(schema.scrambleRounds.status, 'LIVE'),
          isNull(schema.scrambleRounds.telegramMessageId),
        ),
      )
      .orderBy(schema.scrambleRounds.startsAt)
  }

  private async candidatesForSource(
    database: Parameters<Parameters<Database['transaction']>[0]>[0],
    communityId: string,
  ): Promise<ScrambleCandidate[]> {
    const questionRows = await database
      .select({
        id: schema.questions.id,
        term: schema.questions.correctAnswer,
        category: schema.questions.category,
        difficulty: schema.questions.difficulty,
      })
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.status, 'APPROVED'),
          inArray(schema.questions.source, ['PROJECT_AI', 'MANUAL']),
          or(
            eq(schema.questions.scope, 'GLOBAL'),
            and(
              eq(schema.questions.scope, 'COMMUNITY'),
              eq(schema.questions.communityId, communityId),
            ),
          ),
        ),
      )

    const projectQuestions = questionRows.map((row) => ({
      term: row.term,
      category: row.category,
      sourceTermId: row.id,
      difficulty: row.difficulty,
    }))
    const projectWords = await database
      .select({
        id: schema.wordSeekWords.id,
        term: schema.wordSeekWords.word,
        difficulty: schema.wordSeekWords.difficulty,
      })
      .from(schema.wordSeekWords)
      .where(
        and(
          eq(schema.wordSeekWords.communityId, communityId),
          eq(schema.wordSeekWords.status, 'APPROVED'),
        ),
      )

    return [
      ...projectQuestions,
      ...projectWords.map((row) => ({
        term: row.term,
        category: 'Project vocabulary',
        sourceTermId: row.id,
        difficulty: row.difficulty,
      })),
      ...GENERAL_SCRAMBLE_TERMS,
    ]
  }
}

function configuredNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function isProjectScrambleTermUsable(term: string, minLength: number, maxLength: number) {
  return isScrambleableTerm(term, minLength, maxLength)
}
