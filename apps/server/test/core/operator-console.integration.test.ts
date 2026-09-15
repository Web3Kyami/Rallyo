import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'

import { issueTelegramPairingCode } from '../../src/core/app-session-service'
import {
  OperatorActionError,
  OperatorConsoleService,
} from '../../src/core/operator-console-service'
import { OperatorSessionService } from '../../src/core/operator-session-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Operator console against PostgreSQL', () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)
  const now = new Date('2026-09-15T12:00:00.000Z')
  const ids = {
    playerOne: '80000000-0000-4000-8000-000000000001',
    playerTwo: '80000000-0000-4000-8000-000000000002',
    identityOne: '80000000-0000-4000-8000-000000000011',
    walletOne: '80000000-0000-4000-8000-000000000012',
    communityOne: '80000000-0000-4000-8000-000000000021',
    communityTwo: '80000000-0000-4000-8000-000000000022',
    seasonOne: '80000000-0000-4000-8000-000000000031',
    seasonTwo: '80000000-0000-4000-8000-000000000032',
    task: '80000000-0000-4000-8000-000000000041',
    submission: '80000000-0000-4000-8000-000000000042',
    entitlement: '80000000-0000-4000-8000-000000000051',
  } as const

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE operator_sessions, players, communities, telegram_updates CASCADE`,
    )
    await db.insert(schema.players).values([{ id: ids.playerOne }, { id: ids.playerTwo }])
    await db.insert(schema.telegramIdentities).values({
      id: ids.identityOne,
      playerId: ids.playerOne,
      telegramUserId: 88001n,
      username: 'operator_lookup',
      displayName: 'Operator lookup player',
    })
    await db.insert(schema.walletIdentities).values({
      id: ids.walletOne,
      playerId: ids.playerOne,
      address: 'NQ88 OPERATOR TEST WALLET',
      publicKey: '00'.repeat(32),
    })
    await db.insert(schema.communities).values([
      {
        id: ids.communityOne,
        telegramChatId: -88001n,
        title: 'Operator community one',
        slug: 'operator-community-one',
      },
      {
        id: ids.communityTwo,
        telegramChatId: -88002n,
        title: 'Operator community two',
        slug: 'operator-community-two',
      },
    ])
    await db.insert(schema.seasons).values([
      {
        id: ids.seasonOne,
        communityId: ids.communityOne,
        name: 'Operator active season',
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60 * 60_000),
        status: 'ACTIVE',
      },
      {
        id: ids.seasonTwo,
        communityId: ids.communityTwo,
        name: 'Operator closed season',
        startsAt: new Date(now.getTime() - 120_000),
        endsAt: new Date(now.getTime() - 60_000),
        status: 'CLOSED',
      },
    ])
    await db.insert(schema.communityGameConfigs).values({
      communityId: ids.communityOne,
      gameKey: 'scramble',
      enabled: true,
      config: {},
    })
    await db.insert(schema.scoreEvents).values([
      {
        playerId: ids.playerOne,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'QUIZ',
        sourceId: 'operator-quiz-1',
        delta: 10,
        reason: 'quiz score',
        idempotencyKey: 'operator-score-1',
        createdAt: new Date(now.getTime() - 5_000),
      },
      {
        playerId: ids.playerOne,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'SCRAMBLE',
        sourceId: 'operator-scramble-1',
        delta: 6,
        reason: 'scramble score',
        idempotencyKey: 'operator-score-2',
        createdAt: new Date(now.getTime() - 4_000),
      },
      {
        playerId: ids.playerOne,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'WORD_SEEK',
        sourceId: 'operator-word-seek-1',
        delta: 4,
        reason: 'word seek score',
        idempotencyKey: 'operator-score-3',
        createdAt: new Date(now.getTime() - 3_000),
      },
    ])
    await db.insert(schema.socialTasks).values({
      id: ids.task,
      communityId: ids.communityOne,
      title: 'Operator task',
      instructions: 'Submit an operator test reference.',
      points: 5,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      createdByTelegramUserId: 88001n,
    })
    await db.insert(schema.socialTaskSubmissions).values({
      id: ids.submission,
      taskId: ids.task,
      playerId: ids.playerOne,
      reference: 'https://example.com/operator',
      status: 'PENDING',
    })
    await db.insert(schema.rewardEntitlements).values({
      id: ids.entitlement,
      seasonId: ids.seasonOne,
      playerId: ids.playerOne,
      rank: 1,
      amountLuna: 250n,
      status: 'ELIGIBLE',
      idempotencyKey: 'operator-reward-1',
    })
  })

  afterAll(async () => close())

  it('authenticates an independent Operator session and aggregates real records', async () => {
    const sessions = new OperatorSessionService(db, 'operator-secret-2026')
    const consoleService = new OperatorConsoleService(db)
    const issued = await sessions.authenticate({ accessKey: 'operator-secret-2026', now })
    expect(issued).not.toBeNull()
    if (!issued) return
    expect(await sessions.getSession(issued.token, now)).toMatchObject({
      sessionId: issued.sessionId,
    })
    expect(await sessions.getSession('not-a-player-session', now)).toBeNull()

    const overview = await consoleService.overview(now)
    expect(overview.metrics.players).toBe(2)
    expect(overview.metrics.communities).toBe(2)
    expect(overview.metrics.activeSeasonCommunities).toBe(1)
    expect(overview.metrics.totalScoreEvents).toBe(3)
    expect(overview.metrics.games.scramble.scoreEvents).toBe(1)
    expect(overview.metrics.socialTasks.pending).toBe(1)
    expect(overview.metrics.rewards.byStatus.ELIGIBLE).toBe(1)
    expect(overview.recentScoringActivity[0]).toMatchObject({ sourceType: 'WORD_SEEK', delta: 4 })
  })

  it('keeps community and Player summaries tied to their persisted records', async () => {
    const consoleService = new OperatorConsoleService(db)
    const community = await consoleService.community(ids.communityOne, now)
    expect(community.stats).toMatchObject({
      playersWithScores: 1,
      scoreEventCount: 3,
      activeTaskCount: 1,
      pendingReviewCount: 1,
    })
    expect(community.games).toEqual([
      { gameKey: 'project_quiz', enabled: true },
      { gameKey: 'word_seek', enabled: false },
      { gameKey: 'scramble', enabled: true },
    ])
    expect(
      community.recentScoringActivity.every((row) => row.communityId === ids.communityOne),
    ).toBe(true)

    await expect(
      consoleService.community('80000000-0000-4000-8000-000000000099', now),
    ).rejects.toThrow('Community not found.')
    const byUsername = await consoleService.searchPlayers('@operator_lookup')
    const byTelegramId = await consoleService.searchPlayers('88001')
    const byWallet = await consoleService.searchPlayers('NQ88 OPERATOR TEST WALLET')
    expect(byUsername.map((row) => row.id)).toContain(ids.playerOne)
    expect(byTelegramId.map((row) => row.id)).toContain(ids.playerOne)
    expect(byWallet.map((row) => row.id)).toContain(ids.playerOne)
  })

  it('revokes only the requested wallet, keeps history, and audits the action', async () => {
    const consoleService = new OperatorConsoleService(db)
    const sessions = new OperatorSessionService(db, 'operator-secret-2026')
    const operatorSession = await sessions.authenticate({ accessKey: 'operator-secret-2026', now })
    expect(operatorSession).not.toBeNull()
    if (!operatorSession) return
    const issuedPairing = await issueTelegramPairingCode(db, {
      telegramIdentityId: ids.identityOne,
      now,
    })
    const revoked = await consoleService.revokeWallet({
      playerId: ids.playerOne,
      walletIdentityId: ids.walletOne,
      operatorSessionId: operatorSession.sessionId,
      now,
    })
    expect(revoked.pendingRewardCount).toBe(1)
    expect(
      (await db.select().from(schema.walletIdentities)).find((row) => row.id === ids.walletOne),
    ).toMatchObject({
      playerId: ids.playerOne,
      revokedAt: now,
    })
    expect(await db.select().from(schema.scoreEvents)).toHaveLength(3)
    expect(await db.select().from(schema.socialTaskSubmissions)).toHaveLength(1)
    expect(await db.select().from(schema.rewardEntitlements)).toHaveLength(1)

    const pairing = await consoleService.revokePairingCodes({
      playerId: ids.playerOne,
      operatorSessionId: operatorSession.sessionId,
      now,
    })
    expect(pairing.revokedCount).toBe(1)
    expect(
      (await db.select().from(schema.telegramPairingCodes)).find(
        (row) => row.id === issuedPairing.id,
      )?.consumedAt,
    ).toEqual(now)

    const player = await consoleService.player(ids.playerOne)
    expect(player.scoreSummary.totalPoints).toBe(20)
    expect(player.audit.map((event) => event.action)).toEqual([
      'telegram_pairing_codes.revoked',
      'wallet_identity.revoked',
    ])
  })

  it('rejects a wallet action that crosses Player boundaries without changing state', async () => {
    const consoleService = new OperatorConsoleService(db)
    const sessions = new OperatorSessionService(db, 'operator-secret-2026')
    const operatorSession = await sessions.authenticate({ accessKey: 'operator-secret-2026', now })
    expect(operatorSession).not.toBeNull()
    if (!operatorSession) return
    await expect(
      consoleService.revokeWallet({
        playerId: ids.playerTwo,
        walletIdentityId: ids.walletOne,
        operatorSessionId: operatorSession.sessionId,
        now,
      }),
    ).rejects.toBeInstanceOf(OperatorActionError)
    expect(
      (await db.select().from(schema.walletIdentities)).find((row) => row.id === ids.walletOne)
        ?.revokedAt,
    ).toBeNull()
    expect(await db.select().from(schema.operatorAuditEvents)).toHaveLength(0)
  })

  it('rolls back a wallet revoke when its audit record cannot be persisted', async () => {
    const consoleService = new OperatorConsoleService(db)
    await expect(
      consoleService.revokeWallet({
        playerId: ids.playerOne,
        walletIdentityId: ids.walletOne,
        operatorSessionId: '80000000-0000-4000-8000-000000000099',
        now,
      }),
    ).rejects.toThrow()
    expect(
      (await db.select().from(schema.walletIdentities)).find((row) => row.id === ids.walletOne)
        ?.revokedAt,
    ).toBeNull()
    expect(await db.select().from(schema.operatorAuditEvents)).toHaveLength(0)
  })
})
