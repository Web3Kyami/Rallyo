import { matchesAcceptedAnswer } from '@rallyo/core'
import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm'
import { randomInt } from 'node:crypto'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres'
import { z } from 'zod'

import { CommunityGameConfigService } from '../../core/community-game-config-service'
import { recordAnalyticsEvent } from '../../core/analytics-service'
import { awardScoreEvent } from '../../core/score-event-service'
import type { RallyoDatabase } from '../../db/client'
import * as schema from '../../db/schema'
import { generalWordSet, generalWordsForLength } from './dictionary'
import { claimTelegramUpdate } from '../../db/telegram-updates'
import {
  gameDifficultySchema,
  resolveGameDifficulty,
  wordSeekDifficultyPreset,
  type ResolvedDifficulty,
} from '../difficulty'
import {
  isValidWordShape,
  isWordLength,
  normalizeWord,
  type WordLength,
  wordSeekFeedback,
} from './rules'

type Database = NodePgDatabase<typeof schema>
type Transaction = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>
type Executor = Database | Transaction

const wordSeekConfigSchema = z.object({
  difficulty: gameDifficultySchema.default('AUTO'),
  wordLength: z.union([z.literal(4), z.literal(5), z.literal(6)]).default(5),
  roundTimeoutSeconds: z.number().int().min(30).max(3_600).default(300),
  points: z.number().int().positive().max(100).default(30),
  maxGuesses: z.number().int().positive().max(30).default(30),
  source: z.enum(['GENERAL', 'PROJECT', 'PROJECT_BRAIN']).default('GENERAL'),
  clue: z.string().trim().min(1).max(500).optional(),
})

export type WordSeekConfig = z.infer<typeof wordSeekConfigSchema> & {
  readonly source: 'GENERAL' | 'PROJECT'
}

export class WordSeekError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WordSeekError'
  }
}

export function parseWordSeekConfig(config: Record<string, unknown>): WordSeekConfig {
  const rawSource = config.source ?? config.allowedSource ?? config.contentSource
  const normalizedSource =
    typeof rawSource === 'string' ? rawSource.trim().toUpperCase().replaceAll('-', '_') : rawSource
  const source =
    normalizedSource === 'PROJECT' ||
    normalizedSource === 'PROJECT_BRAIN' ||
    normalizedSource === 'PROJECT_TERMS'
      ? 'PROJECT'
      : normalizedSource === 'CURATED' || normalizedSource === 'DEFAULT'
        ? 'GENERAL'
        : normalizedSource
  const parsed = wordSeekConfigSchema.safeParse({
    ...config,
    ...(config.roundTimeoutSeconds === undefined && config.timeoutSeconds !== undefined
      ? { roundTimeoutSeconds: config.timeoutSeconds }
      : {}),
    ...(normalizedSource === undefined ? {} : { source }),
  })

  if (!parsed.success) {
    throw new WordSeekError('Word Seek configuration is invalid.')
  }

  return {
    ...parsed.data,
    source: parsed.data.source === 'GENERAL' ? 'GENERAL' : 'PROJECT',
  }
}

export type WordSeekGuessResult =
  | { readonly status: 'NO_ACTIVE_GAME' }
  | { readonly status: 'DUPLICATE_UPDATE' | 'DUPLICATE_INPUT' | 'ROUND_CLOSED' }
  | { readonly status: 'INVALID_LENGTH'; readonly wordLength: number }
  | { readonly status: 'INVALID_WORD'; readonly wordLength: number }
  | {
      readonly status: 'DUPLICATE_GUESS'
      readonly wordLength: number
    }
  | {
      readonly status: 'FEEDBACK'
      readonly sessionId: string
      readonly feedback: string
      readonly guessesUsed: number
      readonly maxGuesses: number
    }
  | {
      readonly status: 'WON'
      readonly sessionId: string
      readonly word: string
      readonly guessesUsed: number
      readonly points: number
      readonly scoreEventId: string
    }
  | {
      readonly status: 'TIMED_OUT' | 'MAX_GUESSES'
      readonly sessionId: string
      readonly word: string
      readonly guessesUsed: number
    }

