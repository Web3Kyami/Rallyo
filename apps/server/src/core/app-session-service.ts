import { createHash, randomBytes } from 'node:crypto'

import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import {
  IdentityMergeConflictError,
  mergeWalletPlayerIntoTelegramPlayer,
} from './identity-merge-service'

const APP_CODE_TTL_MS = 5 * 60_000
const APP_SESSION_TTL_MS = 30 * 24 * 60 * 60_000
const TELEGRAM_PAIRING_TTL_MS = 10 * 60_000

export type AppSessionDatabaseExecutor = Pick<
  RallyoDatabase,
  'select' | 'insert' | 'update' | 'delete'
>

export type AppSessionTargetMode = 'player' | 'admin'

export type AppSessionActor = {
  readonly sessionId: string
  readonly playerId: string
  readonly telegramIdentityId: string | null
  readonly telegramUserId: bigint | null
  readonly targetCommunityId: string | null
  readonly targetMode: AppSessionTargetMode
  readonly expiresAt: Date
}

export type AppSessionIssued = {
  readonly token: string
  readonly sessionId: string
  readonly expiresAt: Date
  readonly redirectPath: string
}

export class AppSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppSessionError'
  }
}

export class AppSessionService {
  constructor(private readonly database: RallyoDatabase) {}

  async issueCode(input: {
    readonly telegramIdentityId: string
    readonly targetMode?: AppSessionTargetMode
    readonly targetCommunityId?: string
    readonly now?: Date
  }) {
    const now = input.now ?? new Date()
    const targetMode = input.targetMode ?? 'player'
    const [identity] = await this.database
      .select({
        id: schema.telegramIdentities.id,
        playerId: schema.telegramIdentities.playerId,
        telegramUserId: schema.telegramIdentities.telegramUserId,
      })
      .from(schema.telegramIdentities)
      .where(eq(schema.telegramIdentities.id, input.telegramIdentityId))
      .limit(1)

    if (!identity) throw new AppSessionError('Telegram identity could not be loaded.')
    if (targetMode === 'admin' && !input.targetCommunityId) {
      throw new AppSessionError('An admin session needs a target community.')
    }

    if (targetMode === 'admin') {
      const [admin] = await this.database
        .select({ id: schema.communityAdmins.id })
        .from(schema.communityAdmins)
        .where(
          and(
            eq(schema.communityAdmins.communityId, input.targetCommunityId!),
            eq(schema.communityAdmins.telegramUserId, identity.telegramUserId),
          ),
        )
        .limit(1)
      if (!admin) throw new AppSessionError('Telegram admin access could not be verified.')
    }

    const code = randomToken()
    const [row] = await this.database
      .insert(schema.appSessionCodes)
      .values({
        playerId: identity.playerId,
        telegramIdentityId: identity.id,
        ...(input.targetCommunityId ? { targetCommunityId: input.targetCommunityId } : {}),
        targetMode,
        codeHash: hash(code),
        expiresAt: new Date(now.getTime() + APP_CODE_TTL_MS),
      })
      .returning({ id: schema.appSessionCodes.id, expiresAt: schema.appSessionCodes.expiresAt })

    if (!row) throw new AppSessionError('App session code could not be created.')
    return { code, expiresAt: row.expiresAt, id: row.id }
  }

  async issueTelegramPairingCode(input: {
    readonly telegramIdentityId: string
    readonly now?: Date
  }) {
    return this.database.transaction((tx) =>
      issueTelegramPairingCode(tx, { ...input, replaceActive: true }),
    )
  }

  async requestTelegramPairing(input: {
    readonly username: string
    readonly send?: (input: {
      readonly telegramUserId: bigint
      readonly code: string
    }) => Promise<void>
    readonly now?: Date
  }) {
    const username = normalizeTelegramUsername(input.username)
    if (!username) throw new AppSessionError('Enter a valid Telegram username.')

    const [identity] = await this.database
      .select({
        id: schema.telegramIdentities.id,
        telegramUserId: schema.telegramIdentities.telegramUserId,
      })
      .from(schema.telegramIdentities)
      .where(sql`lower(${schema.telegramIdentities.username}) = ${username}`)
      .limit(1)

    if (!identity || !input.send) return { sent: false as const }

    const issued = await this.issueTelegramPairingCode({
      telegramIdentityId: identity.id,
      ...(input.now ? { now: input.now } : {}),
    })
    try {
      await input.send({ telegramUserId: identity.telegramUserId, code: issued.code })
    } catch {
      return { sent: false as const }
    }
    return { sent: true as const, expiresAt: issued.expiresAt }
  }

