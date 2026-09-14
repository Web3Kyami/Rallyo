import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { communityAdminSnapshot, listAdminCommunities } from '../telegram/persistence'
import { RoundService } from './round-service'
import type { AppSessionActor } from './app-session-service'

const GAME_KEYS = ['project_quiz', 'word_seek', 'scramble'] as const

export class AppApiNotFoundError extends Error {
  constructor(message = 'The requested Rallyo resource was not found.') {
    super(message)
    this.name = 'AppApiNotFoundError'
  }
}

export class AppApiForbiddenError extends Error {
  constructor(message = 'You do not have access to this Rallyo resource.') {
    super(message)
    this.name = 'AppApiForbiddenError'
  }
}

export class AppApiService {
  private readonly roundService: RoundService

  constructor(private readonly database: RallyoDatabase) {
    this.roundService = new RoundService(database)
  }

  async bootstrap(actor: AppSessionActor, now = new Date()) {
    const [identity] = actor.telegramIdentityId
      ? await this.database
          .select({
            displayName: schema.telegramIdentities.displayName,
            username: schema.telegramIdentities.username,
          })
          .from(schema.telegramIdentities)
          .where(eq(schema.telegramIdentities.id, actor.telegramIdentityId))
          .limit(1)
      : []

    const [wallet] = await this.database
      .select({ address: schema.walletIdentities.address })
      .from(schema.walletIdentities)
      .where(
        and(
          eq(schema.walletIdentities.playerId, actor.playerId),
          isNull(schema.walletIdentities.revokedAt),
        ),
      )
      .limit(1)

    return {
      session: {
        targetMode: actor.targetMode,
        targetCommunityId: actor.targetCommunityId,
        expiresAt: actor.expiresAt,
      },
      player: {
        id: actor.playerId,
        displayName: identity?.displayName ?? 'Rallyo player',
        username: identity?.username ?? null,
      },
      wallet: wallet ? { linked: true, address: wallet.address } : { linked: false },
      communities: await this.listCommunities(actor, now),
      adminCommunities: await this.adminCommunities(actor),
      featureFlags: {
        walletLinking: true,
        globalLeague: false,
      },
    }
  }

