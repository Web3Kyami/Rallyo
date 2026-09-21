import { createHash, randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { createAppSession, type AppSessionActor } from './app-session-service'
import {
  IdentityMergeConflictError,
  mergeWalletPlayerIntoTelegramPlayer,
} from './identity-merge-service'
import {
  normalizeNimiqAddress,
  inspectNimiqWalletSignature,
  type WalletSignatureDiagnostics,
  type WalletSignatureFormat,
} from './wallet-link-service'

const APP_WALLET_CHALLENGE_TTL_MS = 5 * 60_000

type WalletAuthDatabaseExecutor = Pick<RallyoDatabase, 'select' | 'insert' | 'update' | 'delete'>

export class AppWalletAuthError extends Error {
  readonly walletVerification: WalletSignatureDiagnostics | undefined

  constructor(message: string, walletVerification?: WalletSignatureDiagnostics) {
    super(message)
    this.name = 'AppWalletAuthError'
    this.walletVerification = walletVerification
  }
}

export class AppWalletAuthService {
  constructor(private readonly database: RallyoDatabase) {}

  async beginChallenge(input: {
    readonly address?: string
    readonly format?: WalletSignatureFormat
    readonly now?: Date
  }) {
    const now = input.now ?? new Date()
    const format = input.format ?? 'hub'
    if (format !== 'mini-app' && format !== 'hub') {
      throw new AppWalletAuthError('Unsupported wallet signature format.')
    }
    if (format === 'hub' && !input.address) throw new AppWalletAuthError('Invalid Nimiq address.')
    if (format === 'mini-app' && input.address) {
      throw new AppWalletAuthError('Nimiq Pay signs with the wallet-selected account.')
    }
    let address: string | undefined
    if (input.address) {
      try {
        address = normalizeNimiqAddress(input.address)
      } catch {
        throw new AppWalletAuthError('Invalid Nimiq address.')
      }
    }

    const nonce = randomBytes(32).toString('hex')
    const message = address
      ? `Rallyo wallet sign in\nAddress: ${address}\nNonce: ${nonce}`
      : `Rallyo wallet sign in\nNonce: ${nonce}`
    const expiresAt = new Date(now.getTime() + APP_WALLET_CHALLENGE_TTL_MS)
    const [challenge] = await this.database
      .insert(schema.appWalletChallenges)
      .values({
        ...(address ? { address } : {}),
        nonceHash: hash(nonce),
        messageHash: hash(message),
        expiresAt,
      })
      .returning({ id: schema.appWalletChallenges.id })
    if (!challenge) throw new AppWalletAuthError('Wallet sign-in challenge could not be created.')
    return { challengeId: challenge.id, message, expiresAt }
  }

  async completeChallenge(input: {
    readonly challengeId: string
    readonly message: string
    readonly publicKey: string
    readonly signature: string
    readonly signer?: string
    readonly format?: WalletSignatureFormat
    readonly authenticatedSession?: Pick<
      AppSessionActor,
      'playerId' | 'telegramIdentityId' | 'targetCommunityId' | 'targetMode'
    >
    readonly now?: Date
  }) {
    const now = input.now ?? new Date()
    return this.database.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(schema.appWalletChallenges)
        .where(eq(schema.appWalletChallenges.id, input.challengeId))
        .for('update')
      if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
        throw new AppWalletAuthError(
          'Wallet sign-in challenge is invalid, expired, or already used.',
        )
      }
      const verification = inspectNimiqWalletSignature({
        message: input.message,
        messageHash: challenge.messageHash,
        publicKeyHex: input.publicKey,
        signatureHex: input.signature,
        ...(challenge.address ? { expectedAddress: challenge.address } : {}),
        ...(input.signer === undefined ? {} : { signerAddress: input.signer }),
        ...(input.format ? { format: input.format } : {}),
      })
      if (!verification.valid) {
        throw new AppWalletAuthError('Wallet signature verification failed.', verification)
      }
      const address = challenge.address ?? verification.derivedPublicKeyAddress
      if (!address) {
        throw new AppWalletAuthError('Wallet signature verification failed.', verification)
      }

      const [existingWallet] = await tx
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, address))
        .for('update')

      let playerId: string
      if (input.authenticatedSession) {
        playerId = await attachWalletToAuthenticatedPlayer(tx, {
          currentPlayerId: input.authenticatedSession.playerId,
          existingWallet,
          address,
          publicKey: input.publicKey,
          now,
        })
      } else if (existingWallet) {
        if (existingWallet.revokedAt) {
          throw new AppWalletAuthError(
            'This wallet needs an operator-assisted recovery before sign-in.',
          )
        }
        playerId = existingWallet.playerId
      } else {
        const [newPlayer] = await tx
          .insert(schema.players)
          .values({})
          .returning({ id: schema.players.id })
        if (!newPlayer) throw new AppWalletAuthError('Wallet-origin Player could not be created.')
        const [wallet] = await tx
          .insert(schema.walletIdentities)
          .values({
            playerId: newPlayer.id,
            address,
            publicKey: input.publicKey,
          })
          .onConflictDoNothing({ target: schema.walletIdentities.address })
          .returning({ playerId: schema.walletIdentities.playerId })
        if (wallet) {
          playerId = wallet.playerId
        } else {
          const [racedWallet] = await tx
            .select()
            .from(schema.walletIdentities)
            .where(eq(schema.walletIdentities.address, address))
            .for('update')
          await tx.delete(schema.players).where(eq(schema.players.id, newPlayer.id))
          if (!racedWallet || racedWallet.revokedAt) {
            throw new AppWalletAuthError(
              'This wallet needs an operator-assisted recovery before sign-in.',
            )
          }
          playerId = racedWallet.playerId
        }
      }

      const session = await createAppSession(tx, {
        playerId,
        ...(input.authenticatedSession?.telegramIdentityId !== undefined
          ? { telegramIdentityId: input.authenticatedSession.telegramIdentityId }
          : {}),
        ...(input.authenticatedSession?.targetCommunityId !== undefined
          ? { targetCommunityId: input.authenticatedSession.targetCommunityId }
          : {}),
        ...(input.authenticatedSession?.targetMode !== undefined
          ? { targetMode: input.authenticatedSession.targetMode }
          : {}),
        now,
      })
      await tx
        .update(schema.appWalletChallenges)
        .set({ consumedAt: now })
        .where(eq(schema.appWalletChallenges.id, challenge.id))
      return { playerId, ...session }
    })
  }
}