  async exchangeTelegramPairingCode(input: {
    readonly code: string
    readonly now?: Date
  }): Promise<AppSessionIssued> {
    const now = input.now ?? new Date()
    if (!input.code || input.code.length > 100) {
      throw new AppSessionError('Telegram pairing code is invalid or expired.')
    }

    return this.database.transaction(async (tx) => {
      const [pairing] = await tx
        .select()
        .from(schema.telegramPairingCodes)
        .where(
          and(
            eq(schema.telegramPairingCodes.codeHash, hash(input.code)),
            isNull(schema.telegramPairingCodes.consumedAt),
            gt(schema.telegramPairingCodes.expiresAt, now),
          ),
        )
        .for('update')
      if (!pairing) throw new AppSessionError('Telegram pairing code is invalid or expired.')

      const [identity] = await tx
        .select({
          id: schema.telegramIdentities.id,
          playerId: schema.telegramIdentities.playerId,
        })
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.id, pairing.telegramIdentityId))
        .for('update')
      if (!identity) throw new AppSessionError('Telegram identity no longer exists.')

      const issued = await createAppSession(tx, {
        playerId: identity.playerId,
        telegramIdentityId: identity.id,
        now,
      })
      await tx
        .update(schema.telegramPairingCodes)
        .set({ consumedAt: now })
        .where(eq(schema.telegramPairingCodes.id, pairing.id))
      return issued
    })
  }

  async exchangeCode(input: {
    readonly code: string
    readonly now?: Date
  }): Promise<AppSessionIssued> {
    const now = input.now ?? new Date()
    if (!input.code || input.code.length > 200) {
      throw new AppSessionError('App session code is invalid or expired.')
    }

    return this.database.transaction(async (tx) => {
      const [code] = await tx
        .select()
        .from(schema.appSessionCodes)
        .where(
          and(
            eq(schema.appSessionCodes.codeHash, hash(input.code)),
            isNull(schema.appSessionCodes.consumedAt),
            gt(schema.appSessionCodes.expiresAt, now),
          ),
        )
        .for('update')

      if (!code) throw new AppSessionError('App session code is invalid or expired.')

      const issued = await createAppSession(tx, {
        playerId: code.playerId,
        telegramIdentityId: code.telegramIdentityId,
        targetCommunityId: code.targetCommunityId,
        targetMode: code.targetMode === 'admin' ? 'admin' : 'player',
        now,
      })

      await tx
        .update(schema.appSessionCodes)
        .set({ consumedAt: now })
        .where(eq(schema.appSessionCodes.id, code.id))

      return issued
    })
  }

  async createSession(input: {
    readonly playerId: string
    readonly telegramIdentityId?: string | null
    readonly targetCommunityId?: string | null
    readonly targetMode?: AppSessionTargetMode
    readonly now?: Date
  }): Promise<AppSessionIssued> {
    return createAppSession(this.database, input)
  }

  async pairTelegram(input: {
    readonly sessionToken: string
    readonly code: string
    readonly now?: Date
  }): Promise<{ readonly playerId: string; readonly redirectPath: string }> {
    const now = input.now ?? new Date()
    if (
      !input.sessionToken ||
      input.sessionToken.length > 300 ||
      !input.code ||
      input.code.length > 100
    ) {
      throw new AppSessionError('The app session or Telegram pairing code is invalid.')
    }

    try {
      return await this.database.transaction(async (tx) => {
        const [session] = await tx
          .select()
          .from(schema.appSessions)
          .where(
            and(
              eq(schema.appSessions.tokenHash, hash(input.sessionToken)),
              isNull(schema.appSessions.revokedAt),
              gt(schema.appSessions.expiresAt, now),
            ),
          )
          .for('update')
        if (!session) throw new AppSessionError('The app session is invalid or expired.')

        const [pairing] = await tx
          .select()
          .from(schema.telegramPairingCodes)
          .where(
            and(
              eq(schema.telegramPairingCodes.codeHash, hash(input.code)),
              isNull(schema.telegramPairingCodes.consumedAt),
              gt(schema.telegramPairingCodes.expiresAt, now),
            ),
          )
          .for('update')
        if (!pairing) throw new AppSessionError('Telegram pairing code is invalid or expired.')

        const [identity] = await tx
          .select()
          .from(schema.telegramIdentities)
          .where(eq(schema.telegramIdentities.id, pairing.telegramIdentityId))
          .for('update')
        if (!identity) throw new AppSessionError('Telegram identity no longer exists.')

        if (session.telegramIdentityId && session.telegramIdentityId !== identity.id) {
          throw new AppSessionError('This Rallyo Player already has a different Telegram identity.')
        }

        let playerId = session.playerId
        if (session.playerId !== identity.playerId) {
          if (session.telegramIdentityId) {
            throw new AppSessionError('Two Telegram identities cannot be merged automatically.')
          }
          const merged = await mergeWalletPlayerIntoTelegramPlayer(tx, {
            telegramPlayerId: identity.playerId,
            walletPlayerId: session.playerId,
            now,
          })
          playerId = merged.playerId
        }

        await tx
          .update(schema.appSessions)
          .set({ playerId, telegramIdentityId: identity.id, lastSeenAt: now })
          .where(eq(schema.appSessions.id, session.id))
        await tx
          .update(schema.telegramPairingCodes)
          .set({ consumedAt: now })
          .where(eq(schema.telegramPairingCodes.id, pairing.id))

        return { playerId, redirectPath: '/app' }
      })
    } catch (error) {
      if (error instanceof AppSessionError) throw error
      if (error instanceof IdentityMergeConflictError) throw new AppSessionError(error.message)
      throw error
    }
  }

  async getSession(token: string | undefined, now = new Date()): Promise<AppSessionActor | null> {
    if (!token || token.length > 300) return null

    const [row] = await this.database
      .select({
        sessionId: schema.appSessions.id,
        playerId: schema.appSessions.playerId,
        telegramIdentityId: schema.appSessions.telegramIdentityId,
        targetCommunityId: schema.appSessions.targetCommunityId,
        targetMode: schema.appSessions.targetMode,
        expiresAt: schema.appSessions.expiresAt,
      })
      .from(schema.appSessions)
      .where(
        and(
          eq(schema.appSessions.tokenHash, hash(token)),
          isNull(schema.appSessions.revokedAt),
          gt(schema.appSessions.expiresAt, now),
        ),
      )
      .limit(1)

    if (!row) return null

    const identity = await resolveSessionTelegramIdentity(this.database, {
      playerId: row.playerId,
      telegramIdentityId: row.telegramIdentityId,
    })

    await this.database
      .update(schema.appSessions)
      .set({
        lastSeenAt: now,
        ...(row.telegramIdentityId === null && identity ? { telegramIdentityId: identity.id } : {}),
      })
      .where(eq(schema.appSessions.id, row.sessionId))

    const targetMode: AppSessionTargetMode = row.targetMode === 'admin' ? 'admin' : 'player'
    return {
      ...row,
      telegramIdentityId: identity?.id ?? null,
      telegramUserId: identity?.telegramUserId ?? null,
      targetMode,
    }
  }

  async revokeSession(token: string | undefined, now = new Date()): Promise<void> {
    if (!token || token.length > 300) return
    await this.database
      .update(schema.appSessions)
      .set({ revokedAt: now })
      .where(
        and(eq(schema.appSessions.tokenHash, hash(token)), isNull(schema.appSessions.revokedAt)),
      )
  }
}

