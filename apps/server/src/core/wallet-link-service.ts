import { createHash, randomBytes } from 'node:crypto'

import { Address, BufferUtils, PublicKey, Signature } from '@nimiq/core'
import { and, eq, gt, isNull } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

const CODE_TTL_MS = 10 * 60_000
const CHALLENGE_TTL_MS = 5 * 60_000

export class WalletLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletLinkError'
  }
}

export class WalletLinkService {
  constructor(private readonly database: RallyoDatabase) {}

  async issueCode(input: { readonly telegramIdentityId: string; readonly now?: Date }) {
    const now = input.now ?? new Date()
    const code = randomCode()
    const [row] = await this.database
      .insert(schema.walletLinkCodes)
      .values({
        telegramIdentityId: input.telegramIdentityId,
        codeHash: hash(code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      })
      .returning({ id: schema.walletLinkCodes.id, expiresAt: schema.walletLinkCodes.expiresAt })
    if (!row) throw new WalletLinkError('Could not issue a wallet link code.')
    return { code, ...row }
  }

  async beginChallenge(input: {
    readonly code: string
    readonly address: string
    readonly now?: Date
  }) {
    const now = input.now ?? new Date()
    const normalizedAddress = normalizeNimiqAddress(input.address)
    return this.database.transaction(async (tx) => {
      const [code] = await tx
        .select()
        .from(schema.walletLinkCodes)
        .where(
          and(
            eq(schema.walletLinkCodes.codeHash, hash(input.code)),
            isNull(schema.walletLinkCodes.consumedAt),
            gt(schema.walletLinkCodes.expiresAt, now),
          ),
        )
        .for('update')
      if (!code) throw new WalletLinkError('Wallet link code is invalid or expired.')

      const [identity] = await tx
        .select({ playerId: schema.telegramIdentities.playerId })
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.id, code.telegramIdentityId))
      if (!identity) throw new WalletLinkError('Telegram identity no longer exists.')

      const [activeChallenge] = await tx
        .select({ id: schema.walletChallenges.id })
        .from(schema.walletChallenges)
        .where(
          and(
            eq(schema.walletChallenges.walletLinkCodeId, code.id),
            isNull(schema.walletChallenges.consumedAt),
            gt(schema.walletChallenges.expiresAt, now),
          ),
        )
        .limit(1)
      if (activeChallenge)
        throw new WalletLinkError('A wallet challenge is already active for this code.')

      const nonce = randomBytes(32).toString('hex')
      const message = `Rallyo wallet link\nAddress: ${normalizedAddress}\nNonce: ${nonce}`
      const [challenge] = await tx
        .insert(schema.walletChallenges)
        .values({
          playerId: identity.playerId,
          walletLinkCodeId: code.id,
          address: normalizedAddress,
          nonceHash: hash(nonce),
          messageHash: hash(message),
          expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
        })
        .returning({ id: schema.walletChallenges.id })
      if (!challenge) throw new WalletLinkError('Wallet challenge could not be created.')
      return {
        challengeId: challenge.id,
        message,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      }
    })
  }

  async completeChallenge(input: {
    readonly challengeId: string
    readonly message: string
    readonly publicKey: string
    readonly signature: string
    readonly format?: WalletSignatureFormat
    readonly now?: Date
  }) {
    const now = input.now ?? new Date()
    return this.database.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(schema.walletChallenges)
        .where(eq(schema.walletChallenges.id, input.challengeId))
        .for('update')
      if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
        throw new WalletLinkError('Wallet challenge is invalid, expired, or already used.')
      }

      if (
        !verifyNimiqWalletSignature({
          message: input.message,
          messageHash: challenge.messageHash,
          publicKeyHex: input.publicKey,
          signatureHex: input.signature,
          expectedAddress: challenge.address,
          ...(input.format ? { format: input.format } : {}),
        })
      ) {
        throw new WalletLinkError('Wallet signature verification failed.')
      }

      const [wallet] = await tx
        .insert(schema.walletIdentities)
        .values({
          playerId: challenge.playerId,
          address: challenge.address,
          publicKey: input.publicKey,
        })
        .onConflictDoNothing({ target: schema.walletIdentities.address })
        .returning()
      if (!wallet) throw new WalletLinkError('Wallet address is already linked.')
      await tx
        .update(schema.walletChallenges)
        .set({ consumedAt: now })
        .where(eq(schema.walletChallenges.id, challenge.id))
      await tx
        .update(schema.walletLinkCodes)
        .set({ consumedAt: now })
        .where(eq(schema.walletLinkCodes.id, challenge.walletLinkCodeId))
      return wallet
    })
  }
}

export function normalizeNimiqAddress(value: string): string {
  try {
    return Address.fromUserFriendlyAddress(value).toUserFriendlyAddress()
  } catch {
    throw new WalletLinkError('Invalid Nimiq address.')
  }
}

export function verifyNimiqWalletSignature(input: {
  readonly message: string
  readonly messageHash: string
  readonly publicKeyHex: string
  readonly signatureHex: string
  readonly expectedAddress: string
  readonly format?: WalletSignatureFormat
}): boolean {
  try {
    const publicKey = PublicKey.fromHex(input.publicKeyHex)
    const signature = Signature.fromHex(input.signatureHex)
    const format = input.format ?? 'mini-app'
    if (format !== 'mini-app' && format !== 'hub') return false
    const signedData =
      format === 'hub'
        ? nimiqHubSignedMessageHash(input.message)
        : BufferUtils.fromUtf8(input.message)
    return (
      hash(input.message) === input.messageHash &&
      publicKey.verify(signature, signedData) &&
      publicKey.toAddress().toUserFriendlyAddress() === input.expectedAddress
    )
  } catch {
    return false
  }
}

export type WalletSignatureFormat = 'mini-app' | 'hub'

export function nimiqHubSignedMessageHash(message: string): Uint8Array {
  const prefix = '\u0016Nimiq Signed Message:\n'
  return createHash('sha256')
    .update(BufferUtils.fromUtf8(`${prefix}${message.length}${message}`))
    .digest()
}

function randomCode(): string {
  return randomBytes(5).toString('base64url').slice(0, 8).toUpperCase()
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
