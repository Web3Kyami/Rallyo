import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

type DatabaseExecutor = Pick<RallyoDatabase, 'select' | 'insert' | 'update' | 'delete'>

export class IdentityMergeConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityMergeConflictError'
  }
}

export async function mergeWalletPlayerIntoTelegramPlayer(
  database: DatabaseExecutor,
  input: {
    readonly telegramPlayerId: string
    readonly walletPlayerId: string
    readonly now: Date
  },
): Promise<{ readonly playerId: string }> {
  if (input.telegramPlayerId === input.walletPlayerId) return { playerId: input.telegramPlayerId }

  const playerIds = [input.telegramPlayerId, input.walletPlayerId].sort()
  const players = await database
    .select({ id: schema.players.id, nickname: schema.players.nickname })
    .from(schema.players)
    .where(inArray(schema.players.id, playerIds))
    .orderBy(asc(schema.players.id))
    .for('update')
  if (players.length !== 2) {
    throw new IdentityMergeConflictError('Both Rallyo Players must exist before pairing.')
  }

  const telegramIdentities = await database
    .select()
    .from(schema.telegramIdentities)
    .where(inArray(schema.telegramIdentities.playerId, playerIds))
    .orderBy(asc(schema.telegramIdentities.id))
    .for('update')
  const telegramOwnedByWallet = telegramIdentities.filter(
    (identity) => identity.playerId === input.walletPlayerId,
  )
  if (telegramOwnedByWallet.length > 0) {
    throw new IdentityMergeConflictError(
      'The wallet-origin Player already has a Telegram identity and cannot be auto-merged.',
    )
  }
  const telegramOwnedByCanonical = telegramIdentities.filter(
    (identity) => identity.playerId === input.telegramPlayerId,
  )
  if (telegramOwnedByCanonical.length > 1) {
    throw new IdentityMergeConflictError(
      'The canonical Player has multiple Telegram identities and needs operator review.',
    )
  }

  const walletIdentities = await database
    .select()
    .from(schema.walletIdentities)
    .where(inArray(schema.walletIdentities.playerId, playerIds))
    .orderBy(asc(schema.walletIdentities.id))
    .for('update')
  const canonicalWallets = walletIdentities.filter(
    (wallet) => wallet.playerId === input.telegramPlayerId,
  )
  const walletOriginWallets = walletIdentities.filter(
    (wallet) => wallet.playerId === input.walletPlayerId,
  )
  if (walletOriginWallets.length > 1 || canonicalWallets.length > 1) {
    throw new IdentityMergeConflictError(
      'A Player has more than one wallet identity and needs operator review.',
    )
  }
  if (
    canonicalWallets[0] &&
    walletOriginWallets[0] &&
    canonicalWallets[0].address !== walletOriginWallets[0].address
  ) {
    throw new IdentityMergeConflictError(
      'The Telegram Player already owns a different wallet identity.',
    )
  }

  if (telegramOwnedByCanonical.length === 0 && telegramIdentities.length > 0) {
    throw new IdentityMergeConflictError('Telegram identity ownership is inconsistent.')
  }

  await reassignSimpleReferences(database, input)
  await reassignAnswers(database, input)
  await reassignScrambleGuesses(database, input)
  await reassignWordSeekGuesses(database, input)
  await reassignSocialTaskSubmissions(database, input)
  await reassignScoreEvents(database, input)
  await reassignManualAwards(database, input)
  await reassignRewardEntitlements(database, input)
  await reassignActivityRollups(database, input)
  await reassignRallyoXpEvents(database, input)

  if (walletOriginWallets[0] && !canonicalWallets[0]) {
    await database
      .update(schema.walletIdentities)
      .set({ playerId: input.telegramPlayerId })
      .where(eq(schema.walletIdentities.id, walletOriginWallets[0].id))
  } else if (walletOriginWallets[0] && canonicalWallets[0]) {
    throw new IdentityMergeConflictError('The same wallet identity is present twice.')
  }

  await database
    .update(schema.players)
    .set({
      lastSeenAt: input.now,
      ...(players.find((player) => player.id === input.telegramPlayerId)?.nickname
        ? {}
        : {
            nickname:
              players.find((player) => player.id === input.walletPlayerId)?.nickname ?? null,
          }),
    })
    .where(eq(schema.players.id, input.telegramPlayerId))
  await database.delete(schema.players).where(eq(schema.players.id, input.walletPlayerId))

  return { playerId: input.telegramPlayerId }
}