async function attachWalletToAuthenticatedPlayer(
  database: WalletAuthDatabaseExecutor,
  input: {
    readonly currentPlayerId: string
    readonly existingWallet: typeof schema.walletIdentities.$inferSelect | undefined
    readonly address: string
    readonly publicKey: string
    readonly now: Date
  },
): Promise<string> {
  const [currentPlayer] = await database
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(eq(schema.players.id, input.currentPlayerId))
    .for('update')
  if (!currentPlayer) throw new AppWalletAuthError('Your Rallyo session is no longer valid.')

  const currentWallets = await database
    .select()
    .from(schema.walletIdentities)
    .where(eq(schema.walletIdentities.playerId, input.currentPlayerId))
    .for('update')
  const activeCurrentWallets = currentWallets.filter((wallet) => wallet.revokedAt === null)
  if (currentWallets.some((wallet) => wallet.revokedAt !== null)) {
    throw new AppWalletAuthError(
      'This Rallyo Player has a revoked wallet and needs operator-assisted recovery.',
    )
  }
  if (activeCurrentWallets.length > 1) {
    throw new AppWalletAuthError(
      'This Rallyo Player has multiple wallet identities and needs operator review.',
    )
  }

  if (!input.existingWallet) {
    if (activeCurrentWallets.length > 0) {
      throw new AppWalletAuthError('This Rallyo Player already has a different active wallet.')
    }
    const [wallet] = await database
      .insert(schema.walletIdentities)
      .values({
        playerId: input.currentPlayerId,
        address: input.address,
        publicKey: input.publicKey,
      })
      .onConflictDoNothing({ target: schema.walletIdentities.address })
      .returning({ playerId: schema.walletIdentities.playerId })
    if (wallet) return wallet.playerId

    const [racedWallet] = await database
      .select()
      .from(schema.walletIdentities)
      .where(eq(schema.walletIdentities.address, input.address))
      .for('update')
    if (!racedWallet) throw new AppWalletAuthError('Wallet identity could not be linked.')
    return attachWalletToAuthenticatedPlayer(database, { ...input, existingWallet: racedWallet })
  }

  if (input.existingWallet.revokedAt) {
    throw new AppWalletAuthError('This wallet needs an operator-assisted recovery before sign-in.')
  }
  if (input.existingWallet.playerId === input.currentPlayerId) return input.currentPlayerId
  if (activeCurrentWallets.length > 0) {
    throw new AppWalletAuthError('This Rallyo Player already has a different active wallet.')
  }

  const telegramIdentities = await database
    .select({ id: schema.telegramIdentities.id })
    .from(schema.telegramIdentities)
    .where(eq(schema.telegramIdentities.playerId, input.currentPlayerId))
    .for('update')
  if (telegramIdentities.length !== 1) {
    throw new AppWalletAuthError(
      'This wallet can only be reconciled from a Telegram-connected Rallyo Player.',
    )
  }

  try {
    const merged = await mergeWalletPlayerIntoTelegramPlayer(database, {
      telegramPlayerId: input.currentPlayerId,
      walletPlayerId: input.existingWallet.playerId,
      now: input.now,
    })
    return merged.playerId
  } catch (error) {
    if (error instanceof IdentityMergeConflictError) throw new AppWalletAuthError(error.message)
    throw error
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
