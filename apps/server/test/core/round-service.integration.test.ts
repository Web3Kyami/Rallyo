import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { eq, sql } from 'drizzle-orm'

import { RoundService } from '../../src/core/round-service'
import { ScheduleService } from '../../src/core/schedule-service'
import { ScheduleWorker } from '../../src/core/schedule-worker'
import { ScheduledQuizService } from '../../src/core/scheduled-quiz-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'
import { processClueRevealTick } from '../../src/telegram/runtime'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

const ids = {
  community: '00000000-0000-4000-8000-000000000001',
  season: '00000000-0000-4000-8000-000000000002',
  question: '00000000-0000-4000-8000-000000000003',
  round: '00000000-0000-4000-8000-000000000004',
  playerOne: '00000000-0000-4000-8000-000000000005',
  playerTwo: '00000000-0000-4000-8000-000000000006',
} as const

describeDatabase('RoundService against PostgreSQL', () => {
  if (!databaseUrl) {
    return
  }

  const { db, close } = createDatabase(databaseUrl)
  const service = new RoundService(db)
  const schedules = new ScheduleService(db)
  const now = new Date('2026-09-12T12:00:00.000Z')

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
  })

  afterAll(async () => {
    await close()
  })

  async function seedLiveRound(input?: {
    readonly mode?: 'QUICK' | 'FIRST_CORRECT' | 'CLUE'
    readonly startsAt?: Date
    readonly locksAt?: Date
    readonly seasonEndsAt?: Date
  }) {
    const mode = input?.mode ?? 'QUICK'
    const startsAt = input?.startsAt ?? new Date(now.getTime() - 30_000)
    const locksAt = input?.locksAt ?? new Date(startsAt.getTime() + 60_000)

    await db.insert(schema.players).values([{ id: ids.playerOne }, { id: ids.playerTwo }])
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 1n,
      title: 'Integration test community',
      slug: 'integration-test-community',
    })
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.community,
      name: 'Integration season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: input?.seasonEndsAt ?? new Date(now.getTime() + 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.questions).values({
      id: ids.question,
      scope: 'COMMUNITY',
      communityId: ids.community,
      source: 'MANUAL',
      mode,
      category: 'test',
      difficulty: 'easy',
      prompt: 'What proves wallet control without moving NIM?',
      correctAnswer: 'sign a message',
      acceptedAnswers: ['sign a message', 'signMessage'],
      clueData:
        mode === 'CLUE'
          ? {
              clues: [
                'I prove control without spending anything.',
                'A wallet asks you to approve text.',
                'The proof is not a transfer.',
              ],
            }
          : undefined,
      basePoints: mode === 'FIRST_CORRECT' ? 15 : 20,
      fingerprint: `integration-${mode}`,
      status: 'APPROVED',
    })
    await db.insert(schema.rounds).values({
      id: ids.round,
      communityId: ids.community,
      seasonId: ids.season,
      questionId: ids.question,
      state: 'LIVE',
      startsAt,
      locksAt,
    })
  }

  it('uses unique constraints to reject duplicate answers and score events', async () => {
    await seedLiveRound()

    const results = await Promise.all([
      service.submitQuickQuizAnswer({
        telegramUpdateId: 101n,
        telegramInputId: 'chat:1:message:1',
        roundId: ids.round,
        playerId: ids.playerOne,
        rawAnswer: 'Sign a message',
        now,
      }),
      service.submitQuickQuizAnswer({
        telegramUpdateId: 102n,
        telegramInputId: 'chat:1:message:2',
        roundId: ids.round,
        playerId: ids.playerOne,
        rawAnswer: 'Sign a message',
        now,
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['ACCEPTED', 'DUPLICATE_ANSWER'])
    expect(await db.select().from(schema.answers)).toHaveLength(1)
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
  })

  it('starts an approved round and records question usage transactionally', async () => {
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 1n,
      title: 'Startable community',
      slug: 'startable-community',
    })
    await db.insert(schema.seasons).values({
      id: ids.season,
      communityId: ids.community,
      name: 'Startable season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.questions).values({
      id: ids.question,
      scope: 'COMMUNITY',
      communityId: ids.community,
      source: 'MANUAL',
      mode: 'QUICK',
      category: 'test',
      difficulty: 'easy',
      prompt: 'What proves wallet control?',
      correctAnswer: 'sign a message',
      acceptedAnswers: ['sign a message'],
      basePoints: 20,
      fingerprint: 'startable-question',
      status: 'APPROVED',
    })

    const round = await service.startLiveRound({
      communityId: ids.community,
      seasonId: ids.season,
      questionId: ids.question,
      startsAt: now,
      locksAt: new Date(now.getTime() + 30_000),
      now,
    })

    expect(round.state).toBe('LIVE')
    expect(await db.select().from(schema.questionUsages)).toHaveLength(1)
    expect(await service.attachTelegramMessageId(round.id, 9001n)).toBe(true)
    expect(await service.attachTelegramMessageId(round.id, 9002n)).toBe(false)
    await expect(
      service.startLiveRound({
        communityId: ids.community,
        seasonId: ids.season,
        questionId: ids.question,
        startsAt: now,
        locksAt: new Date(now.getTime() + 30_000),
        now,
      }),
    ).rejects.toThrow('already has a live round')
  })

  it('claims a due schedule once, leases it, and reclaims it after restart/expiry', async () => {
    await db.insert(schema.communities).values({
      id: ids.community,
      telegramChatId: 1n,
      title: 'Scheduled community',
      slug: 'scheduled-community',
    })
    const [schedule] = await db
      .insert(schema.schedules)
      .values({
        communityId: ids.community,
        kind: 'SCHEDULED_QUIZ',
        payload: { questionCount: 3 },
        nextRunAt: now,
      })
      .returning()

    if (!schedule) throw new Error('Schedule fixture was not created.')

    const claims = await Promise.all([
      schedules.claimDueSchedules(now),
      schedules.claimDueSchedules(now),
    ])
    expect(claims.flat()).toHaveLength(1)
    const claimed = claims.flat()[0]
    expect(claimed?.lockVersion).toBe(1)
    expect(claimed?.lockedUntil).toEqual(new Date(now.getTime() + 60_000))
    expect(await schedules.claimDueSchedules(now)).toEqual([])

    const restartedSchedules = new ScheduleService(db)
    expect(
      await restartedSchedules.completeSchedule({
        id: schedule.id,
        lockVersion: claimed!.lockVersion,
        nextRunAt: new Date(now.getTime() + 120_000),
        now,
      }),
    ).toBe(true)
    expect(await schedules.claimDueSchedules(new Date(now.getTime() + 60_000))).toEqual([])

    const [reclaimed] = await restartedSchedules.claimDueSchedules(
      new Date(now.getTime() + 120_000),
    )
    expect(reclaimed?.id).toBe(schedule.id)
    expect(reclaimed?.lockVersion).toBe(2)
  })

  it('creates a persisted scheduled quiz and advances its claimed job exactly once', async () => {
    await seedLiveRound({ startsAt: now })
    const scheduledQuizzes = new ScheduledQuizService(db)
    const created = await scheduledQuizzes.create({
      communityId: ids.community,
      seasonId: ids.season,
      name: 'Integration scheduled quiz',
      sourcePolicy: 'MANUAL',
      startsAt: now,
      perQuestionSeconds: 30,
      questionIds: [ids.question],
    })

    expect(created.quiz.status).toBe('SCHEDULED')
    expect(await scheduledQuizzes.nextQuestion(created.quiz.id, 1)).toMatchObject({
      questionId: ids.question,
      sequence: 1,
    })

    const handled = vi.fn()
    const worker = new ScheduleWorker(schedules, ({ schedule }) => {
      handled(schedule.id)
      return Promise.resolve({ enabled: false })
    })
    await worker.tick(now)
    await worker.tick(now)

    expect(handled).toHaveBeenCalledTimes(1)
    const [persistedSchedule] = await db
      .select({ enabled: schema.schedules.enabled, lastRunAt: schema.schedules.lastRunAt })
      .from(schema.schedules)
      .where(eq(schema.schedules.id, created.schedule.id))
    expect(persistedSchedule).toMatchObject({ enabled: false, lastRunAt: now })
  })

  it('processes a replayed Telegram update only once', async () => {
    await seedLiveRound()
    const submission = {
      telegramUpdateId: 201n,
      telegramInputId: 'callback:201',
      roundId: ids.round,
      playerId: ids.playerOne,
      rawAnswer: 'sign a message',
      now,
    }

    expect((await service.submitQuickQuizAnswer(submission)).status).toBe('ACCEPTED')
    expect((await service.submitQuickQuizAnswer(submission)).status).toBe('DUPLICATE_UPDATE')
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
  })

  it('retains a First Correct winner across service restart and rejects a retry', async () => {
    await seedLiveRound({ mode: 'FIRST_CORRECT' })
    const submission = {
      telegramUpdateId: 251n,
      telegramInputId: 'chat:1:message:251',
      roundId: ids.round,
      playerId: ids.playerOne,
      rawAnswer: 'sign a message',
      now,
    }

    expect((await service.claimFirstCorrect(submission)).status).toBe('WON')

    const restartedService = new RoundService(db)
    expect((await restartedService.claimFirstCorrect(submission)).status).toBe('DUPLICATE_UPDATE')
    expect(await restartedService.leaderboardForSeason(ids.community, ids.season)).toEqual([
      { playerId: ids.playerOne, points: 15, rank: 1 },
    ])
  })

  it('atomically locks First Correct to a single winner', async () => {
    await seedLiveRound({ mode: 'FIRST_CORRECT' })
    await service.attachTelegramMessageId(ids.round, 9901n)

    const results = await Promise.all([
      service.claimFirstCorrect({
        telegramUpdateId: 301n,
        telegramInputId: 'chat:1:message:301',
        roundId: ids.round,
        playerId: ids.playerOne,
        rawAnswer: 'signMessage',
        now,
      }),
      service.claimFirstCorrect({
        telegramUpdateId: 302n,
        telegramInputId: 'chat:1:message:302',
        roundId: ids.round,
        playerId: ids.playerTwo,
        rawAnswer: 'sign a message',
        now,
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['ROUND_CLOSED', 'WON'])
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
    expect(
      await db.select().from(schema.rounds).where(eq(schema.rounds.id, ids.round)),
    ).toMatchObject([{ state: 'LOCKED' }])

    const lockedRound = await service.lockedRoundForCommunity(ids.community, now)
    expect(lockedRound).toMatchObject({
      id: ids.round,
      mode: 'FIRST_CORRECT',
      prompt: 'What proves wallet control without moving NIM?',
      telegramMessageId: 9901n,
    })
    expect(
      await service.lockedRoundForCommunity(ids.community, new Date(now.getTime() + 31_000)),
    ).toBeNull()
  })

  it('rejects an answer after the database round deadline', async () => {
    await seedLiveRound({ locksAt: new Date(now.getTime() - 1) })

    expect(
      (
        await service.submitQuickQuizAnswer({
          telegramUpdateId: 401n,
          telegramInputId: 'callback:401',
          roundId: ids.round,
          playerId: ids.playerOne,
          rawAnswer: 'sign a message',
          now,
        })
      ).status,
    ).toBe('ROUND_CLOSED')
  })

  it('rejects an answer outside the active season boundary', async () => {
    await seedLiveRound({ seasonEndsAt: now })

    expect(
      (
        await service.submitQuickQuizAnswer({
          telegramUpdateId: 451n,
          telegramInputId: 'callback:451',
          roundId: ids.round,
          playerId: ids.playerOne,
          rawAnswer: 'sign a message',
          now,
        })
      ).status,
    ).toBe('ROUND_CLOSED')
  })

  it('derives standings and lifetime XP from persisted score events', async () => {
    await seedLiveRound()

    await service.submitQuickQuizAnswer({
      telegramUpdateId: 501n,
      telegramInputId: 'callback:501',
      roundId: ids.round,
      playerId: ids.playerOne,
      rawAnswer: 'sign a message',
      now,
    })

    expect(await service.leaderboardForSeason(ids.community, ids.season)).toEqual([
      { playerId: ids.playerOne, points: 20, rank: 1 },
    ])
    expect(await service.lifetimeXpForPlayer(ids.playerOne)).toBe(20)
  })

  it('excludes a question used inside the configured cooldown window', async () => {
    await seedLiveRound()
    await db.insert(schema.questionUsages).values({
      questionId: ids.question,
      communityId: ids.community,
      roundId: ids.round,
      usedAt: new Date(now.getTime() - 1_000),
    })

    expect(
      await service.selectEligibleQuestions({
        communityId: ids.community,
        cooldownDays: 30,
        now,
        mode: 'QUICK',
        limit: 10,
      }),
    ).toEqual([])
  })

  it('locks a Clue Round and awards the point curve atomically', async () => {
    await seedLiveRound({ mode: 'CLUE' })

    const results = await Promise.all([
      service.claimClueRoundAnswer({
        telegramUpdateId: 601n,
        telegramInputId: 'chat:1:message:601',
        roundId: ids.round,
        playerId: ids.playerOne,
        rawAnswer: 'signMessage',
        clueNumber: 2,
        now,
      }),
      service.claimClueRoundAnswer({
        telegramUpdateId: 602n,
        telegramInputId: 'chat:1:message:602',
        roundId: ids.round,
        playerId: ids.playerTwo,
        rawAnswer: 'sign a message',
        clueNumber: 2,
        now,
      }),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['ROUND_CLOSED', 'WON'])
    expect(results.find((result) => result.status === 'WON')).toEqual({
      status: 'WON',
      points: 20,
    })
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(1)
    expect(
      await db.select().from(schema.rounds).where(eq(schema.rounds.id, ids.round)),
    ).toMatchObject([{ state: 'LOCKED' }])
    expect(
      await service.claimClueRoundAnswer({
        telegramUpdateId: 601n,
        telegramInputId: 'chat:1:message:601',
        roundId: ids.round,
        playerId: ids.playerOne,
        rawAnswer: 'signMessage',
        clueNumber: 2,
        now,
      }),
    ).toEqual({ status: 'DUPLICATE_UPDATE' })
  })

  it('edits Clue 2 and Clue 3 at elapsed thresholds and resumes after restart', async () => {
    await seedLiveRound({ mode: 'CLUE', startsAt: now })
    await service.attachTelegramMessageId(ids.round, 7001n)

    const sendMessage = vi.fn().mockResolvedValue({ message_id: 8001 })
    const bot = { api: { sendMessage } } as unknown as Parameters<typeof processClueRevealTick>[0]

    await processClueRevealTick(bot, service, new Date(now.getTime() + 19_999))
    expect(sendMessage).not.toHaveBeenCalled()

    await processClueRevealTick(bot, service, new Date(now.getTime() + 20_000))
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[1]).toContain('<b>CLUE 2</b>')
    expect(sendMessage.mock.calls[0]?.[1]).not.toContain('Clue 3')

    const restartedService = new RoundService(db)
    await processClueRevealTick(bot, restartedService, new Date(now.getTime() + 39_999))
    expect(sendMessage).toHaveBeenCalledTimes(1)

    await processClueRevealTick(bot, restartedService, new Date(now.getTime() + 40_000))
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[1]?.[1]).toContain('<b>CLUE 3</b>')

    const [persistedRound] = await db
      .select({ clueNumberPresented: schema.rounds.clueNumberPresented })
      .from(schema.rounds)
      .where(eq(schema.rounds.id, ids.round))
    expect(persistedRound?.clueNumberPresented).toBe(3)
  })
})