async function reassignSimpleReferences(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const { telegramPlayerId, walletPlayerId } = input
  await database
    .update(schema.walletChallenges)
    .set({ playerId: telegramPlayerId })
    .where(eq(schema.walletChallenges.playerId, walletPlayerId))
  await database
    .update(schema.appSessionCodes)
    .set({ playerId: telegramPlayerId })
    .where(eq(schema.appSessionCodes.playerId, walletPlayerId))
  await database
    .update(schema.appSessions)
    .set({ playerId: telegramPlayerId })
    .where(eq(schema.appSessions.playerId, walletPlayerId))
  await database
    .update(schema.analyticsEvents)
    .set({ playerId: telegramPlayerId })
    .where(eq(schema.analyticsEvents.playerId, walletPlayerId))
  await database
    .update(schema.scrambleRounds)
    .set({ winnerPlayerId: telegramPlayerId })
    .where(eq(schema.scrambleRounds.winnerPlayerId, walletPlayerId))
  await database
    .update(schema.wordSeekSessions)
    .set({ winnerPlayerId: telegramPlayerId })
    .where(eq(schema.wordSeekSessions.winnerPlayerId, walletPlayerId))
}

async function reassignAnswers(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.answers)
    .where(eq(schema.answers.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const existing = await database
      .select({ id: schema.answers.id, playerId: schema.answers.playerId })
      .from(schema.answers)
      .where(
        and(
          ne(schema.answers.id, row.id),
          or(
            eq(schema.answers.roundId, row.roundId),
            eq(schema.answers.telegramInputId, row.telegramInputId),
          ),
        ),
      )
      .for('update')
    resolveUniqueCollision(existing, input.telegramPlayerId, 'quiz answer')
    if (existing.some((candidate) => candidate.playerId === input.telegramPlayerId)) {
      await database.delete(schema.answers).where(eq(schema.answers.id, row.id))
    } else {
      await database
        .update(schema.answers)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.answers.id, row.id))
    }
  }
}

async function reassignScrambleGuesses(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.scrambleGuesses)
    .where(eq(schema.scrambleGuesses.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const existing = await database
      .select({ id: schema.scrambleGuesses.id, playerId: schema.scrambleGuesses.playerId })
      .from(schema.scrambleGuesses)
      .where(
        and(
          ne(schema.scrambleGuesses.id, row.id),
          or(
            eq(schema.scrambleGuesses.telegramInputId, row.telegramInputId),
            and(
              eq(schema.scrambleGuesses.roundId, row.roundId),
              eq(schema.scrambleGuesses.playerId, input.telegramPlayerId),
              eq(schema.scrambleGuesses.normalizedAnswer, row.normalizedAnswer),
            ),
          ),
        ),
      )
      .for('update')
    resolveUniqueCollision(existing, input.telegramPlayerId, 'scramble guess')
    if (existing.some((candidate) => candidate.playerId === input.telegramPlayerId)) {
      await database.delete(schema.scrambleGuesses).where(eq(schema.scrambleGuesses.id, row.id))
    } else {
      await database
        .update(schema.scrambleGuesses)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.scrambleGuesses.id, row.id))
    }
  }
}

async function reassignSocialTaskSubmissions(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.socialTaskSubmissions)
    .where(eq(schema.socialTaskSubmissions.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const existing = await database
      .select({
        id: schema.socialTaskSubmissions.id,
        playerId: schema.socialTaskSubmissions.playerId,
      })
      .from(schema.socialTaskSubmissions)
      .where(
        and(
          ne(schema.socialTaskSubmissions.id, row.id),
          eq(schema.socialTaskSubmissions.taskId, row.taskId),
          eq(schema.socialTaskSubmissions.reference, row.reference),
        ),
      )
      .for('update')
    resolveUniqueCollision(existing, input.telegramPlayerId, 'social-task submission')
    if (existing.some((candidate) => candidate.playerId === input.telegramPlayerId)) {
      await database
        .delete(schema.socialTaskSubmissions)
        .where(eq(schema.socialTaskSubmissions.id, row.id))
    } else {
      await database
        .update(schema.socialTaskSubmissions)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.socialTaskSubmissions.id, row.id))
    }
  }
}

async function reassignWordSeekGuesses(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.wordSeekGuesses)
    .where(eq(schema.wordSeekGuesses.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const existing = await database
      .select({ id: schema.wordSeekGuesses.id, playerId: schema.wordSeekGuesses.playerId })
      .from(schema.wordSeekGuesses)
      .where(
        and(
          ne(schema.wordSeekGuesses.id, row.id),
          or(
            eq(schema.wordSeekGuesses.telegramInputId, row.telegramInputId),
            and(
              eq(schema.wordSeekGuesses.sessionId, row.sessionId),
              eq(schema.wordSeekGuesses.normalizedGuess, row.normalizedGuess),
            ),
          ),
        ),
      )
      .for('update')
    resolveUniqueCollision(existing, input.telegramPlayerId, 'Word Seek guess')
    if (existing.some((candidate) => candidate.playerId === input.telegramPlayerId)) {
      await database.delete(schema.wordSeekGuesses).where(eq(schema.wordSeekGuesses.id, row.id))
    } else {
      await database
        .update(schema.wordSeekGuesses)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.wordSeekGuesses.id, row.id))
    }
  }
}