type WordSeekCandidate = {
  readonly word: string
  readonly clue: string | null
  readonly sourceId: string | null
  readonly sourceType: 'GENERAL' | 'PROJECT'
  readonly aliases: readonly string[]
  readonly difficulty: string
}

export class WordSeekService {
  private readonly randomIndex: (maxExclusive: number) => number

  constructor(
    private readonly database: RallyoDatabase,
    private readonly configurations = new CommunityGameConfigService(database),
    randomIndex: (maxExclusive: number) => number = (maxExclusive) => randomInt(0, maxExclusive),
  ) {
    this.randomIndex = randomIndex
  }

  parseConfig(config: Record<string, unknown>): WordSeekConfig {
    return parseWordSeekConfig(config)
  }

  async start(input: {
    readonly communityId: string
    readonly seasonId: string
    readonly startsAt: Date
    readonly now: Date
    readonly targetWord?: string
  }) {
    await this.configurations.requireEnabled(input.communityId, 'word_seek')
    const storedConfig = await this.configurations.get(input.communityId, 'word_seek')
    const rawConfig = storedConfig?.config ?? {}
    const config = this.parseConfig(rawConfig)
    const difficulty = resolveGameDifficulty(
      config.difficulty,
      () => this.randomIndex(10_000) / 10_000,
    )
    const preset = wordSeekDifficultyPreset(difficulty)
    const timeoutSeconds = configuredNumber(
      rawConfig,
      'roundTimeoutSeconds',
      preset.roundTimeoutSeconds,
    )
    const maxGuesses = configuredNumber(rawConfig, 'maxGuesses', preset.maxGuesses)

    if (input.startsAt > input.now) {
      throw new WordSeekError('Word Seek cannot start in the future.')
    }

    const startsAt = input.startsAt
    const endsAt = new Date(startsAt.getTime() + timeoutSeconds * 1_000)

    return this.database.transaction(async (tx) => {
      const [community] = await tx
        .select({ id: schema.communities.id, status: schema.communities.status })
        .from(schema.communities)
        .where(eq(schema.communities.id, input.communityId))
        .for('update')

      if (!community || community.status !== 'ACTIVE') {
        throw new WordSeekError('Community is not active.')
      }

      const [activeSession] = await tx
        .select({ id: schema.wordSeekSessions.id })
        .from(schema.wordSeekSessions)
        .where(eq(schema.wordSeekSessions.activeKey, input.communityId))
        .limit(1)

      if (activeSession) {
        throw new WordSeekError('Community already has a Word Seek round.')
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
            gt(schema.seasons.endsAt, input.startsAt),
            gte(schema.seasons.endsAt, endsAt),
          ),
        )
        .limit(1)

      if (!season) {
        throw new WordSeekError('Season is not active for the requested Word Seek round.')
      }

      const candidate = await this.chooseCandidate(
        tx,
        input.communityId,
        config,
        input.targetWord,
        difficulty,
      )
      const [session] = await tx
        .insert(schema.wordSeekSessions)
        .values({
          communityId: input.communityId,
          seasonId: season.id,
          targetWord: candidate.word,
          wordLength: config.wordLength,
          difficulty,
          sourceType: candidate.sourceType,
          ...(candidate.sourceId ? { sourceId: candidate.sourceId } : {}),
          acceptedAnswers: candidate.aliases,
          ...(preset.hintEnabled && (config.clue || candidate.clue)
            ? { clue: config.clue ?? candidate.clue }
            : {}),
          points: config.points,
          maxGuesses,
          startsAt,
          endsAt,
          activeKey: input.communityId,
        })
        .returning()

      if (!session) throw new WordSeekError('Word Seek round could not be created.')
      return session
    })
  }

  async activeSession(communityId: string) {
    const [session] = await this.database
      .select()
      .from(schema.wordSeekSessions)
      .where(
        and(
          eq(schema.wordSeekSessions.communityId, communityId),
          eq(schema.wordSeekSessions.status, 'LIVE'),
          eq(schema.wordSeekSessions.activeKey, communityId),
        ),
      )
      .orderBy(desc(schema.wordSeekSessions.startsAt))
      .limit(1)
    return session ?? null
  }

  async recover(communityId: string) {
    return this.activeSession(communityId)
  }

  async createProjectWord(input: {
    readonly communityId: string
    readonly word: string
    readonly clue?: string
    readonly category?: string
    readonly difficulty?: 'AUTO' | 'EASY' | 'MEDIUM' | 'HARD'
    readonly aliases?: readonly string[]
    readonly sourceRef?: string
  }) {
    const normalizedWord = normalizeWord(input.word)
    if (
      !isWordLength(normalizedWord.length) ||
      !isValidWordShape(normalizedWord, normalizedWord.length)
    ) {
      throw new WordSeekError('Project words must contain 4, 5, or 6 letters.')
    }

    const [word] = await this.database
      .insert(schema.wordSeekWords)
      .values({
        communityId: input.communityId,
        word: normalizedWord,
        wordLength: normalizedWord.length,
        ...(input.clue ? { clue: input.clue.trim() } : {}),
        ...(input.category ? { category: input.category.trim() } : {}),
        ...(input.difficulty ? { difficulty: input.difficulty } : {}),
        ...(input.aliases ? { aliases: input.aliases.map(normalizeWord).filter(Boolean) } : {}),
        ...(input.sourceRef ? { sourceRef: input.sourceRef.trim() } : {}),
      })
      .returning()
    if (!word) throw new WordSeekError('Project Word Seek word could not be created.')
    return word
  }

  async approveProjectWord(wordId: string, communityId?: string) {
    const [word] = await this.database
      .update(schema.wordSeekWords)
      .set({ status: 'APPROVED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.wordSeekWords.id, wordId),
          eq(schema.wordSeekWords.status, 'DRAFT'),
          ...(communityId ? [eq(schema.wordSeekWords.communityId, communityId)] : []),
        ),
      )
      .returning()
    if (!word) throw new WordSeekError('Only an existing project word draft can be approved.')
    return word
  }

  async attachTelegramMessageId(sessionId: string, telegramMessageId: bigint): Promise<boolean> {
    const rows = await this.database
      .update(schema.wordSeekSessions)
      .set({ telegramMessageId })
      .where(
        and(
          eq(schema.wordSeekSessions.id, sessionId),
          eq(schema.wordSeekSessions.status, 'LIVE'),
          sql`${schema.wordSeekSessions.telegramMessageId} IS NULL`,
        ),
      )
      .returning({ id: schema.wordSeekSessions.id })
    return rows.length > 0
  }

  async submitGuess(input: {
    readonly communityId: string
    readonly playerId: string
    readonly telegramUpdateId: bigint
    readonly telegramInputId: string
    readonly rawGuess: string
    readonly now: Date
    readonly updateAlreadyClaimed?: boolean
  }): Promise<WordSeekGuessResult> {
    return this.database.transaction(async (tx) => {
      if (!input.updateAlreadyClaimed && !(await claimTelegramUpdate(tx, input.telegramUpdateId))) {
        return { status: 'DUPLICATE_UPDATE' }
      }

      const [session] = await tx
        .select()
        .from(schema.wordSeekSessions)
        .where(
          and(
            eq(schema.wordSeekSessions.communityId, input.communityId),
            eq(schema.wordSeekSessions.status, 'LIVE'),
            eq(schema.wordSeekSessions.activeKey, input.communityId),
          ),
        )
        .for('update')

      if (!session) return { status: 'NO_ACTIVE_GAME' }

      if (session.endsAt <= input.now) {
        const expired = await this.closeLiveSession(tx, session.id, 'TIMED_OUT', input.now)
        return {
          status: 'TIMED_OUT',
          sessionId: session.id,
          word: session.targetWord,
          guessesUsed: expired.guessesUsed,
        }
      }

      const [existingInput] = await tx
        .select({ id: schema.wordSeekGuesses.id, sessionId: schema.wordSeekGuesses.sessionId })
        .from(schema.wordSeekGuesses)
        .where(eq(schema.wordSeekGuesses.telegramInputId, input.telegramInputId))
        .limit(1)
      if (existingInput) {
        return existingInput.sessionId === session.id
          ? { status: 'DUPLICATE_INPUT' }
          : { status: 'DUPLICATE_UPDATE' }
      }

      const normalizedGuess = normalizeWord(input.rawGuess)
      if (!isValidWordShape(normalizedGuess, session.wordLength)) {
        return { status: 'INVALID_LENGTH', wordLength: session.wordLength }
      }

      if (!(await this.isAllowedGuess(tx, input.communityId, session, normalizedGuess))) {
        return { status: 'INVALID_WORD', wordLength: session.wordLength }
      }

      const [existingGuess] = await tx
        .select({ id: schema.wordSeekGuesses.id })
        .from(schema.wordSeekGuesses)
        .where(
          and(
            eq(schema.wordSeekGuesses.sessionId, session.id),
            eq(schema.wordSeekGuesses.normalizedGuess, normalizedGuess),
          ),
        )
        .limit(1)
      if (existingGuess) return { status: 'DUPLICATE_GUESS', wordLength: session.wordLength }

      const correct = matchesAcceptedAnswer(input.rawGuess, [
        session.targetWord,
        ...session.acceptedAnswers,
      ])
      const feedback = wordSeekFeedback(normalizedGuess, session.targetWord)
      await tx.insert(schema.wordSeekGuesses).values({
        sessionId: session.id,
        playerId: input.playerId,
        telegramInputId: input.telegramInputId,
        rawGuess: input.rawGuess,
        normalizedGuess,
        feedback,
        isCorrect: correct,
        submittedAt: input.now,
      })

      const guessesUsed = await this.guessCount(tx, session.id)
      await recordAnalyticsEvent(tx, {
        type: 'WORD_SEEK_GUESS',
        playerId: input.playerId,
        communityId: session.communityId,
        metadata: {
          sessionId: session.id,
          wordLength: session.wordLength,
          correct,
          guessesUsed,
        },
      })

      if (!correct && guessesUsed >= session.maxGuesses) {
        await this.closeLiveSession(tx, session.id, 'TIMED_OUT', input.now)
        return {
          status: 'MAX_GUESSES',
          sessionId: session.id,
          word: session.targetWord,
          guessesUsed,
        }
      }

      if (!correct) {
        return {
          status: 'FEEDBACK',
          sessionId: session.id,
          feedback,
          guessesUsed,
          maxGuesses: session.maxGuesses,
        }
      }

      await tx
        .update(schema.wordSeekSessions)
        .set({
          status: 'WON',
          activeKey: null,
          winnerPlayerId: input.playerId,
          winnerTelegramInputId: input.telegramInputId,
          completedAt: input.now,
        })
        .where(
          and(
            eq(schema.wordSeekSessions.id, session.id),
            eq(schema.wordSeekSessions.status, 'LIVE'),
          ),
        )

      const scoreEvent = await awardScoreEvent(tx, {
        playerId: input.playerId,
        communityId: session.communityId,
        seasonId: session.seasonId,
        sourceType: 'WORD_SEEK',
        sourceId: session.id,
        points: session.points,
        reason: 'WORD_SEEK_SOLVE',
        idempotencyKey: `word-seek:${session.id}:winner`,
      })
      await recordAnalyticsEvent(tx, {
        type: 'WORD_SEEK_SOLVED',
        playerId: input.playerId,
        communityId: session.communityId,
        metadata: { sessionId: session.id, guessesUsed, points: session.points },
      })

      return {
        status: 'WON',
        sessionId: session.id,
        word: session.targetWord,
        guessesUsed,
        points: session.points,
        scoreEventId: scoreEvent.id,
      }
    })
  }

  async endSession(input: {
    readonly communityId: string
    readonly now: Date
    readonly sessionId?: string
  }) {
    const where = [
      eq(schema.wordSeekSessions.communityId, input.communityId),
      eq(schema.wordSeekSessions.status, 'LIVE'),
      ...(input.sessionId ? [eq(schema.wordSeekSessions.id, input.sessionId)] : []),
    ]
    const [session] = await this.database
      .update(schema.wordSeekSessions)
      .set({ status: 'ENDED', activeKey: null, completedAt: input.now })
      .where(and(...where))
      .returning()
    return session ?? null
  }

  async expireDueSessions(now: Date) {
    return this.database
      .update(schema.wordSeekSessions)
      .set({ status: 'TIMED_OUT', activeKey: null, completedAt: now })
      .where(
        and(eq(schema.wordSeekSessions.status, 'LIVE'), lte(schema.wordSeekSessions.endsAt, now)),
      )
      .returning()
  }

  async statsForPlayer(input: { readonly communityId: string; readonly playerId: string }) {
    const [played] = await this.database
      .select({ count: sql<string>`count(distinct ${schema.wordSeekGuesses.sessionId})` })
      .from(schema.wordSeekGuesses)
      .innerJoin(
        schema.wordSeekSessions,
        eq(schema.wordSeekGuesses.sessionId, schema.wordSeekSessions.id),
      )
      .where(
        and(
          eq(schema.wordSeekGuesses.playerId, input.playerId),
          eq(schema.wordSeekSessions.communityId, input.communityId),
        ),
      )
    const [wins] = await this.database
      .select({ count: sql<string>`count(*)` })
      .from(schema.wordSeekSessions)
      .where(
        and(
          eq(schema.wordSeekSessions.communityId, input.communityId),
          eq(schema.wordSeekSessions.winnerPlayerId, input.playerId),
        ),
      )
    const [attempts] = await this.database
      .select({ count: sql<string>`count(*)` })
      .from(schema.wordSeekGuesses)
      .innerJoin(
        schema.wordSeekSessions,
        eq(schema.wordSeekGuesses.sessionId, schema.wordSeekSessions.id),
      )
      .where(
        and(
          eq(schema.wordSeekGuesses.playerId, input.playerId),
          eq(schema.wordSeekSessions.communityId, input.communityId),
        ),
      )

    return {
      gamesPlayed: Number(played?.count ?? 0),
      wins: Number(wins?.count ?? 0),
      attempts: Number(attempts?.count ?? 0),
    }
  }

  private async chooseCandidate(
    database: Transaction,
    communityId: string,
    config: WordSeekConfig,
    requestedWord?: string,
    difficulty: ResolvedDifficulty = 'MEDIUM',
  ): Promise<WordSeekCandidate> {
    const projectCandidates = await this.projectCandidates(database, communityId, config.wordLength)
    const generalCandidates = generalWordsForLength(config.wordLength).map((candidate) => ({
      word: normalizeWord(candidate.word),
      clue: candidate.clue,
      sourceId: null,
      sourceType: 'GENERAL' as const,
      aliases: (candidate.aliases ?? []).map(normalizeWord),
      difficulty: candidate.difficulty ?? 'MEDIUM',
    }))
    const projectWords = new Set(projectCandidates.map((candidate) => candidate.word))
    const candidates = [
      ...projectCandidates,
      ...generalCandidates.filter((candidate) => !projectWords.has(candidate.word)),
    ]
    const difficultyCandidates = candidates.filter((candidate) =>
      matchesDifficulty(candidate.difficulty, difficulty),
    )
    const eligibleCandidates = difficultyCandidates.length > 0 ? difficultyCandidates : candidates

    if (candidates.length === 0) {
      throw new WordSeekError('No Word Seek words are available for this length yet.')
    }

    if (requestedWord) {
      const normalizedRequestedWord = normalizeWord(requestedWord)
      const requested = candidates.find((candidate) => candidate.word === normalizedRequestedWord)
      if (!requested) throw new WordSeekError('The requested Word Seek word is not approved.')
      return requested
    }

    const recentSessions = await database
      .select({ targetWord: schema.wordSeekSessions.targetWord })
      .from(schema.wordSeekSessions)
      .where(
        and(
          eq(schema.wordSeekSessions.communityId, communityId),
          eq(schema.wordSeekSessions.wordLength, config.wordLength),
        ),
      )
      .orderBy(desc(schema.wordSeekSessions.createdAt))
      .limit(20)
    const recentWords = new Set(recentSessions.map((session) => session.targetWord))
    const scopedProjectCandidates = projectCandidates.filter((candidate) =>
      matchesDifficulty(candidate.difficulty, difficulty),
    )
    const scopedGeneralCandidates = generalCandidates.filter((candidate) =>
      matchesDifficulty(candidate.difficulty, difficulty),
    )
    const freshProjectCandidates = scopedProjectCandidates.filter(
      (candidate) => !recentWords.has(candidate.word),
    )
    const freshGeneralCandidates = scopedGeneralCandidates.filter(
      (candidate) => !recentWords.has(candidate.word),
    )
    const pool =
      freshProjectCandidates.length > 0
        ? freshProjectCandidates
        : scopedProjectCandidates.length > 0 && freshGeneralCandidates.length === 0
          ? scopedProjectCandidates
          : scopedProjectCandidates.length > 0
            ? freshGeneralCandidates
            : freshGeneralCandidates.length > 0
              ? freshGeneralCandidates
              : eligibleCandidates
    const selected = pool[this.randomIndex(pool.length)]
    if (!selected) throw new WordSeekError('Word Seek could not select a word.')
    return selected
  }

  private async projectCandidates(
    database: Transaction,
    communityId: string,
    wordLength: WordLength,
  ): Promise<WordSeekCandidate[]> {
    const rows = await database
      .select({
        id: schema.wordSeekWords.id,
        word: schema.wordSeekWords.word,
        clue: schema.wordSeekWords.clue,
        aliases: schema.wordSeekWords.aliases,
        difficulty: schema.wordSeekWords.difficulty,
      })
      .from(schema.wordSeekWords)
      .where(
        and(
          eq(schema.wordSeekWords.communityId, communityId),
          eq(schema.wordSeekWords.wordLength, wordLength),
          eq(schema.wordSeekWords.status, 'APPROVED'),
        ),
      )
    return rows.map((row) => ({
      word: normalizeWord(row.word),
      clue: row.clue,
      sourceId: row.id,
      sourceType: 'PROJECT' as const,
      aliases: row.aliases.map(normalizeWord),
      difficulty: row.difficulty,
    }))
  }

  private async isAllowedGuess(
    database: Transaction,
    communityId: string,
    session: typeof schema.wordSeekSessions.$inferSelect,
    guess: string,
  ): Promise<boolean> {
    if (
      generalWordSet(session.wordLength as WordLength).has(guess) ||
      session.acceptedAnswers.map(normalizeWord).includes(guess)
    )
      return true
    const [projectWord] = await database
      .select({ id: schema.wordSeekWords.id })
      .from(schema.wordSeekWords)
      .where(
        and(
          eq(schema.wordSeekWords.communityId, communityId),
          eq(schema.wordSeekWords.word, guess),
          eq(schema.wordSeekWords.wordLength, session.wordLength),
          eq(schema.wordSeekWords.status, 'APPROVED'),
          lte(schema.wordSeekWords.updatedAt, session.createdAt),
        ),
      )
      .limit(1)
    return Boolean(projectWord)
  }

  private async guessCount(database: Executor, sessionId: string): Promise<number> {
    const [row] = await database
      .select({ count: sql<string>`count(*)` })
      .from(schema.wordSeekGuesses)
      .where(eq(schema.wordSeekGuesses.sessionId, sessionId))
    return Number(row?.count ?? 0)
  }

  private async closeLiveSession(
    database: Transaction,
    sessionId: string,
    status: 'TIMED_OUT' | 'ENDED',
    completedAt: Date,
  ) {
    const [session] = await database
      .update(schema.wordSeekSessions)
      .set({ status, activeKey: null, completedAt })
      .where(
        and(eq(schema.wordSeekSessions.id, sessionId), eq(schema.wordSeekSessions.status, 'LIVE')),
      )
      .returning({ id: schema.wordSeekSessions.id })
    return { guessesUsed: await this.guessCount(database, session?.id ?? sessionId) }
  }
}

function configuredNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function matchesDifficulty(value: string, difficulty: ResolvedDifficulty): boolean {
  const normalized = value.trim().toUpperCase()
  return normalized === 'AUTO' || normalized === difficulty
}
