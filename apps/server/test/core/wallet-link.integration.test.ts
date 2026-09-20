import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { KeyPair, BufferUtils } from '@nimiq/core'
import { sql } from 'drizzle-orm'

import {
  nimiqHubSignedMessageHash,
  WalletLinkError,
  WalletLinkService,
} from '../../src/core/wallet-link-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('WalletLinkService against PostgreSQL', () => {
  if (!databaseUrl) return
  const { db, close } = createDatabase(databaseUrl)
  const service = new WalletLinkService(db)
  const playerId = '20000000-0000-4000-8000-000000000001'
  const identityId = '20000000-0000-4000-8000-000000000002'
  const now = new Date('2026-09-13T10:00:00.000Z')

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db.insert(schema.players).values({ id: playerId })
    await db.insert(schema.telegramIdentities).values({
      id: identityId,
      playerId,
      telegramUserId: 123456n,
      displayName: 'Wallet tester',
    })
  })

  afterAll(async () => close())

  it('issues a one-time code, verifies a real Nimiq signature, and rejects replay', async () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const issued = await service.issueCode({ telegramIdentityId: identityId, now })
    const challenge = await service.beginChallenge({ code: issued.code, address, now })
    const signature = keyPair.sign(BufferUtils.fromUtf8(challenge.message))

    const linked = await service.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
      now: new Date(now.getTime() + 1_000),
    })
    expect(linked.address).toBe(address)
    await expect(
      service.completeChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: keyPair.publicKey.toHex(),
        signature: signature.toHex(),
        now: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toBeInstanceOf(WalletLinkError)
    expect(await db.select().from(schema.walletIdentities)).toHaveLength(1)
    expect((await db.select().from(schema.walletLinkCodes))[0]?.consumedAt).not.toBeNull()
  })

  it('rejects a signature from a different key and leaves the challenge reusable', async () => {
    const signer = KeyPair.generate()
    const wrongSigner = KeyPair.generate()
    const issued = await service.issueCode({ telegramIdentityId: identityId, now })
    const challenge = await service.beginChallenge({
      code: issued.code,
      address: signer.toAddress().toUserFriendlyAddress(),
      now,
    })
    const wrongSignature = wrongSigner.sign(BufferUtils.fromUtf8(challenge.message))
    await expect(
      service.completeChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: wrongSigner.publicKey.toHex(),
        signature: wrongSignature.toHex(),
        now,
      }),
    ).rejects.toThrow('Wallet signature verification failed.')
    expect(await db.select().from(schema.walletIdentities)).toHaveLength(0)
  })

  it('verifies the official Hub signed-message hash and rejects a raw message signature', async () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const issued = await service.issueCode({ telegramIdentityId: identityId, now })
    const challenge = await service.beginChallenge({ code: issued.code, address, now })
    const hubSignature = keyPair.sign(nimiqHubSignedMessageHash(challenge.message))

    const linked = await service.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: keyPair.publicKey.toHex(),
      signature: hubSignature.toHex(),
      format: 'hub',
      now,
    })
    expect(linked.address).toBe(address)

    const secondIssued = await service.issueCode({ telegramIdentityId: identityId, now })
    const secondChallenge = await service.beginChallenge({ code: secondIssued.code, address, now })
    const rawSignature = keyPair.sign(BufferUtils.fromUtf8(secondChallenge.message))
    await expect(
      service.completeChallenge({
        challengeId: secondChallenge.challengeId,
        message: secondChallenge.message,
        publicKey: keyPair.publicKey.toHex(),
        signature: rawSignature.toHex(),
        format: 'hub',
        now,
      }),
    ).rejects.toThrow('Wallet signature verification failed.')
  })
})
