import { and, asc, desc, eq, gt, lte, or, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>

export type TelegramPlayerInput = {
  readonly telegramUserId: bigint
  readonly username: string | null
  readonly displayName: string
}

export async function upsertTelegramIdentity(
  database: Database,
  input: TelegramPlayerInput,
): Promise<{ readonly playerId: string; readonly telegramIdentityId: string }> {
  return database.transaction(async (tx) => {
    const existing = await tx
      .select({
        playerId: schema.telegramIdentities.playerId,
        identityId: schema.telegramIdentities.id,
      })
      .from(schema.telegramIdentities)
      .where(eq(schema.telegramIdentities.telegramUserId, input.telegramUserId))

    let identity = existing[0]

    if (!identity) {
      const [player] = await tx
        .insert(schema.players)
        .values({})
        .returning({ id: schema.players.id })

      if (!player) {
        throw new Error('Player identity could not be created.')
      }

      const inserted = await tx
        .insert(schema.telegramIdentities)
        .values({
          playerId: player.id,
          telegramUserId: input.telegramUserId,
          username: input.username,
          displayName: input.displayName,
        })
        .onConflictDoNothing({ target: schema.telegramIdentities.telegramUserId })
        .returning({
          playerId: schema.telegramIdentities.playerId,
          identityId: schema.telegramIdentities.id,
        })

      identity = inserted[0]

      if (!identity) {
        const concurrentIdentity = await tx
          .select({
            playerId: schema.telegramIdentities.playerId,
            identityId: schema.telegramIdentities.id,
          })
          .from(schema.telegramIdentities)
          .where(eq(schema.telegramIdentities.telegramUserId, input.telegramUserId))

        identity = concurrentIdentity[0]

        await tx.delete(schema.players).where(eq(schema.players.id, player.id))
      }
    }

    if (!identity) {
      throw new Error('Telegram identity could not be loaded after an insert conflict.')
    }

    await tx
      .update(schema.telegramIdentities)
      .set({ username: input.username, displayName: input.displayName, lastSeenAt: new Date() })
      .where(eq(schema.telegramIdentities.id, identity.identityId))
    await tx
      .update(schema.players)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.players.id, identity.playerId))

    return { playerId: identity.playerId, telegramIdentityId: identity.identityId }
  })
}

export async function upsertCommunity(
  database: Database,
  input: { readonly telegramChatId: bigint; readonly title: string },
): Promise<typeof schema.communities.$inferSelect> {
  return database.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.communities)
      .where(eq(schema.communities.telegramChatId, input.telegramChatId))

    if (existing[0]) {
      const [updated] = await tx
        .update(schema.communities)
        .set({ title: input.title, status: 'ACTIVE' })
        .where(eq(schema.communities.id, existing[0].id))
        .returning()

      if (!updated) {
        throw new Error('Community could not be updated.')
      }

      return updated
    }

    const [created] = await tx
      .insert(schema.communities)
      .values({
        telegramChatId: input.telegramChatId,
        title: input.title,
        slug: communitySlug(input.title, input.telegramChatId),
      })
      .onConflictDoNothing({ target: schema.communities.telegramChatId })
      .returning()

    if (created) {
      return created
    }

    const [concurrent] = await tx
      .select()
      .from(schema.communities)
      .where(eq(schema.communities.telegramChatId, input.telegramChatId))

    if (!concurrent) {
      throw new Error('Community could not be loaded after an insert conflict.')
    }

    return concurrent
  })
}

export async function findCommunityByTelegramChatId(database: Database, telegramChatId: bigint) {
  const rows = await database
    .select()
    .from(schema.communities)
    .where(eq(schema.communities.telegramChatId, telegramChatId))

  return rows[0] ?? null
}

export async function recordVerifiedAdmin(
  database: Database,
  input: {
    readonly communityId: string
    readonly telegramUserId: bigint
    readonly verifiedAt: Date
  },
): Promise<void> {
  await database
    .insert(schema.communityAdmins)
    .values({
      communityId: input.communityId,
      telegramUserId: input.telegramUserId,
      verifiedAt: input.verifiedAt,
      lastVerifiedAt: input.verifiedAt,
    })
    .onConflictDoUpdate({
      target: [schema.communityAdmins.communityId, schema.communityAdmins.telegramUserId],
      set: { lastVerifiedAt: input.verifiedAt },
    })
}

export async function listAdminCommunities(database: Database, telegramUserId: bigint) {
  return database
    .select({
      id: schema.communities.id,
      title: schema.communities.title,
      telegramChatId: schema.communities.telegramChatId,
    })
    .from(schema.communityAdmins)
    .innerJoin(schema.communities, eq(schema.communityAdmins.communityId, schema.communities.id))
    .where(eq(schema.communityAdmins.telegramUserId, telegramUserId))
    .orderBy(asc(schema.communities.title))
}

export async function communityAdminSnapshot(database: Database, communityId: string, now: Date) {
  const [community] = await database
    .select()
    .from(schema.communities)
    .where(eq(schema.communities.id, communityId))
  if (!community) return null

  const [season] = await database
    .select({ name: schema.seasons.name })
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

  const readyQuestionCount = await database
    .select({ count: sql<string>`count(*)` })
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.status, 'APPROVED'),
        or(
          eq(schema.questions.scope, 'GLOBAL'),
          and(
            eq(schema.questions.scope, 'COMMUNITY'),
            eq(schema.questions.communityId, communityId),
          ),
        ),
      ),
    )

  const [nextRound] = await database
    .select({ startsAt: schema.rounds.startsAt })
    .from(schema.rounds)
    .where(
      and(
        eq(schema.rounds.communityId, communityId),
        eq(schema.rounds.state, 'SCHEDULED'),
        gt(schema.rounds.startsAt, now),
      ),
    )
    .orderBy(asc(schema.rounds.startsAt))
    .limit(1)

  return {
    community,
    currentSeason: season?.name ?? null,
    readyQuestionCount: Number(readyQuestionCount[0]?.count ?? 0),
    nextRoundAt: nextRound?.startsAt ?? null,
  }
}

function communitySlug(title: string, telegramChatId: bigint): string {
  const normalizedTitle = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
  const suffix = telegramChatId.toString().replace(/^-/, 'n')

  return `${normalizedTitle || 'community'}-${suffix}`
}
