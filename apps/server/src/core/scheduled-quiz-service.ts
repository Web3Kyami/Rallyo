import { and, eq, inArray, lte, or } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>

export type ScheduledQuizInput = {
  readonly communityId: string
  readonly seasonId: string
  readonly name: string
  readonly sourcePolicy: string
  readonly startsAt: Date
  readonly perQuestionSeconds: number
  readonly questionIds: readonly string[]
}

export class ScheduledQuizService {
  constructor(private readonly database: Database) {}

  async create(input: ScheduledQuizInput) {
    if (!Number.isSafeInteger(input.perQuestionSeconds) || input.perQuestionSeconds < 1) {
      throw new Error('Per-question duration must be a positive integer.')
    }
    if (input.questionIds.length === 0 || input.questionIds.length > 100) {
      throw new Error('A scheduled quiz must contain between 1 and 100 questions.')
    }

    return this.database.transaction(async (tx) => {
      const [community] = await tx
        .select({ id: schema.communities.id, status: schema.communities.status })
        .from(schema.communities)
        .where(eq(schema.communities.id, input.communityId))
      if (!community || community.status !== 'ACTIVE') throw new Error('Community is not active.')

      const [season] = await tx
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(
          and(
            eq(schema.seasons.id, input.seasonId),
            eq(schema.seasons.communityId, input.communityId),
            eq(schema.seasons.status, 'ACTIVE'),
            lte(schema.seasons.startsAt, input.startsAt),
          ),
        )
      if (!season) throw new Error('Season is not active for this scheduled quiz.')

      const questions = await tx
        .select({
          id: schema.questions.id,
          scope: schema.questions.scope,
          communityId: schema.questions.communityId,
        })
        .from(schema.questions)
        .where(
          and(
            inArray(schema.questions.id, input.questionIds),
            eq(schema.questions.status, 'APPROVED'),
            or(
              eq(schema.questions.scope, 'GLOBAL'),
              and(
                eq(schema.questions.scope, 'COMMUNITY'),
                eq(schema.questions.communityId, input.communityId),
              ),
            ),
          ),
        )
      if (questions.length !== input.questionIds.length) {
        throw new Error('Every scheduled quiz question must be approved for this community.')
      }

      const [quiz] = await tx
        .insert(schema.quizzes)
        .values({
          communityId: input.communityId,
          seasonId: input.seasonId,
          name: input.name,
          sourcePolicy: input.sourcePolicy,
          questionCount: input.questionIds.length,
          startsAt: input.startsAt,
          perQuestionSeconds: input.perQuestionSeconds,
          status: 'SCHEDULED',
        })
        .returning()
      if (!quiz) throw new Error('Scheduled quiz could not be created.')

      await tx.insert(schema.quizQuestions).values(
        input.questionIds.map((questionId, index) => ({
          quizId: quiz.id,
          questionId,
          sequence: index + 1,
        })),
      )

      const [schedule] = await tx
        .insert(schema.schedules)
        .values({
          communityId: input.communityId,
          kind: 'SCHEDULED_QUIZ',
          payload: { quizId: quiz.id, sequence: 1 },
          nextRunAt: input.startsAt,
        })
        .returning()
      if (!schedule) throw new Error('Scheduled quiz trigger could not be created.')

      return { quiz, schedule }
    })
  }

  async nextQuestion(quizId: string, sequence: number) {
    const [row] = await this.database
      .select({
        quiz: schema.quizzes,
        questionId: schema.quizQuestions.questionId,
        sequence: schema.quizQuestions.sequence,
      })
      .from(schema.quizzes)
      .innerJoin(schema.quizQuestions, eq(schema.quizQuestions.quizId, schema.quizzes.id))
      .where(
        and(
          eq(schema.quizzes.id, quizId),
          eq(schema.quizQuestions.sequence, sequence),
          or(eq(schema.quizzes.status, 'SCHEDULED'), eq(schema.quizzes.status, 'LIVE')),
        ),
      )
    return row ?? null
  }

  async markLive(quizId: string) {
    await this.database
      .update(schema.quizzes)
      .set({ status: 'LIVE' })
      .where(and(eq(schema.quizzes.id, quizId), eq(schema.quizzes.status, 'SCHEDULED')))
  }

  async markComplete(quizId: string) {
    await this.database
      .update(schema.quizzes)
      .set({ status: 'COMPLETE' })
      .where(eq(schema.quizzes.id, quizId))
  }
}
