import { and, asc, desc, eq, gt, gte, lt, lte } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { assertCommunityAdmin } from './community-authorization'
import { awardScoreEvent } from './score-event-service'

export class SocialTaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocialTaskError'
  }
}

export class SocialTaskService {
  constructor(private readonly database: RallyoDatabase) {}

  async archiveExpired(now: Date, communityId?: string): Promise<number> {
    const rows = await this.database
      .update(schema.socialTasks)
      .set({ status: 'ARCHIVED', updatedAt: now })
      .where(
        and(
          eq(schema.socialTasks.status, 'ACTIVE'),
          lte(schema.socialTasks.endsAt, now),
          ...(communityId ? [eq(schema.socialTasks.communityId, communityId)] : []),
        ),
      )
      .returning({ id: schema.socialTasks.id })

    return rows.length
  }

  async listActive(communityId: string, now: Date) {
    await this.archiveExpired(now, communityId)
    return this.database
      .select()
      .from(schema.socialTasks)
      .where(
        and(
          eq(schema.socialTasks.communityId, communityId),
          eq(schema.socialTasks.status, 'ACTIVE'),
          lte(schema.socialTasks.startsAt, now),
          gt(schema.socialTasks.endsAt, now),
        ),
      )
      .orderBy(asc(schema.socialTasks.endsAt), asc(schema.socialTasks.title))
  }

  async listPendingSubmissions(communityId: string, now: Date) {
    await this.archiveExpired(now, communityId)
    return this.database
      .select({
        submission: schema.socialTaskSubmissions,
        task: schema.socialTasks,
        player: schema.telegramIdentities,
      })
      .from(schema.socialTaskSubmissions)
      .innerJoin(schema.socialTasks, eq(schema.socialTaskSubmissions.taskId, schema.socialTasks.id))
      .innerJoin(
        schema.telegramIdentities,
        eq(schema.socialTaskSubmissions.playerId, schema.telegramIdentities.playerId),
      )
      .where(
        and(
          eq(schema.socialTasks.communityId, communityId),
          eq(schema.socialTaskSubmissions.status, 'PENDING'),
        ),
      )
      .orderBy(desc(schema.socialTaskSubmissions.createdAt))
  }

  async communityForSubmission(submissionId: string) {
    const [row] = await this.database
      .select({ communityId: schema.socialTasks.communityId })
      .from(schema.socialTaskSubmissions)
      .innerJoin(schema.socialTasks, eq(schema.socialTaskSubmissions.taskId, schema.socialTasks.id))
      .where(eq(schema.socialTaskSubmissions.id, submissionId))
      .limit(1)

    return row ?? null
  }

  async beginSubmissionSession(input: {
    readonly telegramUserId: bigint
    readonly communityId: string
    readonly taskId: string
    readonly now: Date
  }) {
    const [task] = await this.database
      .select({
        id: schema.socialTasks.id,
        communityId: schema.socialTasks.communityId,
        title: schema.socialTasks.title,
        status: schema.socialTasks.status,
        startsAt: schema.socialTasks.startsAt,
        endsAt: schema.socialTasks.endsAt,
      })
      .from(schema.socialTasks)
      .where(eq(schema.socialTasks.id, input.taskId))
      .limit(1)

    if (
      !task ||
      task.communityId !== input.communityId ||
      task.status !== 'ACTIVE' ||
      input.now < task.startsAt ||
      input.now >= task.endsAt
    ) {
      throw new SocialTaskError('This social task is not accepting submissions.')
    }

    const expiresAt = new Date(Math.min(input.now.getTime() + 15 * 60_000, task.endsAt.getTime()))
    const [session] = await this.database
      .insert(schema.socialTaskSubmissionSessions)
      .values({
        telegramUserId: input.telegramUserId,
        communityId: input.communityId,
        taskId: input.taskId,
        expiresAt,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          schema.socialTaskSubmissionSessions.telegramUserId,
          schema.socialTaskSubmissionSessions.communityId,
        ],
        set: {
          taskId: input.taskId,
          expiresAt,
          updatedAt: input.now,
        },
      })
      .returning()