async function reassignScoreEvents(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.scoreEvents)
    .where(eq(schema.scoreEvents.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const collisionFilters = [eq(schema.scoreEvents.idempotencyKey, row.idempotencyKey)]
    if (row.roundId) collisionFilters.push(eq(schema.scoreEvents.roundId, row.roundId))
    if (row.sourceId) {
      const sourceFilter = and(
        eq(schema.scoreEvents.sourceType, row.sourceType),
        eq(schema.scoreEvents.sourceId, row.sourceId),
      )
      if (sourceFilter) collisionFilters.push(sourceFilter)
    }
    const existing = await database
      .select({ id: schema.scoreEvents.id, playerId: schema.scoreEvents.playerId })
      .from(schema.scoreEvents)
      .where(
        and(
          ne(schema.scoreEvents.id, row.id),
          eq(schema.scoreEvents.playerId, input.telegramPlayerId),
          or(...collisionFilters),
        ),
      )
      .for('update')
    const [otherPlayerIdempotencyCollision] = await database
      .select({ id: schema.scoreEvents.id, playerId: schema.scoreEvents.playerId })
      .from(schema.scoreEvents)
      .where(
        and(
          ne(schema.scoreEvents.id, row.id),
          eq(schema.scoreEvents.idempotencyKey, row.idempotencyKey),
        ),
      )
      .for('update')
    if (
      otherPlayerIdempotencyCollision &&
      otherPlayerIdempotencyCollision.playerId !== input.telegramPlayerId
    ) {
      throw new IdentityMergeConflictError('A score event key belongs to another Player.')
    }
    if (existing.length > 1) {
      throw new IdentityMergeConflictError('Multiple canonical score events match one history row.')
    }
    if (existing.length > 0) {
      const canonicalEventId = existing[0]?.id
      if (!canonicalEventId)
        throw new IdentityMergeConflictError('A score event collision is ambiguous.')
      await rewireManualAwards(database, row.id, canonicalEventId, input.telegramPlayerId)
      await database.delete(schema.scoreEvents).where(eq(schema.scoreEvents.id, row.id))
    } else {
      await database
        .update(schema.scoreEvents)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.scoreEvents.id, row.id))
    }
  }
}

async function reassignRallyoXpEvents(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.rallyoXpEvents)
    .where(eq(schema.rallyoXpEvents.playerId, input.walletPlayerId))
    .for('update')

  for (const row of rows) {
    if (row.claimDate) {
      const [collision] = await database
        .select({ id: schema.rallyoXpEvents.id })
        .from(schema.rallyoXpEvents)
        .where(
          and(
            eq(schema.rallyoXpEvents.playerId, input.telegramPlayerId),
            eq(schema.rallyoXpEvents.eventType, row.eventType),
            eq(schema.rallyoXpEvents.claimDate, row.claimDate),
          ),
        )
        .for('update')
      if (collision) {
        throw new IdentityMergeConflictError(
          'The Players have conflicting Rallyo XP history and need operator review.',
        )
      }
    }

    await database
      .update(schema.rallyoXpEvents)
      .set({ playerId: input.telegramPlayerId })
      .where(eq(schema.rallyoXpEvents.id, row.id))
  }
}

async function reassignManualAwards(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string },
) {
  const rows = await database
    .select()
    .from(schema.manualScoreAwards)
    .where(eq(schema.manualScoreAwards.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const filters = [eq(schema.manualScoreAwards.idempotencyKey, row.idempotencyKey)]
    if (row.scoreEventId) filters.push(eq(schema.manualScoreAwards.scoreEventId, row.scoreEventId))
    const existing = await database
      .select({ id: schema.manualScoreAwards.id, playerId: schema.manualScoreAwards.playerId })
      .from(schema.manualScoreAwards)
      .where(and(ne(schema.manualScoreAwards.id, row.id), or(...filters)))
      .for('update')
    resolveUniqueCollision(existing, input.telegramPlayerId, 'manual award')
    if (existing.some((candidate) => candidate.playerId === input.telegramPlayerId)) {
      await database.delete(schema.manualScoreAwards).where(eq(schema.manualScoreAwards.id, row.id))
    } else {
      await database
        .update(schema.manualScoreAwards)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.manualScoreAwards.id, row.id))
    }
  }
}

