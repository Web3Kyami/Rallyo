import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'

import {
  AppApiForbiddenError,
  AppApiNotFoundError,
  AppApiService,
  AppApiValidationError,
} from '../../src/core/app-api-service'
import { ActivityService } from '../../src/core/activity-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import type { AppSessionActor } from '../../src/core/app-session-service'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Community Admin API seams against PostgreSQL', () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)
  const api = new AppApiService(db)
  const now = new Date('2026-09-15T12:00:00.000Z')
  const ids = {
    communityOne: '70000000-0000-4000-8000-000000000001',
    communityTwo: '70000000-0000-4000-8000-000000000002',
    seasonOne: '70000000-0000-4000-8000-000000000003',
    playerOne: '70000000-0000-4000-8000-000000000004',
    playerTwo: '70000000-0000-4000-8000-000000000005',
    identityOne: '70000000-0000-4000-8000-000000000006',
    identityTwo: '70000000-0000-4000-8000-000000000007',
  } as const

  const adminOne = actor(ids.playerOne, ids.identityOne, 7001n)
  const adminTwo = actor(ids.playerTwo, ids.identityTwo, 7002n)

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values([{ id: ids.playerOne }, { id: ids.playerTwo }])
    await db.insert(schema.telegramIdentities).values([
      {
        id: ids.identityOne,
        playerId: ids.playerOne,
        telegramUserId: 7001n,
        displayName: 'Admin One',
        username: 'admin-one',
      },
      {
        id: ids.identityTwo,
        playerId: ids.playerTwo,
        telegramUserId: 7002n,
        displayName: 'Admin Two',
        username: 'admin-two',
      },
    ])
    await db.insert(schema.communities).values([
      {
        id: ids.communityOne,
        telegramChatId: 70001n,
        title: 'Admin One Community',
        slug: 'admin-one-community',
      },
      {
        id: ids.communityTwo,
        telegramChatId: 70002n,
        title: 'Admin Two Community',
        slug: 'admin-two-community',
      },
    ])
    await db.insert(schema.communityAdmins).values([
      {
        communityId: ids.communityOne,
        telegramUserId: 7001n,
        verifiedAt: now,
        lastVerifiedAt: now,
      },
      {
        communityId: ids.communityTwo,
        telegramUserId: 7002n,
        verifiedAt: now,
        lastVerifiedAt: now,
      },
    ])
    await db.insert(schema.seasons).values({
      id: ids.seasonOne,
      communityId: ids.communityOne,
      name: 'Admin season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      status: 'ACTIVE',
    })
  })

  afterAll(async () => close())

  it('authorizes community game mutations and rejects unsupported configuration', async () => {
    await expect(
      api.adminSetGameCapability(adminOne, ids.communityTwo, {
        gameKey: 'scramble',
        enabled: true,
        config: {},
      }),
    ).rejects.toBeInstanceOf(AppApiForbiddenError)

    await expect(
      api.adminSetGameCapability(adminOne, ids.communityOne, {
        gameKey: 'not-a-game',
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(AppApiValidationError)

    await expect(
      api.adminSetGameCapability(adminOne, ids.communityOne, {
        gameKey: 'project_quiz',
        enabled: true,
        config: { hintsEnabled: true, startingPoints: 10, pointReductions: [10] },
      }),
    ).rejects.toThrow('Point reductions must leave at least one point available.')

    const saved = await api.adminSetGameCapability(adminOne, ids.communityOne, {
      gameKey: 'word_seek',
      enabled: true,
      config: { source: 'PROJECT', wordLength: 5 },
    })
    expect(saved).toMatchObject({ gameKey: 'word_seek', enabled: true })
  })

  it('keeps social approval exactly once and rolls back when the season invariant fails', async () => {
    const communityOneTask = await api.adminCreateTask(adminOne, ids.communityOne, {
      title: 'Share the project',
      instructions: 'Post a project update and submit the reference.',
      points: 8,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
    })
    const [submissionOne] = await db
      .insert(schema.socialTaskSubmissions)
      .values({
        taskId: communityOneTask.id,
        playerId: ids.playerOne,
        reference: 'https://example.com/admin-one',
      })
      .returning()

    const first = await api.adminApproveSubmission(
      adminOne,
      ids.communityOne,
      submissionOne!.id,
      now,
    )
    const repeated = await api.adminApproveSubmission(
      adminOne,
      ids.communityOne,
      submissionOne!.id,
      now,
    )
    expect(first.created).toBe(true)
    expect(repeated.created).toBe(false)
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(
          and(
            eq(schema.scoreEvents.communityId, ids.communityOne),
            eq(schema.scoreEvents.sourceType, 'SOCIAL_TASK'),
          ),
        ),
    ).toHaveLength(1)

    const communityTwoTask = await api.adminCreateTask(adminTwo, ids.communityTwo, {
      title: 'No season task',
      instructions: 'This cannot award until the community has an active season.',
      points: 5,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
    })
    const [submissionTwo] = await db
      .insert(schema.socialTaskSubmissions)
      .values({
        taskId: communityTwoTask.id,
        playerId: ids.playerTwo,
        reference: 'https://example.com/admin-two',
      })
      .returning()

    await expect(
      api.adminApproveSubmission(adminTwo, ids.communityTwo, submissionTwo!.id, now),
    ).rejects.toThrow('An active season is required for social points.')
    const [rolledBackSubmission] = await db
      .select({ status: schema.socialTaskSubmissions.status })
      .from(schema.socialTaskSubmissions)
      .where(eq(schema.socialTaskSubmissions.id, submissionTwo!.id))
    expect(rolledBackSubmission?.status).toBe('PENDING')
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.communityId, ids.communityTwo)),
    ).toHaveLength(0)

    await expect(
      api.adminApproveSubmission(adminOne, ids.communityOne, submissionTwo!.id, now),
    ).rejects.toBeInstanceOf(AppApiNotFoundError)
  })

  it('keeps project content drafts and approvals community-scoped', async () => {
    const question = await api.adminCreateQuestionDraft(adminOne, ids.communityOne, {
      sourceTitle: 'Project notes',
      sourceText: 'Rallyo uses a signed message to verify wallet control safely.',
      prompt: 'What verifies wallet control without moving funds?',
      correctAnswer: 'A signed message',
      category: 'Security',
      difficulty: 'easy',
    })
    expect(question.status).toBe('DRAFT')
    const word = await api.adminCreateWordDraft(adminOne, ids.communityOne, {
      word: 'RALLY',
      clue: 'A community game starts here.',
    })
    expect(word.status).toBe('DRAFT')

    const content = await api.adminContent(adminOne, ids.communityOne)
    expect(content.questions).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'DRAFT' })]),
    )
    expect(content.words).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'DRAFT' })]),
    )

    await expect(
      api.adminApproveQuestion(adminOne, ids.communityOne, question.id),
    ).resolves.toMatchObject({
      status: 'APPROVED',
    })
    await expect(api.adminApproveWord(adminOne, ids.communityOne, word.id)).resolves.toMatchObject({
      status: 'APPROVED',
    })
    await expect(api.adminApproveQuestion(adminOne, ids.communityOne, question.id)).rejects.toThrow(
      'Only an existing draft can be approved.',
    )

    await expect(api.adminContent(adminOne, ids.communityTwo)).rejects.toBeInstanceOf(
      AppApiForbiddenError,
    )
  })

  it('returns real isolated activity and reward summaries', async () => {
    const activity = new ActivityService(db)
    await activity.recordMessage({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      bucketStart: now,
    })
    await activity.recordMessage({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      bucketStart: now,
      isReply: true,
    })
    await db.insert(schema.rewardEntitlements).values({
      seasonId: ids.seasonOne,
      playerId: ids.playerOne,
      rank: 1,
      amountLuna: 123n,
      idempotencyKey: 'admin-summary:one',
      status: 'ELIGIBLE',
    })

    const overview = await api.adminOverview(adminOne, ids.communityOne, now)
    expect(overview.activity).toMatchObject({
      messageCount: 2,
      replyCount: 1,
      activePlayers: 1,
    })
    expect(overview.rewards).toMatchObject({
      entitlementCount: 1,
      totalAmountLuna: '123',
      eligibleCount: 1,
    })
    expect((await api.adminOverview(adminTwo, ids.communityTwo, now)).activity.messageCount).toBe(0)
  })
})

function actor(
  playerId: string,
  telegramIdentityId: string,
  telegramUserId: bigint,
): AppSessionActor {
  return {
    sessionId: `admin-session-${telegramUserId.toString()}`,
    playerId,
    telegramIdentityId,
    telegramUserId,
    targetCommunityId: null,
    targetMode: 'admin',
    expiresAt: new Date('2026-09-16T12:00:00.000Z'),
  }
}