    if (!session) throw new SocialTaskError('The submission step could not be started.')
    return { session, task }
  }

  async activeSubmissionSession(input: {
    readonly telegramUserId: bigint
    readonly communityId: string
    readonly now: Date
  }) {
    const [session] = await this.database
      .select({ session: schema.socialTaskSubmissionSessions, task: schema.socialTasks })
      .from(schema.socialTaskSubmissionSessions)
      .innerJoin(
        schema.socialTasks,
        eq(schema.socialTaskSubmissionSessions.taskId, schema.socialTasks.id),
      )
      .where(
        and(
          eq(schema.socialTaskSubmissionSessions.telegramUserId, input.telegramUserId),
          eq(schema.socialTaskSubmissionSessions.communityId, input.communityId),
          gt(schema.socialTaskSubmissionSessions.expiresAt, input.now),
        ),
      )
      .limit(1)

    return session ?? null
  }

  async clearSubmissionSession(telegramUserId: bigint, communityId: string): Promise<void> {
    await this.database
      .delete(schema.socialTaskSubmissionSessions)
      .where(
        and(
          eq(schema.socialTaskSubmissionSessions.telegramUserId, telegramUserId),
          eq(schema.socialTaskSubmissionSessions.communityId, communityId),
        ),
      )
  }

  async createTask(input: {
    readonly communityId: string
    readonly title: string
    readonly instructions: string
    readonly points: number
    readonly startsAt: Date
    readonly endsAt: Date
    readonly maxSubmissionsPerPlayer?: number
    readonly cooldownDays?: number
    readonly createdByTelegramUserId: bigint
  }) {
    if (!Number.isSafeInteger(input.points) || input.points <= 0) {
      throw new SocialTaskError('Social task points must be a positive safe integer.')
    }
    if (input.endsAt <= input.startsAt) {
      throw new SocialTaskError('Social task end time must be after its start time.')
    }
    if (
      input.maxSubmissionsPerPlayer !== undefined &&
      (!Number.isSafeInteger(input.maxSubmissionsPerPlayer) || input.maxSubmissionsPerPlayer <= 0)
    ) {
      throw new SocialTaskError('Social task submission caps must be positive.')
    }
    if (
      input.cooldownDays !== undefined &&
      (!Number.isInteger(input.cooldownDays) || input.cooldownDays < 0)
    ) {
      throw new SocialTaskError('Social task cooldown days cannot be negative.')
    }

    await assertCommunityAdmin(this.database, input.communityId, input.createdByTelegramUserId)

    const [community] = await this.database
      .select({ status: schema.communities.status })
      .from(schema.communities)
      .where(eq(schema.communities.id, input.communityId))
      .limit(1)
    if (!community || community.status !== 'ACTIVE') {
      throw new SocialTaskError('Social tasks require an active community.')
    }

    const [task] = await this.database
      .insert(schema.socialTasks)
      .values({
        communityId: input.communityId,
        title: input.title,
        instructions: input.instructions,
        points: input.points,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...(input.maxSubmissionsPerPlayer === undefined
          ? {}
          : { maxSubmissionsPerPlayer: input.maxSubmissionsPerPlayer }),
        ...(input.cooldownDays === undefined ? {} : { cooldownDays: input.cooldownDays }),
        createdByTelegramUserId: input.createdByTelegramUserId,
      })
      .returning()

    if (!task) throw new SocialTaskError('Social task could not be created.')
    return task
  }

  async submit(input: {
    readonly taskId: string
    readonly playerId: string
    readonly reference: string
    readonly now: Date
  }) {
    const reference = input.reference.trim()
    if (reference.length === 0 || reference.length > 2_000) {
      throw new SocialTaskError(
        'A submission URL or reference from 1 to 2000 characters is required.',
      )
    }

    return this.database.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(schema.socialTasks)
        .where(eq(schema.socialTasks.id, input.taskId))
        .for('update')
      if (
        !task ||
        task.status !== 'ACTIVE' ||
        input.now < task.startsAt ||
        input.now >= task.endsAt
      ) {
        throw new SocialTaskError('Social task is not accepting submissions.')
      }

      const existing = await tx
        .select({ id: schema.socialTaskSubmissions.id })
        .from(schema.socialTaskSubmissions)
        .where(
          and(
            eq(schema.socialTaskSubmissions.taskId, input.taskId),
            eq(schema.socialTaskSubmissions.playerId, input.playerId),
            eq(schema.socialTaskSubmissions.status, 'PENDING'),
          ),
        )
      if (
        task.maxSubmissionsPerPlayer !== null &&
        existing.length >= task.maxSubmissionsPerPlayer
      ) {
        throw new SocialTaskError('The player has reached the pending submission cap.')
      }

      if (task.cooldownDays > 0) {
        const cutoff = new Date(input.now.getTime() - task.cooldownDays * 86_400_000)
        const recent = await tx
          .select({ id: schema.socialTaskSubmissions.id })
          .from(schema.socialTaskSubmissions)
          .where(
            and(
              eq(schema.socialTaskSubmissions.taskId, input.taskId),
              eq(schema.socialTaskSubmissions.playerId, input.playerId),
              gte(schema.socialTaskSubmissions.createdAt, cutoff),
              lt(schema.socialTaskSubmissions.createdAt, input.now),
            ),
          )
        if (recent.length > 0) throw new SocialTaskError('The social task cooldown is active.')
      }

      const [submission] = await tx
        .insert(schema.socialTaskSubmissions)
        .values({
          taskId: input.taskId,
          playerId: input.playerId,
          reference,
        })
        .onConflictDoNothing({
          target: [
            schema.socialTaskSubmissions.taskId,
            schema.socialTaskSubmissions.playerId,
            schema.socialTaskSubmissions.reference,
          ],
        })
        .returning()

      if (!submission) throw new SocialTaskError('This social task submission already exists.')
      return submission
    })
  }

  async approve(input: {
    readonly submissionId: string
    readonly reviewerTelegramUserId: bigint
    readonly now: Date
  }) {
    return this.database.transaction(async (tx) => {
      const [submission] = await tx
        .select({
          submission: schema.socialTaskSubmissions,
          task: schema.socialTasks,
        })
        .from(schema.socialTaskSubmissions)
        .innerJoin(
          schema.socialTasks,
          eq(schema.socialTaskSubmissions.taskId, schema.socialTasks.id),
        )
        .where(eq(schema.socialTaskSubmissions.id, input.submissionId))
        .for('update')
      if (!submission) throw new SocialTaskError('Social task submission was not found.')

      const admin = await tx
        .select({ id: schema.communityAdmins.id })
        .from(schema.communityAdmins)
        .where(
          and(
            eq(schema.communityAdmins.communityId, submission.task.communityId),
            eq(schema.communityAdmins.telegramUserId, input.reviewerTelegramUserId),
          ),
        )
        .limit(1)
      if (!admin[0]) throw new SocialTaskError('Reviewer is not authorized for this community.')

      if (submission.submission.status === 'APPROVED') {
        const [event] = await tx
          .select()
          .from(schema.scoreEvents)
          .where(
            and(
              eq(schema.scoreEvents.sourceType, 'SOCIAL_TASK'),
              eq(schema.scoreEvents.sourceId, input.submissionId),
            ),
          )
          .limit(1)
        if (!event) throw new SocialTaskError('Approved submission is missing its score event.')
        return { submission: submission.submission, scoreEvent: event, created: false }
      }
      if (submission.submission.status !== 'PENDING') {
        throw new SocialTaskError('Rejected submissions cannot be approved.')
      }

      const [season] = await tx
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(
          and(
            eq(schema.seasons.communityId, submission.task.communityId),
            eq(schema.seasons.status, 'ACTIVE'),
            lte(schema.seasons.startsAt, input.now),
            gt(schema.seasons.endsAt, input.now),
          ),
        )
        .limit(1)
      if (!season) throw new SocialTaskError('An active season is required for social points.')

      const scoreEvent = await awardScoreEvent(tx, {
        playerId: submission.submission.playerId,
        communityId: submission.task.communityId,
        seasonId: season.id,
        sourceType: 'SOCIAL_TASK',
        sourceId: submission.submission.id,
        points: submission.task.points,
        reason: `SOCIAL_TASK_APPROVED:${submission.task.title}`,
        idempotencyKey: `social-task:${submission.submission.id}`,
      })

      const [updatedSubmission] = await tx
        .update(schema.socialTaskSubmissions)
        .set({
          status: 'APPROVED',
          reviewedByTelegramUserId: input.reviewerTelegramUserId,
          reviewedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(schema.socialTaskSubmissions.id, input.submissionId))
        .returning()

      if (!updatedSubmission)
        throw new SocialTaskError('Social task submission could not be approved.')
      const [event] = await tx
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.id, scoreEvent.id))
        .limit(1)
      if (!event) throw new SocialTaskError('Social task score event could not be loaded.')
      return { submission: updatedSubmission, scoreEvent: event, created: scoreEvent.created }
    })
  }

  async reject(input: {
    readonly submissionId: string
    readonly reviewerTelegramUserId: bigint
    readonly reason?: string
    readonly now: Date
  }) {
    return this.database.transaction(async (tx) => {
      const [submission] = await tx
        .select({ submission: schema.socialTaskSubmissions, task: schema.socialTasks })
        .from(schema.socialTaskSubmissions)
        .innerJoin(
          schema.socialTasks,
          eq(schema.socialTaskSubmissions.taskId, schema.socialTasks.id),
        )
        .where(eq(schema.socialTaskSubmissions.id, input.submissionId))
        .for('update')

      if (!submission) throw new SocialTaskError('Social task submission was not found.')

      const [admin] = await tx
        .select({ id: schema.communityAdmins.id })
        .from(schema.communityAdmins)
        .where(
          and(
            eq(schema.communityAdmins.communityId, submission.task.communityId),
            eq(schema.communityAdmins.telegramUserId, input.reviewerTelegramUserId),
          ),
        )
        .limit(1)
      if (!admin) throw new SocialTaskError('Reviewer is not authorized for this community.')

      if (submission.submission.status === 'REJECTED') {
        return { submission: submission.submission, created: false }
      }
      if (submission.submission.status !== 'PENDING') {
        throw new SocialTaskError('Approved submissions cannot be rejected.')
      }

      const reason = input.reason?.trim() || 'Rejected by a community reviewer.'
      if (reason.length > 500)
        throw new SocialTaskError('Rejection reasons must be 500 characters or fewer.')

      const [updatedSubmission] = await tx
        .update(schema.socialTaskSubmissions)
        .set({
          status: 'REJECTED',
          reviewedByTelegramUserId: input.reviewerTelegramUserId,
          reviewedAt: input.now,
          rejectionReason: reason,
          updatedAt: input.now,
        })
        .where(eq(schema.socialTaskSubmissions.id, input.submissionId))
        .returning()

      if (!updatedSubmission)
        throw new SocialTaskError('Social task submission could not be rejected.')
      return { submission: updatedSubmission, created: true }
    })
  }
}
