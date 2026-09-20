import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'

import { ActivityService } from '../../src/core/activity-service'
import { CommunityGameConfigService } from '../../src/core/community-game-config-service'
import { CommunityAuthorizationError } from '../../src/core/community-authorization'
import { GameRegistry, projectQuizCompatibilityModule } from '../../src/core/game-registry'
import { ManualScoreService } from '../../src/core/manual-score-service'
import { ScoreEventService } from '../../src/core/score-event-service'
import * as schema from '../../src/db/schema'
import { createDatabase } from '../../src/db/client'
import { SocialTaskService } from '../../src/core/social-task-service'
import { SeasonService } from '../../src/core/season-service'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Phase 7.5A platform contract against PostgreSQL', () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)
  const now = new Date('2026-09-13T12:00:00.000Z')
  const ids = {
    communityOne: '50000000-0000-4000-8000-000000000001',
    communityTwo: '50000000-0000-4000-8000-000000000002',
    season: '50000000-0000-4000-8000-000000000003',
    playerOne: '50000000-0000-4000-8000-000000000004',
    playerTwo: '50000000-0000-4000-8000-000000000005',
  } as const

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values([{ id: ids.playerOne }, { id: ids.playerTwo }])
    await db.insert(schema.communities).values([
      {
        id: ids.communityOne,
        telegramChatId: 5001n,
        title: 'Platform contract one',
        slug: 'platform-contract-one',
      },
      {
        id: ids.communityTwo,
        telegramChatId: 5002n,
        title: 'Platform contract two',
        slug: 'platform-contract-two',
      },
    ])
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.communityOne,
      name: 'Platform contract season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.communityAdmins).values({
      communityId: ids.communityOne,
      telegramUserId: 501n,
      verifiedAt: now,
      lastVerifiedAt: now,
    })
  })

  afterAll(async () => close())

  it('aggregates every source into one leaderboard and rejects duplicate source awards', async () => {
    const scores = new ScoreEventService(db)
    const sourceAwards = [
      ['QUIZ', 10],
      ['WORD_SEEK', 5],
      ['SCRAMBLE', 4],
      ['SOCIAL_TASK', 3],
      ['MANUAL', 2],
    ] as const

    for (const [sourceType, points] of sourceAwards) {
      await scores.award({
        playerId: ids.playerOne,
        communityId: ids.communityOne,
        seasonId: ids.season,
        sourceType,
        sourceId: `${sourceType.toLowerCase()}:1`,
        points,
        reason: `test ${sourceType}`,
        idempotencyKey: `source:${sourceType.toLowerCase()}:1`,
      })
    }

    const duplicate = await scores.award({
      playerId: ids.playerOne,
      communityId: ids.communityOne,
      seasonId: ids.season,
      sourceType: 'SCRAMBLE',
      sourceId: 'scramble:1',
      points: 4,
      reason: 'test SCRAMBLE',
      idempotencyKey: 'source:scramble:1',
    })
    expect(duplicate.created).toBe(false)

    const leaderboard = await db
      .select({
        playerId: schema.scoreEvents.playerId,
        points: sql<string>`sum(${schema.scoreEvents.delta})`,
      })
      .from(schema.scoreEvents)
      .where(
        and(
          eq(schema.scoreEvents.communityId, ids.communityOne),
          eq(schema.scoreEvents.seasonId, ids.season),
        ),
      )
      .groupBy(schema.scoreEvents.playerId)

    expect(leaderboard).toEqual([{ playerId: ids.playerOne, points: '24' }])
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(5)
  })

  it('isolates capabilities and permits the compatibility Project Quiz default', async () => {
    const configurations = new CommunityGameConfigService(db)
    const registry = new GameRegistry(configurations).register(projectQuizCompatibilityModule())

    await expect(
      registry.canStart({
        gameKey: 'project_quiz',
        communityId: ids.communityOne,
        now,
        config: {},
      }),
    ).resolves.toBeUndefined()

    const wordModule = {
      key: 'word_seek' as const,
      validateStart: () => Promise.resolve(),
    }
    const wordRegistry = new GameRegistry(configurations).register(wordModule)
    await configurations.set({
      communityId: ids.communityOne,
      gameKey: 'word_seek',
      enabled: true,
      config: { source: 'PROJECT_BRAIN' },
    })

    await expect(
      wordRegistry.canStart({
        gameKey: 'word_seek',
        communityId: ids.communityOne,
        now,
        config: {},
      }),
    ).resolves.toBeUndefined()
    await expect(
      wordRegistry.canStart({
        gameKey: 'word_seek',
        communityId: ids.communityTwo,
        now,
        config: {},
      }),
    ).rejects.toThrow('disabled')
  })

  it('approves one social submission into one idempotent ScoreEvent', async () => {
    const tasks = new SocialTaskService(db)
    const task = await tasks.createTask({
      communityId: ids.communityOne,
      title: 'Share the project',
      instructions: 'Post a short project update and submit the URL.',
      points: 8,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      createdByTelegramUserId: 501n,
    })
    const submission = await tasks.submit({
      taskId: task.id,
      playerId: ids.playerOne,
      reference: 'https://example.com/post-1',
      now,
    })

    const approved = await tasks.approve({
      submissionId: submission.id,
      reviewerTelegramUserId: 501n,
      now,
    })
    const repeated = await tasks.approve({
      submissionId: submission.id,
      reviewerTelegramUserId: 501n,
      now,
    })

    expect(approved.created).toBe(true)
    expect(repeated.created).toBe(false)
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.sourceType, 'SOCIAL_TASK')),
    ).toHaveLength(1)

    const selected = await tasks.beginSubmissionSession({
      telegramUserId: 700n,
      communityId: ids.communityOne,
      taskId: task.id,
      now,
    })
    expect(selected.task.id).toBe(task.id)
    await expect(
      tasks.activeSubmissionSession({
        telegramUserId: 700n,
        communityId: ids.communityTwo,
        now,
      }),
    ).resolves.toBeNull()
    await tasks.clearSubmissionSession(700n, ids.communityOne)

    const secondSubmission = await tasks.submit({
      taskId: task.id,
      playerId: ids.playerTwo,
      reference: 'https://example.com/post-2',
      now,
    })
    await expect(
      tasks.approve({
        submissionId: secondSubmission.id,
        reviewerTelegramUserId: 999n,
        now,
      }),
    ).rejects.toThrow('not authorized')

    const rejected = await tasks.reject({
      submissionId: secondSubmission.id,
      reviewerTelegramUserId: 501n,
      now,
    })
    const repeatedRejection = await tasks.reject({
      submissionId: secondSubmission.id,
      reviewerTelegramUserId: 501n,
      now,
    })
    expect(rejected.created).toBe(true)
    expect(repeatedRejection.created).toBe(false)
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.sourceType, 'SOCIAL_TASK')),
    ).toHaveLength(1)
  })

  it('creates and closes a community season without wallet configuration', async () => {
    const seasons = new SeasonService(db)

    await expect(
      seasons.createAndActivate({
        communityId: ids.communityOne,
        name: 'Overlapping season',
        startsAt: now,
        endsAt: new Date(now.getTime() + 60_000),
        winnerCount: 3,
        actorTelegramUserId: 501n,
      }),
    ).rejects.toThrow('active season')

    await expect(
      seasons.createAndActivate({
        communityId: ids.communityTwo,
        name: 'Unauthorized season',
        startsAt: now,
        endsAt: new Date(now.getTime() + 60_000),
        winnerCount: 3,
        actorTelegramUserId: 501n,
      }),
    ).rejects.toThrow('not authorized')

    await db.insert(schema.communityAdmins).values({
      communityId: ids.communityTwo,
      telegramUserId: 502n,
      verifiedAt: now,
      lastVerifiedAt: now,
    })
    const created = await seasons.createAndActivate({
      communityId: ids.communityTwo,
      name: 'Community two season',
      startsAt: now,
      endsAt: new Date(now.getTime() + 60_000),
      winnerCount: 5,
      actorTelegramUserId: 502n,
    })

    expect(created.status).toBe('ACTIVE')
    expect(created.winnerCount).toBe(5)
    expect((await seasons.activeForCommunity(ids.communityTwo, now))?.id).toBe(created.id)

    const ended = await seasons.end({
      communityId: ids.communityTwo,
      seasonId: created.id,
      actorTelegramUserId: 502n,
    })
    expect(ended?.status).toBe('CLOSED')
    expect(await seasons.activeForCommunity(ids.communityTwo, now)).toBeNull()
  })

  it('supports recurring screenshot proof and enforces its daily cap', async () => {
    const tasks = new SocialTaskService(db)
    const task = await tasks.createTask({
      communityId: ids.communityOne,
      title: 'Daily contribution',
      instructions: 'Share a project update and attach proof.',
      points: 7,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      taskType: 'RECURRING',
      platform: 'X',
      action: 'POST',
      proofType: 'URL_SCREENSHOT',
      maxApprovedSubmissionsPerPlayerPerDay: 1,
      createdByTelegramUserId: 501n,
    })

    const submission = await tasks.submit({
      taskId: task.id,
      playerId: ids.playerOne,
      url: 'https://example.com/daily-1',
      proofType: 'URL_SCREENSHOT',
      screenshotFileId: 'telegram-file-1',
      screenshotFileUniqueId: 'telegram-unique-1',
      screenshotMimeType: 'image/png',
      screenshotFileSize: 1024,
      now,
    })
    expect(submission.proofType).toBe('URL_SCREENSHOT')
    expect(submission.screenshotFileId).toBe('telegram-file-1')

    await tasks.approve({
      submissionId: submission.id,
      reviewerTelegramUserId: 501n,
      now,
    })
    await expect(
      tasks.submit({
        taskId: task.id,
        playerId: ids.playerOne,
        url: 'https://example.com/daily-2',
        proofType: 'URL_SCREENSHOT',
        screenshotFileId: 'telegram-file-2',
        now: new Date(now.getTime() + 30 * 60_000),
      }),
    ).rejects.toThrow('daily submission limit')
  })

  it('supports campaign completion limits and rejection without points', async () => {
    const tasks = new SocialTaskService(db)
    const task = await tasks.createTask({
      communityId: ids.communityOne,
      title: 'Campaign contribution',
      instructions: 'Complete the campaign and submit its link.',
      points: 9,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      taskType: 'CAMPAIGN',
      platform: 'INSTAGRAM',
      action: 'COMMENT_REPLY',
      targetUrl: 'https://example.com/campaign',
      proofType: 'URL',
      completionCapPerPlayer: 1,
      createdByTelegramUserId: 501n,
    })
    const submission = await tasks.submit({
      taskId: task.id,
      playerId: ids.playerOne,
      url: 'https://example.com/proof',
      proofType: 'URL',
      now,
    })
    await tasks.reject({
      submissionId: submission.id,
      reviewerTelegramUserId: 501n,
      now,
    })
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(0)

    const retry = await tasks.submit({
      taskId: task.id,
      playerId: ids.playerOne,
      url: 'https://example.com/proof-retry',
      proofType: 'URL',
      now,
    })
    await tasks.approve({
      submissionId: retry.id,
      reviewerTelegramUserId: 501n,
      now,
    })
    await expect(
      tasks.submit({
        taskId: task.id,
        playerId: ids.playerOne,
        url: 'https://example.com/proof-again',
        proofType: 'URL',
        now: new Date(now.getTime() + 1_000),
      }),
    ).rejects.toThrow('per-player limit')
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
  })

  it('creates one audited positive manual award and rejects unauthorized awards', async () => {
    const awards = new ManualScoreService(db)
    const input = {
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      points: 11,
      reason: 'Helpful onboarding support',
      awardedByTelegramUserId: 501n,
      idempotencyKey: 'manual-award:1',
      now,
    } as const

    const first = await awards.award(input)
    const second = await awards.award(input)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(await db.select().from(schema.manualScoreAwards)).toHaveLength(1)
    expect(
      await db.select().from(schema.scoreEvents).where(eq(schema.scoreEvents.sourceType, 'MANUAL')),
    ).toHaveLength(1)

    const deduction = await awards.award({
      communityId: input.communityId,
      playerId: input.playerId,
      points: -5,
      awardedByTelegramUserId: input.awardedByTelegramUserId,
      idempotencyKey: 'manual-award:negative',
      now: input.now,
    })
    expect(deduction.created).toBe(true)
    expect(deduction.scoreEvent.delta).toBe(-5)
    expect(deduction.award.reason).toBe('Admin adjustment')
    expect(
      await db.select().from(schema.scoreEvents).where(eq(schema.scoreEvents.sourceType, 'MANUAL')),
    ).toHaveLength(2)

    await expect(
      awards.award({ ...input, idempotencyKey: 'manual-award:2', awardedByTelegramUserId: 999n }),
    ).rejects.toBeInstanceOf(CommunityAuthorizationError)
  })

  it('stores aggregate activity without crossing community boundaries', async () => {
    const activity = new ActivityService(db)
    const bucket = new Date('2026-09-13T12:00:00.000Z')
    await activity.recordMessage({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      bucketStart: bucket,
    })
    await activity.recordMessage({
      communityId: ids.communityOne,
      playerId: ids.playerOne,
      bucketStart: bucket,
      isReply: true,
    })
    await activity.recordMessage({
      communityId: ids.communityTwo,
      playerId: ids.playerTwo,
      bucketStart: bucket,
    })

    const communityOneStats = await activity.stats({ communityId: ids.communityOne })
    expect(communityOneStats).toHaveLength(1)
    expect(communityOneStats[0]).toMatchObject({ messageCount: 2, replyCount: 1 })
    expect(await activity.stats({ communityId: ids.communityTwo })).toHaveLength(1)
  })
})