export async function issueTelegramPairingCode(
  database: AppSessionDatabaseExecutor,
  input: {
    readonly telegramIdentityId: string
    readonly now?: Date
    readonly replaceActive?: boolean
  },
) {
  const now = input.now ?? new Date()
  const identityQuery = database
    .select({ id: schema.telegramIdentities.id })
    .from(schema.telegramIdentities)
    .where(eq(schema.telegramIdentities.id, input.telegramIdentityId))
    .limit(1)
  const [identity] = input.replaceActive ? await identityQuery.for('update') : await identityQuery
  if (!identity) throw new AppSessionError('Telegram identity could not be loaded.')

  if (input.replaceActive) {
    await database
      .update(schema.telegramPairingCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramPairingCodes.telegramIdentityId, identity.id),
          isNull(schema.telegramPairingCodes.consumedAt),
          gt(schema.telegramPairingCodes.expiresAt, now),
        ),
      )
  }

  const code = randomPairingCode()
  const [row] = await database
    .insert(schema.telegramPairingCodes)
    .values({
      telegramIdentityId: identity.id,
      codeHash: hash(code),
      expiresAt: new Date(now.getTime() + TELEGRAM_PAIRING_TTL_MS),
    })
    .returning({
      id: schema.telegramPairingCodes.id,
      expiresAt: schema.telegramPairingCodes.expiresAt,
    })
  if (!row) throw new AppSessionError('Telegram pairing code could not be created.')
  return { code, expiresAt: row.expiresAt, id: row.id }
}

