import { createHash, randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { createAppSession } from './app-session-service'
import { normalizeNimiqAddress, verifyNimiqWalletSignature } from './wallet-link-service'

const APP_WALLET_CHALLENGE_TTL_MS = 5 * 60_000

export class AppWalletAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppWalletAuthError'
  }
}

export class AppWalletAuthService {
  constructor(private readonly database: RallyoDatabase) {}

  async beginChallenge(input: { readonly address: string; readonly now?: Date }) {
    const now = input.now ?? new Date()
    let address: string
    try {
      address = normalizeNimiqAddress(input.address)
    } catch {
      throw new AppWalletAuthError('Invalid Nimiq address.')
    }

    const nonce = randomBytes(32).toString('hex')
    const message = `Rallyo wallet sign in\nAddress: ${address}\nNonce: ${nonce}`
    const expiresAt = new Date(now.getTime() + APP_WALLET_CHALLENGE_TTL_MS)
    const [challenge] = await this.database
      .insert(schema.appWalletChallenges)
      .values({
        address,
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
      if (
        !verifyNimiqWalletSignature({
          message: input.message,
          messageHash: challenge.messageHash,
          publicKeyHex: input.publicKey,
          signatureHex: input.signature,
          expectedAddress: challenge.address,
        })
      ) {
        throw new AppWalletAuthError('Wallet signature verification failed.')
      }

      const [existingWallet] = await tx
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, challenge.address))
        .for('update')

      let playerId: string
      if (existingWallet) {
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
            address: challenge.address,
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
            .where(eq(schema.walletIdentities.address, challenge.address))
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

      const session = await createAppSession(tx, { playerId, now })
      await tx
        .update(schema.appWalletChallenges)
        .set({ consumedAt: now })
        .where(eq(schema.appWalletChallenges.id, challenge.id))
      return { playerId, ...session }
    })
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