async function rewireManualAwards(
  database: DatabaseExecutor,
  losingScoreEventId: string,
  canonicalScoreEventId: string,
  canonicalPlayerId: string,
) {
  const losingAwards = await database
    .select({ id: schema.manualScoreAwards.id })
    .from(schema.manualScoreAwards)
    .where(eq(schema.manualScoreAwards.scoreEventId, losingScoreEventId))
    .for('update')
  for (const award of losingAwards) {
    const [canonicalAward] = await database
      .select({ id: schema.manualScoreAwards.id })
      .from(schema.manualScoreAwards)
      .where(eq(schema.manualScoreAwards.scoreEventId, canonicalScoreEventId))
      .for('update')
    if (canonicalAward) {
      await database
        .delete(schema.manualScoreAwards)
        .where(eq(schema.manualScoreAwards.id, award.id))
    } else {
      await database
        .update(schema.manualScoreAwards)
        .set({ scoreEventId: canonicalScoreEventId, playerId: canonicalPlayerId })
        .where(eq(schema.manualScoreAwards.id, award.id))
    }
  }
}

async function reassignRewardEntitlements(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string; readonly now: Date },
) {
  const rows = await database
    .select()
    .from(schema.rewardEntitlements)
    .where(eq(schema.rewardEntitlements.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const existing = await database
      .select()
      .from(schema.rewardEntitlements)
      .where(
        and(
          ne(schema.rewardEntitlements.id, row.id),
          or(
            eq(schema.rewardEntitlements.idempotencyKey, row.idempotencyKey),
            and(
              eq(schema.rewardEntitlements.seasonId, row.seasonId),
              eq(schema.rewardEntitlements.playerId, input.telegramPlayerId),
            ),
          ),
        ),
      )
      .for('update')
    resolveUniqueCollision(existing, input.telegramPlayerId, 'reward entitlement')
    const canonical = existing.find((candidate) => candidate.playerId === input.telegramPlayerId)
    if (canonical) {
      if (canonical.rank !== row.rank || canonical.amountLuna !== row.amountLuna) {
        throw new IdentityMergeConflictError(
          'Reward entitlement values conflict for the same season.',
        )
      }
      const status = strongerRewardStatus(canonical.status, row.status)
      const transactionHash = canonical.transactionHash ?? row.transactionHash
      if (
        canonical.transactionHash &&
        row.transactionHash &&
        canonical.transactionHash !== row.transactionHash
      ) {
        throw new IdentityMergeConflictError('Reward transaction hashes conflict during pairing.')
      }
      await database
        .update(schema.rewardEntitlements)
        .set({ status, transactionHash, updatedAt: input.now })
        .where(eq(schema.rewardEntitlements.id, canonical.id))
      await database
        .delete(schema.rewardEntitlements)
        .where(eq(schema.rewardEntitlements.id, row.id))
    } else {
      await database
        .update(schema.rewardEntitlements)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.rewardEntitlements.id, row.id))
    }
  }
}

async function reassignActivityRollups(
  database: DatabaseExecutor,
  input: { readonly telegramPlayerId: string; readonly walletPlayerId: string; readonly now: Date },
) {
  const rows = await database
    .select()
    .from(schema.communityActivityRollups)
    .where(eq(schema.communityActivityRollups.playerId, input.walletPlayerId))
    .for('update')
  for (const row of rows) {
    const [canonical] = await database
      .select({ id: schema.communityActivityRollups.id })
      .from(schema.communityActivityRollups)
      .where(
        and(
          eq(schema.communityActivityRollups.communityId, row.communityId),
          eq(schema.communityActivityRollups.playerId, input.telegramPlayerId),
          eq(schema.communityActivityRollups.bucketStart, row.bucketStart),
        ),
      )
      .for('update')
    if (canonical) {
      await database
        .update(schema.communityActivityRollups)
        .set({
          messageCount: sql`${schema.communityActivityRollups.messageCount} + ${row.messageCount}`,
          replyCount: sql`${schema.communityActivityRollups.replyCount} + ${row.replyCount}`,
          updatedAt: input.now,
        })
        .where(eq(schema.communityActivityRollups.id, canonical.id))
      await database
        .delete(schema.communityActivityRollups)
        .where(eq(schema.communityActivityRollups.id, row.id))
    } else {
      await database
        .update(schema.communityActivityRollups)
        .set({ playerId: input.telegramPlayerId })
        .where(eq(schema.communityActivityRollups.id, row.id))
    }
  }
}

function resolveUniqueCollision(
  rows: readonly { readonly id: string; readonly playerId: string }[],
  canonicalPlayerId: string,
  resource: string,
) {
  if (rows.some((row) => row.playerId !== canonicalPlayerId)) {
    throw new IdentityMergeConflictError(`A ${resource} uniqueness key belongs to another Player.`)
  }
}

function strongerRewardStatus(
  left: (typeof schema.rewardStatus.enumValues)[number],
  right: (typeof schema.rewardStatus.enumValues)[number],
) {
  const strength = {
    FAILED: 1,
    ELIGIBLE: 2,
    CLAIMING: 3,
    SENT: 4,
    CONFIRMED: 5,
  } as const
  return strength[left] >= strength[right] ? left : right
}