export async function createAppSession(
  database: AppSessionDatabaseExecutor,
  input: {
    readonly playerId: string
    readonly telegramIdentityId?: string | null
    readonly targetCommunityId?: string | null
    readonly targetMode?: AppSessionTargetMode
    readonly now?: Date
  },
): Promise<AppSessionIssued> {
  const now = input.now ?? new Date()
  const identity = await resolveSessionTelegramIdentity(database, input)
  const token = randomToken()
  const expiresAt = new Date(now.getTime() + APP_SESSION_TTL_MS)
  const targetMode = input.targetMode ?? 'player'
  const [session] = await database
    .insert(schema.appSessions)
    .values({
      playerId: input.playerId,
      ...(identity ? { telegramIdentityId: identity.id } : {}),
      ...(input.targetCommunityId ? { targetCommunityId: input.targetCommunityId } : {}),
      targetMode,
      tokenHash: hash(token),
      expiresAt,
      lastSeenAt: now,
    })
    .returning({ id: schema.appSessions.id })
  if (!session) throw new AppSessionError('Web session could not be created.')
  return {
    token,
    sessionId: session.id,
    expiresAt,
    redirectPath:
      targetMode === 'admin' && input.targetCommunityId
        ? `/app/admin/${input.targetCommunityId}`
        : '/app',
  }
}

async function resolveSessionTelegramIdentity(
  database: AppSessionDatabaseExecutor,
  input: { readonly playerId: string; readonly telegramIdentityId?: string | null },
): Promise<{ readonly id: string; readonly telegramUserId: bigint } | null> {
  if (input.telegramIdentityId) {
    const [identity] = await database
      .select({
        id: schema.telegramIdentities.id,
        telegramUserId: schema.telegramIdentities.telegramUserId,
      })
      .from(schema.telegramIdentities)
      .where(
        and(
          eq(schema.telegramIdentities.id, input.telegramIdentityId),
          eq(schema.telegramIdentities.playerId, input.playerId),
        ),
      )
      .limit(1)
    if (!identity) {
      throw new AppSessionError('The Telegram identity no longer belongs to this Rallyo Player.')
    }
    return identity
  }

  const identities = await database
    .select({
      id: schema.telegramIdentities.id,
      telegramUserId: schema.telegramIdentities.telegramUserId,
    })
    .from(schema.telegramIdentities)
    .where(eq(schema.telegramIdentities.playerId, input.playerId))
    .limit(2)

  // A Player normally has zero or one Telegram identity. Never choose between an
  // invalid multi-identity state: it requires operator recovery rather than a
  // session silently impersonating one of the identities.
  return identities.length === 1 ? (identities[0] ?? null) : null
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function randomPairingCode(): string {
  return randomBytes(5).toString('base64url').slice(0, 8).toUpperCase()
}

function normalizeTelegramUsername(value: string): string {
  return value.trim().replace(/^@/u, '').toLocaleLowerCase('en-US')
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
