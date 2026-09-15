import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { and, eq, gt, isNull } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

const OPERATOR_SESSION_TTL_MS = 12 * 60 * 60_000

export type OperatorSessionDatabaseExecutor = Pick<
  RallyoDatabase,
  'select' | 'insert' | 'update' | 'delete'
>

export type OperatorSessionActor = {
  readonly sessionId: string
  readonly expiresAt: Date
}

export class OperatorSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperatorSessionError'
  }
}

export class OperatorSessionService {
  private readonly accessKeyHash: Buffer | null

  constructor(
    private readonly database: RallyoDatabase,
    accessKey: string | undefined,
  ) {
    this.accessKeyHash = accessKey && accessKey.length >= 16 ? hashBuffer(accessKey) : null
  }

  get configured(): boolean {
    return this.accessKeyHash !== null
  }

  async authenticate(input: { readonly accessKey: string; readonly now?: Date }) {
    if (!this.accessKeyHash || input.accessKey.length === 0 || input.accessKey.length > 400) {
      return null
    }

    const receivedHash = hashBuffer(input.accessKey)
    if (!timingSafeEqual(receivedHash, this.accessKeyHash)) return null

    const now = input.now ?? new Date()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + OPERATOR_SESSION_TTL_MS)
    const [session] = await this.database
      .insert(schema.operatorSessions)
      .values({
        tokenHash: hash(token),
        expiresAt,
        lastSeenAt: now,
      })
      .returning({ id: schema.operatorSessions.id })

    if (!session) throw new OperatorSessionError('Operator session could not be created.')
    return { token, sessionId: session.id, expiresAt }
  }

  async getSession(
    token: string | undefined,
    now = new Date(),
  ): Promise<OperatorSessionActor | null> {
    if (!token || token.length > 300) return null

    const [row] = await this.database
      .select({
        sessionId: schema.operatorSessions.id,
        expiresAt: schema.operatorSessions.expiresAt,
      })
      .from(schema.operatorSessions)
      .where(
        and(
          eq(schema.operatorSessions.tokenHash, hash(token)),
          isNull(schema.operatorSessions.revokedAt),
          gt(schema.operatorSessions.expiresAt, now),
        ),
      )
      .limit(1)

    if (!row) return null
    await this.database
      .update(schema.operatorSessions)
      .set({ lastSeenAt: now })
      .where(eq(schema.operatorSessions.id, row.sessionId))
    return row
  }

  async revokeSession(token: string | undefined, now = new Date()): Promise<void> {
    if (!token || token.length > 300) return
    await this.database
      .update(schema.operatorSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.operatorSessions.tokenHash, hash(token)),
          isNull(schema.operatorSessions.revokedAt),
        ),
      )
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hashBuffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}
