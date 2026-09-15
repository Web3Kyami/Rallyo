import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import type { AnyPgTable } from 'drizzle-orm/pg-core'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { issueTelegramPairingCode } from './app-session-service'

const GAME_KEYS = ['project_quiz', 'word_seek', 'scramble'] as const
const RECENT_SCORE_LIMIT = 8
const PLAYER_SEARCH_LIMIT = 20

export class OperatorConsoleNotFoundError extends Error {
  constructor(message = 'The requested Operator resource was not found.') {
    super(message)
    this.name = 'OperatorConsoleNotFoundError'
  }
}

export class OperatorActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperatorActionError'
  }
}

export class OperatorConsoleService {
  constructor(private readonly database: RallyoDatabase) {}

  async bootstrap(now = new Date()) {
    return {
      generatedAt: now,
      overview: await this.overview(now),
    }
  }

  async overview(now = new Date()) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000)
    const [
      players,
      communities,
      activeSeasonCommunities,
      totalScoreEvents,
      recentScoreEvents,
      telegramLinkedPlayers,
      walletLinkedPlayers,
      quizRounds,
      quizScoreEvents,
      activeQuizRounds,
      scrambleRounds,
      scrambleScoreEvents,
      activeScrambleRounds,
      wordSeekSessions,
      wordSeekScoreEvents,
      activeWordSeekSessions,
      socialTaskCounts,
      rewardCounts,
      recentScoringActivity,
    ] = await Promise.all([
      this.countRows(schema.players),
      this.countRows(schema.communities),
      this.countDistinct(
        schema.seasons,
        schema.seasons.communityId,
        and(
          eq(schema.seasons.status, 'ACTIVE'),
          lte(schema.seasons.startsAt, now),
          gt(schema.seasons.endsAt, now),
        ),
      ),
      this.countRows(schema.scoreEvents),
      this.countRows(schema.scoreEvents, gte(schema.scoreEvents.createdAt, sevenDaysAgo)),
      this.countDistinct(schema.telegramIdentities, schema.telegramIdentities.playerId),
      this.countDistinct(
        schema.walletIdentities,
        schema.walletIdentities.playerId,
        isNull(schema.walletIdentities.revokedAt),
      ),
      this.countRows(schema.rounds),
      this.countRows(schema.scoreEvents, eq(schema.scoreEvents.sourceType, 'QUIZ')),
      this.countRows(schema.rounds, eq(schema.rounds.state, 'LIVE')),
      this.countRows(schema.scrambleRounds),
      this.countRows(schema.scoreEvents, eq(schema.scoreEvents.sourceType, 'SCRAMBLE')),
      this.countRows(schema.scrambleRounds, eq(schema.scrambleRounds.status, 'LIVE')),
      this.countRows(schema.wordSeekSessions),
      this.countRows(schema.scoreEvents, eq(schema.scoreEvents.sourceType, 'WORD_SEEK')),
      this.countRows(schema.wordSeekSessions, eq(schema.wordSeekSessions.status, 'LIVE')),
      this.socialTaskCounts(),
      this.rewardCounts(),
      this.recentScoreActivity(),
    ])

    return {
      generatedAt: now,
      metrics: {
        players,
        communities,
        activeSeasonCommunities,
        totalScoreEvents,
        recentScoreEvents,
        telegramLinkedPlayers,
        walletLinkedPlayers,
        games: {
          projectQuiz: {
            rounds: quizRounds,
            scoreEvents: quizScoreEvents,
            activeRounds: activeQuizRounds,
          },
          scramble: {
            rounds: scrambleRounds,
            scoreEvents: scrambleScoreEvents,
            activeRounds: activeScrambleRounds,
          },
          wordSeek: {
            sessions: wordSeekSessions,
            scoreEvents: wordSeekScoreEvents,
            activeSessions: activeWordSeekSessions,
          },
        },
        socialTasks: socialTaskCounts,
        rewards: rewardCounts,
      },
      recentScoringActivity,
    }
  }

  async listCommunities(query = '', now = new Date()) {
    const normalizedQuery = query.trim().slice(0, 100)
    const communities = await this.database
      .select({
        id: schema.communities.id,
        title: schema.communities.title,
        slug: schema.communities.slug,
        telegramChatId: schema.communities.telegramChatId,
        status: schema.communities.status,
        timezone: schema.communities.timezone,
        createdAt: schema.communities.createdAt,
      })
      .from(schema.communities)
      .where(
        normalizedQuery
          ? sql`(
              ${schema.communities.title} ILIKE ${`%${escapeLike(normalizedQuery)}%`} ESCAPE '\\'
              OR ${schema.communities.slug} ILIKE ${`%${escapeLike(normalizedQuery)}%`} ESCAPE '\\'
              OR ${schema.communities.telegramChatId}::text = ${normalizedQuery}
            )`
          : undefined,
      )
      .orderBy(asc(schema.communities.title))

    return Promise.all(
      communities.map(async (community) => {
        const [season, stats, games] = await Promise.all([
          this.activeSeason(community.id, now),
          this.communityStats(community.id, now),
          this.gameCapabilities(community.id),
        ])
        return {
          id: community.id,
          title: community.title,
          slug: community.slug,
          telegramChatId: community.telegramChatId.toString(),
          status: community.status,
          timezone: community.timezone,
          createdAt: community.createdAt,
          activeSeason: season
            ? { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt }
            : null,
          playersWithScores: stats.playersWithScores,
          scoreEventCount: stats.scoreEventCount,
          activeTaskCount: stats.activeTaskCount,
          pendingReviewCount: stats.pendingReviewCount,
          lastMeaningfulActivity: stats.lastMeaningfulActivity,
          games,
        }
      }),
    )
  }

  async community(communityId: string, now = new Date()) {
    const [community] = await this.database
      .select({
        id: schema.communities.id,
        title: schema.communities.title,
        slug: schema.communities.slug,
        telegramChatId: schema.communities.telegramChatId,
        status: schema.communities.status,
        timezone: schema.communities.timezone,
        automaticRoundsEnabled: schema.communities.automaticRoundsEnabled,
        createdAt: schema.communities.createdAt,
      })
      .from(schema.communities)
      .where(eq(schema.communities.id, communityId))
      .limit(1)
    if (!community) throw new OperatorConsoleNotFoundError('Community not found.')

    const [season, stats, games, topPlayers, recentScoringActivity, tasks, rewards] =
      await Promise.all([
        this.activeSeason(communityId, now),
        this.communityStats(communityId, now),
        this.gameCapabilities(communityId),
        this.communityTopPlayers(communityId),
        this.recentScoreActivity(communityId),
        this.communityTaskSummary(communityId),
        this.communityRewardSummary(communityId),
      ])

    return {
      community: {
        ...community,
        telegramChatId: community.telegramChatId.toString(),
      },
      activeSeason: season
        ? {
            id: season.id,
            name: season.name,
            startsAt: season.startsAt,
            endsAt: season.endsAt,
            status: season.status,
            rewardPoolLuna: season.rewardPoolLuna?.toString() ?? null,
          }
        : null,
      stats,
      games,
      tasks,
      rewards,
      topPlayers,
      recentScoringActivity,
    }
  }

  async searchPlayers(query = '') {
    const normalizedQuery = query.trim().slice(0, 120)
    if (normalizedQuery.length < 2) return []

    const usernameQuery = normalizedQuery.startsWith('@')
      ? normalizedQuery.slice(1)
      : normalizedQuery
    const conditions = [
      ilike(schema.telegramIdentities.username, `%${escapeLike(usernameQuery)}%`),
      sql`lower(${schema.walletIdentities.address}) = lower(${normalizedQuery})`,
    ]
    if (isUuid(normalizedQuery)) conditions.push(eq(schema.players.id, normalizedQuery))
    const telegramUserId = parseTelegramUserId(normalizedQuery)
    if (telegramUserId !== null) {
      conditions.push(eq(schema.telegramIdentities.telegramUserId, telegramUserId))
    }

    const rows = await this.database
      .selectDistinct({ playerId: schema.players.id })
      .from(schema.players)
      .leftJoin(
        schema.telegramIdentities,
        eq(schema.telegramIdentities.playerId, schema.players.id),
      )
      .leftJoin(schema.walletIdentities, eq(schema.walletIdentities.playerId, schema.players.id))
      .where(sql`(${sql.join(conditions, sql` OR `)})`)
      .limit(PLAYER_SEARCH_LIMIT)

    return Promise.all(rows.map((row) => this.playerSearchResult(row.playerId)))
  }

  async player(playerId: string, now = new Date()) {
    if (!isUuid(playerId)) throw new OperatorConsoleNotFoundError('Player not found.')

    const [player] = await this.database
      .select({
        id: schema.players.id,
        createdAt: schema.players.createdAt,
        lastSeenAt: schema.players.lastSeenAt,
      })
      .from(schema.players)
      .where(eq(schema.players.id, playerId))
      .limit(1)
    if (!player) throw new OperatorConsoleNotFoundError('Player not found.')

    const [
      telegramIdentities,
      walletIdentities,
      communities,
      sourceBreakdown,
      entitlements,
      audit,
    ] = await Promise.all([
      this.database
        .select({
          id: schema.telegramIdentities.id,
          telegramUserId: schema.telegramIdentities.telegramUserId,
          username: schema.telegramIdentities.username,
          displayName: schema.telegramIdentities.displayName,
          firstSeenAt: schema.telegramIdentities.firstSeenAt,
          lastSeenAt: schema.telegramIdentities.lastSeenAt,
        })
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.playerId, playerId))
        .orderBy(desc(schema.telegramIdentities.lastSeenAt)),
      this.database
        .select({
          id: schema.walletIdentities.id,
          address: schema.walletIdentities.address,
          linkedAt: schema.walletIdentities.linkedAt,
          revokedAt: schema.walletIdentities.revokedAt,
        })
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.playerId, playerId))
        .orderBy(desc(schema.walletIdentities.linkedAt)),
      this.playerCommunitySummary(playerId),
      this.playerSourceBreakdown(playerId),
      this.database
        .select({
          id: schema.rewardEntitlements.id,
          communityTitle: schema.communities.title,
          seasonName: schema.seasons.name,
          rank: schema.rewardEntitlements.rank,
          amountLuna: schema.rewardEntitlements.amountLuna,
          status: schema.rewardEntitlements.status,
          transactionHash: schema.rewardEntitlements.transactionHash,
          createdAt: schema.rewardEntitlements.createdAt,
        })
        .from(schema.rewardEntitlements)
        .innerJoin(schema.seasons, eq(schema.rewardEntitlements.seasonId, schema.seasons.id))
        .innerJoin(schema.communities, eq(schema.seasons.communityId, schema.communities.id))
        .where(eq(schema.rewardEntitlements.playerId, playerId))
        .orderBy(desc(schema.rewardEntitlements.createdAt)),
      this.database
        .select({
          id: schema.operatorAuditEvents.id,
          action: schema.operatorAuditEvents.action,
          metadata: schema.operatorAuditEvents.metadata,
          createdAt: schema.operatorAuditEvents.createdAt,
        })
        .from(schema.operatorAuditEvents)
        .where(eq(schema.operatorAuditEvents.targetPlayerId, playerId))
        .orderBy(desc(schema.operatorAuditEvents.createdAt))
        .limit(20),
    ])

    const adminRoles = telegramIdentities.length
      ? await this.database
          .select({
            communityId: schema.communityAdmins.communityId,
            communityTitle: schema.communities.title,
            telegramUserId: schema.communityAdmins.telegramUserId,
            lastVerifiedAt: schema.communityAdmins.lastVerifiedAt,
          })
          .from(schema.communityAdmins)
          .innerJoin(
            schema.communities,
            eq(schema.communities.id, schema.communityAdmins.communityId),
          )
          .where(
            inArray(
              schema.communityAdmins.telegramUserId,
              telegramIdentities.map((identity) => identity.telegramUserId),
            ),
          )
      : []

    const pairingCodes = telegramIdentities.length
      ? await this.countRows(
          schema.telegramPairingCodes,
          and(
            isNull(schema.telegramPairingCodes.consumedAt),
            gt(schema.telegramPairingCodes.expiresAt, now),
            inArray(
              schema.telegramPairingCodes.telegramIdentityId,
              telegramIdentities.map((identity) => identity.id),
            ),
          ),
        )
      : 0

    return {
      player,
      telegramIdentities: telegramIdentities.map((identity) => ({
        ...identity,
        telegramUserId: identity.telegramUserId.toString(),
      })),
      walletIdentities,
      adminRoles: adminRoles.map((role) => ({
        ...role,
        telegramUserId: role.telegramUserId.toString(),
      })),
      communities,
      scoreSummary: {
        totalScoreEvents: sourceBreakdown.reduce((sum, row) => sum + row.scoreEventCount, 0),
        totalPoints: sourceBreakdown.reduce((sum, row) => sum + row.points, 0),
        bySource: sourceBreakdown,
      },
      rewards: entitlements.map((entitlement) => ({
        ...entitlement,
        amountLuna: entitlement.amountLuna.toString(),
      })),
      recovery: { unusedPairingCodes: pairingCodes },
      audit,
    }
  }

  async revokeWallet(input: {
    readonly playerId: string
    readonly walletIdentityId: string
    readonly operatorSessionId: string
    readonly now?: Date
  }) {
    if (!isUuid(input.playerId) || !isUuid(input.walletIdentityId)) {
      throw new OperatorActionError('The requested wallet identity is invalid.')
    }
    const now = input.now ?? new Date()
    return this.database.transaction(async (tx) => {
      const [wallet] = await tx
        .select({
          id: schema.walletIdentities.id,
          address: schema.walletIdentities.address,
        })
        .from(schema.walletIdentities)
        .where(
          and(
            eq(schema.walletIdentities.id, input.walletIdentityId),
            eq(schema.walletIdentities.playerId, input.playerId),
            isNull(schema.walletIdentities.revokedAt),
          ),
        )
        .for('update')
      if (!wallet) throw new OperatorActionError('The active wallet link was not found.')

      const [pendingRewards] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(schema.rewardEntitlements)
        .where(
          and(
            eq(schema.rewardEntitlements.playerId, input.playerId),
            inArray(schema.rewardEntitlements.status, ['ELIGIBLE', 'CLAIMING', 'FAILED']),
          ),
        )
      const [updated] = await tx
        .update(schema.walletIdentities)
        .set({ revokedAt: now })
        .where(eq(schema.walletIdentities.id, wallet.id))
        .returning({ id: schema.walletIdentities.id, revokedAt: schema.walletIdentities.revokedAt })
      if (!updated) throw new OperatorActionError('The wallet link could not be revoked.')

      await this.audit(tx, {
        operatorSessionId: input.operatorSessionId,
        action: 'wallet_identity.revoked',
        targetPlayerId: input.playerId,
        targetWalletIdentityId: wallet.id,
        metadata: {
          address: wallet.address,
          pendingRewardCount: Number(pendingRewards?.count ?? 0),
        },
        createdAt: now,
      })
      return {
        ...updated,
        address: wallet.address,
        pendingRewardCount: Number(pendingRewards?.count ?? 0),
      }
    })
  }

  async revokePairingCodes(input: {
    readonly playerId: string
    readonly operatorSessionId: string
    readonly now?: Date
  }) {
    if (!isUuid(input.playerId)) throw new OperatorActionError('The requested Player is invalid.')
    const now = input.now ?? new Date()
    return this.database.transaction(async (tx) => {
      const identities = await tx
        .select({ id: schema.telegramIdentities.id })
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.playerId, input.playerId))
      const identityIds = identities.map((identity) => identity.id)
      const revoked = identityIds.length
        ? await tx
            .update(schema.telegramPairingCodes)
            .set({ consumedAt: now })
            .where(
              and(
                inArray(schema.telegramPairingCodes.telegramIdentityId, identityIds),
                isNull(schema.telegramPairingCodes.consumedAt),
              ),
            )
            .returning({ id: schema.telegramPairingCodes.id })
        : []

      await this.audit(tx, {
        operatorSessionId: input.operatorSessionId,
        action: 'telegram_pairing_codes.revoked',
        targetPlayerId: input.playerId,
        metadata: { revokedCount: revoked.length },
        createdAt: now,
      })
      return { revokedCount: revoked.length }
    })
  }

  async prepareTelegramRecovery(input: {
    readonly playerId: string
    readonly operatorSessionId: string
    readonly now?: Date
  }) {
    if (!isUuid(input.playerId)) throw new OperatorActionError('The requested Player is invalid.')
    const now = input.now ?? new Date()
    return this.database.transaction(async (tx) => {
      const [identity] = await tx
        .select({ id: schema.telegramIdentities.id })
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.playerId, input.playerId))
        .orderBy(desc(schema.telegramIdentities.lastSeenAt))
        .limit(1)
      if (!identity) {
        throw new OperatorActionError('This Player has no Telegram identity to recover.')
      }

      const [activeCode] = await tx
        .select({ id: schema.telegramPairingCodes.id })
        .from(schema.telegramPairingCodes)
        .where(
          and(
            eq(schema.telegramPairingCodes.telegramIdentityId, identity.id),
            isNull(schema.telegramPairingCodes.consumedAt),
            gt(schema.telegramPairingCodes.expiresAt, now),
          ),
        )
        .limit(1)
      if (activeCode) {
        throw new OperatorActionError('An unused pairing code is already active. Revoke it first.')
      }

      const issued = await issueTelegramPairingCode(tx, {
        telegramIdentityId: identity.id,
        now,
      })
      await this.audit(tx, {
        operatorSessionId: input.operatorSessionId,
        action: 'telegram_pairing_code.issued',
        targetPlayerId: input.playerId,
        targetTelegramIdentityId: identity.id,
        metadata: { pairingCodeId: issued.id, expiresAt: issued.expiresAt.toISOString() },
        createdAt: now,
      })
      return issued
    })
  }

  private async playerSearchResult(playerId: string) {
    const [player, telegram, wallet, score] = await Promise.all([
      this.database
        .select({
          id: schema.players.id,
          createdAt: schema.players.createdAt,
          lastSeenAt: schema.players.lastSeenAt,
        })
        .from(schema.players)
        .where(eq(schema.players.id, playerId))
        .limit(1),
      this.database
        .select({
          telegramUserId: schema.telegramIdentities.telegramUserId,
          username: schema.telegramIdentities.username,
          displayName: schema.telegramIdentities.displayName,
        })
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.playerId, playerId))
        .orderBy(desc(schema.telegramIdentities.lastSeenAt))
        .limit(1),
      this.database
        .select({ address: schema.walletIdentities.address })
        .from(schema.walletIdentities)
        .where(
          and(
            eq(schema.walletIdentities.playerId, playerId),
            isNull(schema.walletIdentities.revokedAt),
          ),
        )
        .orderBy(desc(schema.walletIdentities.linkedAt))
        .limit(1),
      this.database
        .select({
          scoreEventCount: sql<string>`count(*)`,
          points: sql<string>`coalesce(sum(${schema.scoreEvents.delta}), 0)`,
        })
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.playerId, playerId)),
    ])
    if (!player[0]) throw new OperatorConsoleNotFoundError('Player not found.')
    return {
      id: player[0].id,
      displayName: telegram[0]?.displayName ?? 'Rallyo player',
      username: telegram[0]?.username ?? null,
      telegramUserId: telegram[0]?.telegramUserId.toString() ?? null,
      walletAddress: wallet[0]?.address ?? null,
      createdAt: player[0].createdAt,
      lastSeenAt: player[0].lastSeenAt,
      scoreEventCount: Number(score[0]?.scoreEventCount ?? 0),
      totalPoints: Number(score[0]?.points ?? 0),
    }
  }

  private async playerCommunitySummary(playerId: string) {
    const rows = await this.database
      .select({
        communityId: schema.scoreEvents.communityId,
        communityTitle: schema.communities.title,
        communityStatus: schema.communities.status,
        scoreEventCount: sql<string>`count(*)`,
        points: sql<string>`coalesce(sum(${schema.scoreEvents.delta}), 0)`,
        lastScoreAt: sql<Date | null>`max(${schema.scoreEvents.createdAt})`,
      })
      .from(schema.scoreEvents)
      .innerJoin(schema.communities, eq(schema.communities.id, schema.scoreEvents.communityId))
      .where(eq(schema.scoreEvents.playerId, playerId))
      .groupBy(schema.scoreEvents.communityId, schema.communities.title, schema.communities.status)
      .orderBy(desc(sql`sum(${schema.scoreEvents.delta})`))
    return rows.map((row) => ({
      ...row,
      scoreEventCount: Number(row.scoreEventCount),
      points: Number(row.points),
    }))
  }

  private async playerSourceBreakdown(playerId: string) {
    const rows = await this.database
      .select({
        sourceType: schema.scoreEvents.sourceType,
        scoreEventCount: sql<string>`count(*)`,
        points: sql<string>`coalesce(sum(${schema.scoreEvents.delta}), 0)`,
      })
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.playerId, playerId))
      .groupBy(schema.scoreEvents.sourceType)
    return rows.map((row) => ({
      sourceType: row.sourceType,
      scoreEventCount: Number(row.scoreEventCount),
      points: Number(row.points),
    }))
  }

  private async communityTopPlayers(communityId: string) {
    const rows = await this.database
      .select({
        playerId: schema.scoreEvents.playerId,
        scoreEventCount: sql<string>`count(*)`,
        points: sql<string>`coalesce(sum(${schema.scoreEvents.delta}), 0)`,
      })
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.communityId, communityId))
      .groupBy(schema.scoreEvents.playerId)
      .orderBy(desc(sql`sum(${schema.scoreEvents.delta})`), asc(schema.scoreEvents.playerId))
      .limit(8)
    if (rows.length === 0) return []
    const identities = await this.database
      .select({
        playerId: schema.telegramIdentities.playerId,
        displayName: schema.telegramIdentities.displayName,
      })
      .from(schema.telegramIdentities)
      .where(
        inArray(
          schema.telegramIdentities.playerId,
          rows.map((row) => row.playerId),
        ),
      )
    const names = new Map(identities.map((identity) => [identity.playerId, identity.displayName]))
    return rows.map((row, index) => ({
      playerId: row.playerId,
      displayName: names.get(row.playerId) ?? 'Rallyo player',
      rank: index + 1,
      scoreEventCount: Number(row.scoreEventCount),
      points: Number(row.points),
    }))
  }

  private async recentScoreActivity(communityId?: string) {
    const rows = await this.database
      .select({
        id: schema.scoreEvents.id,
        playerId: schema.scoreEvents.playerId,
        playerName: schema.telegramIdentities.displayName,
        communityId: schema.scoreEvents.communityId,
        communityTitle: schema.communities.title,
        sourceType: schema.scoreEvents.sourceType,
        delta: schema.scoreEvents.delta,
        reason: schema.scoreEvents.reason,
        createdAt: schema.scoreEvents.createdAt,
      })
      .from(schema.scoreEvents)
      .leftJoin(
        schema.telegramIdentities,
        eq(schema.telegramIdentities.playerId, schema.scoreEvents.playerId),
      )
      .innerJoin(schema.communities, eq(schema.communities.id, schema.scoreEvents.communityId))
      .where(communityId ? eq(schema.scoreEvents.communityId, communityId) : undefined)
      .orderBy(desc(schema.scoreEvents.createdAt))
      .limit(RECENT_SCORE_LIMIT)
    return rows.map((row) => ({ ...row, playerName: row.playerName ?? 'Rallyo player' }))
  }

  private async communityStats(communityId: string, now = new Date()) {
    const [players, scoreEvents, activeTaskCount, pendingReviewCount, activity] = await Promise.all(
      [
        this.countDistinct(
          schema.scoreEvents,
          schema.scoreEvents.playerId,
          eq(schema.scoreEvents.communityId, communityId),
        ),
        this.countRows(schema.scoreEvents, eq(schema.scoreEvents.communityId, communityId)),
        this.countRows(
          schema.socialTasks,
          and(
            eq(schema.socialTasks.communityId, communityId),
            eq(schema.socialTasks.status, 'ACTIVE'),
            lte(schema.socialTasks.startsAt, now),
            gt(schema.socialTasks.endsAt, now),
          ),
        ),
        this.communityPendingReviewCount(communityId),
        this.lastMeaningfulActivity(communityId),
      ],
    )
    return {
      playersWithScores: players,
      scoreEventCount: scoreEvents,
      activeTaskCount,
      pendingReviewCount,
      lastMeaningfulActivity: activity,
    }
  }

  private async communityTaskSummary(communityId: string) {
    const [tasks, submissions] = await Promise.all([
      this.database
        .select({ status: schema.socialTasks.status, count: sql<string>`count(*)` })
        .from(schema.socialTasks)
        .where(eq(schema.socialTasks.communityId, communityId))
        .groupBy(schema.socialTasks.status),
      this.database
        .select({ status: schema.socialTaskSubmissions.status, count: sql<string>`count(*)` })
        .from(schema.socialTaskSubmissions)
        .innerJoin(
          schema.socialTasks,
          eq(schema.socialTasks.id, schema.socialTaskSubmissions.taskId),
        )
        .where(eq(schema.socialTasks.communityId, communityId))
        .groupBy(schema.socialTaskSubmissions.status),
    ])
    return {
      total: tasks.reduce((sum, row) => sum + Number(row.count), 0),
      active: groupedCount(tasks, 'ACTIVE'),
      paused: groupedCount(tasks, 'PAUSED'),
      archived: groupedCount(tasks, 'ARCHIVED'),
      submissions: submissions.reduce((sum, row) => sum + Number(row.count), 0),
      pending: groupedCount(submissions, 'PENDING'),
      approved: groupedCount(submissions, 'APPROVED'),
      rejected: groupedCount(submissions, 'REJECTED'),
    }
  }

  private async communityRewardSummary(communityId: string) {
    const rows = await this.database
      .select({
        status: schema.rewardEntitlements.status,
        count: sql<string>`count(*)`,
        amountLuna: sql<string>`coalesce(sum(${schema.rewardEntitlements.amountLuna}), 0)`,
      })
      .from(schema.rewardEntitlements)
      .innerJoin(schema.seasons, eq(schema.seasons.id, schema.rewardEntitlements.seasonId))
      .where(eq(schema.seasons.communityId, communityId))
      .groupBy(schema.rewardEntitlements.status)
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count), 0),
      totalAmountLuna: rows.reduce((sum, row) => sum + BigInt(row.amountLuna), 0n).toString(),
      byStatus: Object.fromEntries(
        schema.rewardStatus.enumValues.map((status) => [status, groupedCount(rows, status)]),
      ),
    }
  }

  private async socialTaskCounts() {
    const [tasks, submissions] = await Promise.all([
      this.database
        .select({ status: schema.socialTasks.status, count: sql<string>`count(*)` })
        .from(schema.socialTasks)
        .groupBy(schema.socialTasks.status),
      this.database
        .select({ status: schema.socialTaskSubmissions.status, count: sql<string>`count(*)` })
        .from(schema.socialTaskSubmissions)
        .groupBy(schema.socialTaskSubmissions.status),
    ])
    return {
      total: tasks.reduce((sum, row) => sum + Number(row.count), 0),
      active: groupedCount(tasks, 'ACTIVE'),
      paused: groupedCount(tasks, 'PAUSED'),
      archived: groupedCount(tasks, 'ARCHIVED'),
      submissions: submissions.reduce((sum, row) => sum + Number(row.count), 0),
      pending: groupedCount(submissions, 'PENDING'),
      approved: groupedCount(submissions, 'APPROVED'),
      rejected: groupedCount(submissions, 'REJECTED'),
    }
  }

  private async rewardCounts() {
    const rows = await this.database
      .select({
        status: schema.rewardEntitlements.status,
        count: sql<string>`count(*)`,
        amountLuna: sql<string>`coalesce(sum(${schema.rewardEntitlements.amountLuna}), 0)`,
      })
      .from(schema.rewardEntitlements)
      .groupBy(schema.rewardEntitlements.status)
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count), 0),
      totalAmountLuna: rows.reduce((sum, row) => sum + BigInt(row.amountLuna), 0n).toString(),
      byStatus: Object.fromEntries(
        schema.rewardStatus.enumValues.map((status) => [status, groupedCount(rows, status)]),
      ),
    }
  }

  private async activeSeason(communityId: string, now: Date) {
    const [season] = await this.database
      .select()
      .from(schema.seasons)
      .where(
        and(
          eq(schema.seasons.communityId, communityId),
          eq(schema.seasons.status, 'ACTIVE'),
          lte(schema.seasons.startsAt, now),
          gt(schema.seasons.endsAt, now),
        ),
      )
      .orderBy(desc(schema.seasons.startsAt))
      .limit(1)
    return season ?? null
  }

  private async gameCapabilities(communityId: string) {
    const rows = await this.database
      .select({
        gameKey: schema.communityGameConfigs.gameKey,
        enabled: schema.communityGameConfigs.enabled,
      })
      .from(schema.communityGameConfigs)
      .where(eq(schema.communityGameConfigs.communityId, communityId))
    const configured = new Map(rows.map((row) => [row.gameKey, row.enabled]))
    return GAME_KEYS.map((gameKey) => ({
      gameKey,
      enabled: configured.get(gameKey) ?? gameKey === 'project_quiz',
    }))
  }

  private async lastMeaningfulActivity(communityId: string) {
    const dates = await Promise.all([
      this.database
        .select({ value: sql<Date | null>`max(${schema.scoreEvents.createdAt})` })
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.communityId, communityId)),
      this.database
        .select({ value: sql<Date | null>`max(${schema.rounds.createdAt})` })
        .from(schema.rounds)
        .where(eq(schema.rounds.communityId, communityId)),
      this.database
        .select({ value: sql<Date | null>`max(${schema.scrambleRounds.createdAt})` })
        .from(schema.scrambleRounds)
        .where(eq(schema.scrambleRounds.communityId, communityId)),
      this.database
        .select({ value: sql<Date | null>`max(${schema.wordSeekSessions.createdAt})` })
        .from(schema.wordSeekSessions)
        .where(eq(schema.wordSeekSessions.communityId, communityId)),
      this.database
        .select({ value: sql<Date | null>`max(${schema.socialTasks.createdAt})` })
        .from(schema.socialTasks)
        .where(eq(schema.socialTasks.communityId, communityId)),
    ])
    return dates
      .map((rows) => rows[0]?.value ?? null)
      .filter((date): date is Date => date !== null)
      .reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null)
  }

  private async countRows(table: AnyPgTable, where?: SQL) {
    const [row] = await this.database
      .select({ count: sql<string>`count(*)` })
      .from(table)
      .where(where)
    return Number(row?.count ?? 0)
  }

  private async countDistinct(table: AnyPgTable, column: AnyColumn, where?: SQL) {
    const [row] = await this.database
      .select({ count: sql<string>`count(distinct ${column})` })
      .from(table)
      .where(where)
    return Number(row?.count ?? 0)
  }

  private async communityPendingReviewCount(communityId: string) {
    const [row] = await this.database
      .select({ count: sql<string>`count(*)` })
      .from(schema.socialTaskSubmissions)
      .innerJoin(schema.socialTasks, eq(schema.socialTasks.id, schema.socialTaskSubmissions.taskId))
      .where(
        and(
          eq(schema.socialTasks.communityId, communityId),
          eq(schema.socialTaskSubmissions.status, 'PENDING'),
        ),
      )
    return Number(row?.count ?? 0)
  }

  private async audit(
    database: Pick<RallyoDatabase, 'insert'>,
    input: {
      readonly operatorSessionId: string
      readonly action: string
      readonly targetPlayerId: string
      readonly targetTelegramIdentityId?: string
      readonly targetWalletIdentityId?: string
      readonly metadata: Record<string, unknown>
      readonly createdAt: Date
    },
  ) {
    await database.insert(schema.operatorAuditEvents).values({
      operatorSessionId: input.operatorSessionId,
      action: input.action,
      targetPlayerId: input.targetPlayerId,
      ...(input.targetTelegramIdentityId
        ? { targetTelegramIdentityId: input.targetTelegramIdentityId }
        : {}),
      ...(input.targetWalletIdentityId
        ? { targetWalletIdentityId: input.targetWalletIdentityId }
        : {}),
      metadata: input.metadata,
      createdAt: input.createdAt,
    })
  }
}

function groupedCount<T extends { readonly status: string; readonly count: string }>(
  rows: readonly T[],
  status: string,
) {
  return Number(rows.find((row) => row.status === status)?.count ?? 0)
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parseTelegramUserId(value: string): bigint | null {
  if (!/^-?\d{1,20}$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}
