import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>

const DAILY_CHECKIN_XP = 10

export type RallyoXpEventType = (typeof schema.rallyoXpEventType.enumValues)[number]

export type RallyoXpProgression = {
  readonly totalXp: number
  readonly todayClaimed: boolean
  readonly nextEligibleAt: Date
  readonly globalRank: number | null
}

export type RallyoGlobalLeagueEntry = {
  readonly playerId: string
  readonly displayName: string
  readonly totalXp: number
  readonly rank: number
  readonly isCurrentPlayer: boolean
}

export type RallyoGlobalLeague = {
  readonly leaderboard: readonly RallyoGlobalLeagueEntry[]
  readonly currentPlayer: RallyoGlobalLeagueEntry
}

export type DailyCheckinClaimResult = {
  readonly claimed: boolean
  readonly xpAwarded: number
  readonly progression: RallyoXpProgression
}

export class RallyoXpService {
  constructor(private readonly database: Database) {}

  async progression(playerId: string, now = new Date()): Promise<RallyoXpProgression> {
    const claimDate = utcDate(now)
    const [total, today] = await Promise.all([
      this.database
        .select({ totalXp: sql<string>`coalesce(sum(${schema.rallyoXpEvents.amountXp}), 0)` })
        .from(schema.rallyoXpEvents)
        .where(eq(schema.rallyoXpEvents.playerId, playerId)),
      this.database
        .select({ id: schema.rallyoXpEvents.id })
        .from(schema.rallyoXpEvents)
        .where(
          and(
            eq(schema.rallyoXpEvents.playerId, playerId),
            eq(schema.rallyoXpEvents.eventType, 'DAILY_CHECKIN'),
            eq(schema.rallyoXpEvents.claimDate, claimDate),
          ),
        )
        .limit(1),
    ])
    const rank = await this.rankForPlayer(playerId)

    return {
      totalXp: Number(total[0]?.totalXp ?? 0),
      todayClaimed: Boolean(today[0]),
      nextEligibleAt: nextUtcMidnight(now),
      globalRank: rank,
    }
  }

  async claimDailyCheckin(playerId: string, now = new Date()): Promise<DailyCheckinClaimResult> {
    const claimDate = utcDate(now)
    const idempotencyKey = `rallyo:daily-checkin:${playerId}:${claimDate}`
    const inserted = await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(schema.rallyoXpEvents)
        .values({
          playerId,
          amountXp: DAILY_CHECKIN_XP,
          eventType: 'DAILY_CHECKIN',
          reason: 'Daily check-in',
          occurredAt: now,
          idempotencyKey,
          claimDate,
          metadata: { source: 'player_app' },
        })
        .onConflictDoNothing()
        .returning({ id: schema.rallyoXpEvents.id })
      return Boolean(rows[0])
    })

    return {
      claimed: inserted,
      xpAwarded: inserted ? DAILY_CHECKIN_XP : 0,
      progression: await this.progression(playerId, now),
    }
  }

  async globalLeague(playerId: string, limit = 10): Promise<RallyoGlobalLeague> {
    const rows = await this.rankedPlayers()
    const entries = rows.map((row, index) => ({
      playerId: row.playerId,
      displayName: row.displayName,
      totalXp: row.totalXp,
      rank: index + 1,
      isCurrentPlayer: row.playerId === playerId,
    }))
    const currentPlayer = entries.find((entry) => entry.isCurrentPlayer)
    if (!currentPlayer) throw new Error('Rallyo Player could not be ranked.')

    return {
      leaderboard: entries.slice(0, Math.max(1, limit)),
      currentPlayer,
    }
  }

  private async rankForPlayer(playerId: string): Promise<number | null> {
    const rows = await this.rankedPlayers()
    const index = rows.findIndex((row) => row.playerId === playerId)
    return index === -1 ? null : index + 1
  }

  private async rankedPlayers() {
    const rows = await this.database
      .select({
        playerId: schema.players.id,
        displayName: sql<string>`coalesce(max(${schema.telegramIdentities.displayName}), 'Rallyo player')`,
        totalXp: sql<string>`coalesce(sum(${schema.rallyoXpEvents.amountXp}), 0)`,
        createdAt: schema.players.createdAt,
      })
      .from(schema.players)
      .leftJoin(
        schema.telegramIdentities,
        eq(schema.telegramIdentities.playerId, schema.players.id),
      )
      .leftJoin(schema.rallyoXpEvents, eq(schema.rallyoXpEvents.playerId, schema.players.id))
      .groupBy(schema.players.id, schema.players.createdAt)
      .orderBy(
        desc(sql`coalesce(sum(${schema.rallyoXpEvents.amountXp}), 0)`),
        asc(schema.players.createdAt),
        asc(schema.players.id),
      )

    return rows.map((row) => ({
      playerId: row.playerId,
      displayName: row.displayName,
      totalXp: Number(row.totalXp),
      createdAt: row.createdAt,
    }))
  }
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function nextUtcMidnight(now: Date): Date {
  const next = new Date(now)
  next.setUTCHours(24, 0, 0, 0)
  return next
}

export const DAILY_CHECKIN_XP_AMOUNT = DAILY_CHECKIN_XP