  async listCommunities(actor: AppSessionActor, now = new Date()) {
    const [scored, administered] = await Promise.all([
      this.database
        .selectDistinct({ communityId: schema.scoreEvents.communityId })
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.playerId, actor.playerId)),
      actor.telegramUserId
        ? this.database
            .selectDistinct({ communityId: schema.communityAdmins.communityId })
            .from(schema.communityAdmins)
            .where(eq(schema.communityAdmins.telegramUserId, actor.telegramUserId))
        : Promise.resolve([]),
    ])
    const ids = [...new Set([...scored, ...administered].map((row) => row.communityId))]
    if (ids.length === 0) return []

    const communities = await this.database
      .select({
        id: schema.communities.id,
        title: schema.communities.title,
        slug: schema.communities.slug,
        status: schema.communities.status,
      })
      .from(schema.communities)
      .where(inArray(schema.communities.id, ids))

    return Promise.all(
      communities.map(async (community) => {
        const season = await this.activeSeason(community.id, now)
        const leaderboard = season
          ? await this.roundService.leaderboardForSeason(community.id, season.id)
          : []
        const row = leaderboard.find((entry) => entry.playerId === actor.playerId)
        return {
          ...community,
          activeSeason: season ? { id: season.id, name: season.name, endsAt: season.endsAt } : null,
          points: row?.points ?? 0,
          rank: row?.rank ?? null,
          isAdmin: administered.some((entry) => entry.communityId === community.id),
        }
      }),
    )
  }

  async community(actor: AppSessionActor, communityId: string, now = new Date()) {
    await this.assertCommunityAccess(actor, communityId)
    const [community] = await this.database
      .select({
        id: schema.communities.id,
        title: schema.communities.title,
        slug: schema.communities.slug,
        status: schema.communities.status,
        timezone: schema.communities.timezone,
      })
      .from(schema.communities)
      .where(eq(schema.communities.id, communityId))
      .limit(1)
    if (!community) throw new AppApiNotFoundError('Community not found.')

    const season = await this.activeSeason(communityId, now)
    const leaderboard = season ? await this.leaderboard(actor, communityId, season.id, now) : []
    const playerRow = leaderboard.find((row) => row.playerId === actor.playerId)
    return {
      ...community,
      activeSeason: season
        ? { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt }
        : null,
      player: { points: playerRow?.points ?? 0, rank: playerRow?.rank ?? null },
      leaderboard: leaderboard.slice(0, 10),
      games: await this.gameCapabilities(communityId),
      tasks: await this.tasks(actor, communityId, now),
    }
  }

  async leaderboard(
    actor: AppSessionActor,
    communityId: string,
    seasonId?: string,
    now = new Date(),
  ) {
    await this.assertCommunityAccess(actor, communityId)
    const season = seasonId
      ? await this.seasonForCommunity(communityId, seasonId)
      : await this.activeSeason(communityId, now)
    if (!season) return []

    const scoreRows = await this.roundService.leaderboardForSeason(communityId, season.id)
    const playerIds = scoreRows.map((row) => row.playerId)
    if (playerIds.length === 0) return []
    const identities = await this.database
      .select({
        playerId: schema.telegramIdentities.playerId,
        displayName: schema.telegramIdentities.displayName,
      })
      .from(schema.telegramIdentities)
      .where(inArray(schema.telegramIdentities.playerId, playerIds))
    const names = new Map(identities.map((row) => [row.playerId, row.displayName]))
    return scoreRows.map((row) => ({
      playerId: row.playerId,
      displayName: names.get(row.playerId) ?? 'Rallyo player',
      points: row.points,
      rank: row.rank,
      isCurrentPlayer: row.playerId === actor.playerId,
    }))
  }

  async tasks(actor: AppSessionActor, communityId?: string, now = new Date()) {
    if (communityId) {
      await this.assertCommunityAccess(actor, communityId)
    }
    const accessibleCommunityIds = communityId
      ? [communityId]
      : (await this.listCommunities(actor, now)).map((community) => community.id)
    if (accessibleCommunityIds.length === 0) return []
    const filters = [
      eq(schema.socialTasks.status, 'ACTIVE'),
      lte(schema.socialTasks.startsAt, now),
      gt(schema.socialTasks.endsAt, now),
      inArray(schema.socialTasks.communityId, accessibleCommunityIds),
    ]
    const rows = await this.database
      .select({
        task: schema.socialTasks,
        communityTitle: schema.communities.title,
      })
      .from(schema.socialTasks)
      .innerJoin(schema.communities, eq(schema.communities.id, schema.socialTasks.communityId))
      .where(and(...filters))
      .orderBy(asc(schema.socialTasks.endsAt))

    const taskIds = rows.map((row) => row.task.id)
    const submissions = taskIds.length
      ? await this.database
          .select({
            taskId: schema.socialTaskSubmissions.taskId,
            status: schema.socialTaskSubmissions.status,
            createdAt: schema.socialTaskSubmissions.createdAt,
          })
          .from(schema.socialTaskSubmissions)
          .where(
            and(
              eq(schema.socialTaskSubmissions.playerId, actor.playerId),
              inArray(schema.socialTaskSubmissions.taskId, taskIds),
            ),
          )
      : []
    const submissionByTask = new Map(submissions.map((row) => [row.taskId, row]))

    return rows.map(({ task, communityTitle }) => ({
      id: task.id,
      communityId: task.communityId,
      communityTitle,
      title: task.title,
      instructions: task.instructions,
      points: task.points,
      startsAt: task.startsAt,
      endsAt: task.endsAt,
      submission: submissionByTask.get(task.id) ?? null,
    }))
  }

  async task(actor: AppSessionActor, taskId: string, now = new Date()) {
    const [task] = await this.database
      .select({ task: schema.socialTasks, communityTitle: schema.communities.title })
      .from(schema.socialTasks)
      .innerJoin(schema.communities, eq(schema.communities.id, schema.socialTasks.communityId))
      .where(eq(schema.socialTasks.id, taskId))
      .limit(1)
    if (!task) throw new AppApiNotFoundError('Task not found.')
    await this.assertCommunityAccess(actor, task.task.communityId)
    const [submission] = await this.database
      .select()
      .from(schema.socialTaskSubmissions)
      .where(
        and(
          eq(schema.socialTaskSubmissions.taskId, taskId),
          eq(schema.socialTaskSubmissions.playerId, actor.playerId),
        ),
      )
      .orderBy(desc(schema.socialTaskSubmissions.createdAt))
      .limit(1)
    return {
      ...task.task,
      communityTitle: task.communityTitle,
      isOpen: task.task.status === 'ACTIVE' && task.task.startsAt <= now && task.task.endsAt > now,
      submission: submission ?? null,
    }
  }

  async rewards(actor: AppSessionActor) {
    const [wallet] = await this.database
      .select({ address: schema.walletIdentities.address })
      .from(schema.walletIdentities)
      .where(
        and(
          eq(schema.walletIdentities.playerId, actor.playerId),
          isNull(schema.walletIdentities.revokedAt),
        ),
      )
      .limit(1)
    const entitlements = await this.database
      .select({
        id: schema.rewardEntitlements.id,
        seasonId: schema.rewardEntitlements.seasonId,
        rank: schema.rewardEntitlements.rank,
        amountLuna: schema.rewardEntitlements.amountLuna,
        status: schema.rewardEntitlements.status,
        transactionHash: schema.rewardEntitlements.transactionHash,
        createdAt: schema.rewardEntitlements.createdAt,
      })
      .from(schema.rewardEntitlements)
      .where(eq(schema.rewardEntitlements.playerId, actor.playerId))
      .orderBy(desc(schema.rewardEntitlements.createdAt))
    return {
      wallet: wallet ? { linked: true, address: wallet.address } : { linked: false },
      entitlements: entitlements.map((entitlement) => ({
        ...entitlement,
        amountLuna: entitlement.amountLuna.toString(),
      })),
    }
  }

  async adminCommunities(actor: AppSessionActor) {
    if (actor.telegramUserId === null) return []
    const communities = await listAdminCommunities(this.database, actor.telegramUserId)
    return communities.map((community) => ({
      ...community,
      telegramChatId: community.telegramChatId.toString(),
    }))
  }

  async adminOverview(actor: AppSessionActor, communityId: string, now = new Date()) {
    await this.assertCommunityAdmin(actor, communityId)
    const snapshot = await communityAdminSnapshot(this.database, communityId, now)
    if (!snapshot) throw new AppApiNotFoundError('Community not found.')

    const [participantCount, activeTaskCount, pendingReviewCount] = await Promise.all([
      this.database
        .select({ count: sql<string>`count(distinct ${schema.scoreEvents.playerId})` })
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.communityId, communityId)),
      this.database
        .select({ count: sql<string>`count(*)` })
        .from(schema.socialTasks)
        .where(
          and(
            eq(schema.socialTasks.communityId, communityId),
            eq(schema.socialTasks.status, 'ACTIVE'),
            lte(schema.socialTasks.startsAt, now),
            gt(schema.socialTasks.endsAt, now),
          ),
        ),
      this.database
        .select({ count: sql<string>`count(*)` })
        .from(schema.socialTaskSubmissions)
        .innerJoin(
          schema.socialTasks,
          eq(schema.socialTasks.id, schema.socialTaskSubmissions.taskId),
        )
        .where(
          and(
            eq(schema.socialTasks.communityId, communityId),
            eq(schema.socialTaskSubmissions.status, 'PENDING'),
          ),
        ),
    ])
    return {
      community: {
        id: snapshot.community.id,
        title: snapshot.community.title,
        slug: snapshot.community.slug,
        status: snapshot.community.status,
      },
      activeSeason: snapshot.currentSeason,
      readyQuestionCount: snapshot.readyQuestionCount,
      nextRoundAt: snapshot.nextRoundAt,
      participantCount: Number(participantCount[0]?.count ?? 0),
      activeTaskCount: Number(activeTaskCount[0]?.count ?? 0),
      pendingReviewCount: Number(pendingReviewCount[0]?.count ?? 0),
      games: await this.gameCapabilities(communityId),
    }
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

  private async seasonForCommunity(communityId: string, seasonId: string) {
    const [season] = await this.database
      .select()
      .from(schema.seasons)
      .where(and(eq(schema.seasons.id, seasonId), eq(schema.seasons.communityId, communityId)))
      .limit(1)
    return season ?? null
  }

  private async assertCommunityAccess(actor: AppSessionActor, communityId: string) {
    if (actor.telegramUserId === null) {
      const [row] = await this.database
        .select({ id: schema.communities.id })
        .from(schema.communities)
        .innerJoin(
          schema.scoreEvents,
          and(
            eq(schema.scoreEvents.communityId, schema.communities.id),
            eq(schema.scoreEvents.playerId, actor.playerId),
          ),
        )
        .where(eq(schema.communities.id, communityId))
        .limit(1)
      if (!row) throw new AppApiForbiddenError()
      return
    }
    const [row] = await this.database
      .select({ id: schema.communities.id })
      .from(schema.communities)
      .leftJoin(
        schema.scoreEvents,
        and(
          eq(schema.scoreEvents.communityId, schema.communities.id),
          eq(schema.scoreEvents.playerId, actor.playerId),
        ),
      )
      .leftJoin(
        schema.communityAdmins,
        and(
          eq(schema.communityAdmins.communityId, schema.communities.id),
          eq(schema.communityAdmins.telegramUserId, actor.telegramUserId),
        ),
      )
      .where(
        and(
          eq(schema.communities.id, communityId),
          or(
            sql`${schema.scoreEvents.id} IS NOT NULL`,
            sql`${schema.communityAdmins.id} IS NOT NULL`,
          ),
        ),
      )
      .limit(1)
    if (!row) throw new AppApiForbiddenError()
  }

  private async assertCommunityAdmin(actor: AppSessionActor, communityId: string) {
    if (actor.telegramUserId === null) {
      throw new AppApiForbiddenError('You are not an administrator for this community.')
    }
    const [row] = await this.database
      .select({ id: schema.communityAdmins.id })
      .from(schema.communityAdmins)
      .where(
        and(
          eq(schema.communityAdmins.communityId, communityId),
          eq(schema.communityAdmins.telegramUserId, actor.telegramUserId),
        ),
      )
      .limit(1)
    if (!row) throw new AppApiForbiddenError('You are not an administrator for this community.')
  }
}
