import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { KeyPair } from '@nimiq/core'
import { eq, sql } from 'drizzle-orm'

import { AppApiForbiddenError, AppApiService } from '../../src/core/app-api-service'
import { AppWalletAuthService } from '../../src/core/app-wallet-auth-service'
import { AppSessionError, AppSessionService } from '../../src/core/app-session-service'
import {
  nimiqSignedMessageHash,
  WalletLinkError,
  WalletLinkService,
} from '../../src/core/wallet-link-service'
import { createDatabase } from '../../src/db/client'
import * as schema from '../../src/db/schema'

const databaseUrl = process.env.DATABASE_URL
const describeDatabase = databaseUrl ? describe : describe.skip

describeDatabase('Phase 8 identity amendment against PostgreSQL', () => {
  if (!databaseUrl) return

  const { db, close } = createDatabase(databaseUrl)
  const appSessions = new AppSessionService(db)
  const walletAuth = new AppWalletAuthService(db)
  const walletLinks = new WalletLinkService(db)
  const appApi = new AppApiService(db)
  const now = new Date('2026-09-15T10:00:00.000Z')
  const ids = {
    telegramPlayer: '60000000-0000-4000-8000-000000000001',
    walletPlayer: '60000000-0000-4000-8000-000000000002',
    secondTelegramPlayer: '60000000-0000-4000-8000-000000000003',
    thirdPlayer: '60000000-0000-4000-8000-000000000004',
    telegramIdentity: '60000000-0000-4000-8000-000000000011',
    secondTelegramIdentity: '60000000-0000-4000-8000-000000000012',
    communityOne: '60000000-0000-4000-8000-000000000021',
    communityTwo: '60000000-0000-4000-8000-000000000022',
    seasonOne: '60000000-0000-4000-8000-000000000031',
    task: '60000000-0000-4000-8000-000000000041',
    round: '60000000-0000-4000-8000-000000000051',
    question: '60000000-0000-4000-8000-000000000061',
  } as const
  const walletKeyPair = KeyPair.generate()
  const walletAddress = walletKeyPair.toAddress().toUserFriendlyAddress()

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE players, communities, telegram_updates CASCADE`)
    await db
      .insert(schema.players)
      .values([
        { id: ids.telegramPlayer },
        { id: ids.walletPlayer },
        { id: ids.secondTelegramPlayer },
        { id: ids.thirdPlayer },
      ])
    await db.insert(schema.telegramIdentities).values([
      {
        id: ids.telegramIdentity,
        playerId: ids.telegramPlayer,
        telegramUserId: 6001n,
        displayName: 'Telegram canonical',
        username: 'canonical',
      },
      {
        id: ids.secondTelegramIdentity,
        playerId: ids.secondTelegramPlayer,
        telegramUserId: 6002n,
        displayName: 'Second Telegram',
        username: 'second',
      },
    ])
    await db.insert(schema.walletIdentities).values({
      playerId: ids.walletPlayer,
      address: walletAddress,
      publicKey: walletKeyPair.publicKey.toHex(),
    })
    await db.insert(schema.communities).values([
      {
        id: ids.communityOne,
        telegramChatId: 6101n,
        title: 'History community',
        slug: 'history-community',
      },
      {
        id: ids.communityTwo,
        telegramChatId: 6102n,
        title: 'Admin community',
        slug: 'admin-community',
      },
    ])
    await db.insert(schema.seasons).values({
      id: ids.seasonOne,
      communityId: ids.communityOne,
      name: 'Identity season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      status: 'ACTIVE',
    })
    await db.insert(schema.communityAdmins).values({
      communityId: ids.communityTwo,
      telegramUserId: 6001n,
      verifiedAt: now,
      lastVerifiedAt: now,
    })
  })

  afterAll(async () => close())

  it('creates a normal wallet-only session for a new wallet-origin Player', async () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const challenge = await walletAuth.beginChallenge({ address, now })
    const signature = keyPair.sign(nimiqSignedMessageHash(challenge.message))

    const completed = await walletAuth.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
      now,
    })
    const actor = await appSessions.getSession(completed.token, now)

    expect(actor).toMatchObject({
      playerId: completed.playerId,
      telegramIdentityId: null,
      telegramUserId: null,
      targetMode: 'player',
    })
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, address)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.playerId, completed.playerId)),
    ).toHaveLength(0)
    expect((await db.select().from(schema.appWalletChallenges))[0]?.consumedAt).not.toBeNull()
  })

  it('creates the same canonical browser session from a Hub signed message', async () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const challenge = await walletAuth.beginChallenge({ address, now })
    const signature = keyPair.sign(nimiqSignedMessageHash(challenge.message))

    const completed = await walletAuth.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
      signer: address,
      format: 'hub',
      now,
    })

    expect(await appSessions.getSession(completed.token, now)).toMatchObject({
      playerId: completed.playerId,
      telegramIdentityId: null,
      targetMode: 'player',
    })
  })

  it('authenticates an already linked wallet without creating another Player', async () => {
    const challenge = await walletAuth.beginChallenge({ address: walletAddress, now })
    const signature = walletKeyPair.sign(nimiqSignedMessageHash(challenge.message))
    const completed = await walletAuth.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: walletKeyPair.publicKey.toHex(),
      signature: signature.toHex(),
      now,
    })

    expect(completed.playerId).toBe(ids.walletPlayer)
    expect(await db.select().from(schema.players)).toHaveLength(4)
    expect(await appSessions.getSession(completed.token, now)).toMatchObject({
      playerId: ids.walletPlayer,
      telegramIdentityId: null,
    })
  })

  it('attaches a new wallet to the authenticated Telegram Player without creating another Player', async () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const challenge = await walletAuth.beginChallenge({ address, now })
    const signature = keyPair.sign(nimiqSignedMessageHash(challenge.message))

    const completed = await walletAuth.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
      authenticatedSession: actor,
      now,
    })

    expect(completed.playerId).toBe(ids.telegramPlayer)
    expect(await db.select().from(schema.players)).toHaveLength(4)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, address)),
    ).toMatchObject([{ playerId: ids.telegramPlayer }])
    expect(await appSessions.getSession(current.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
    })
    expect(await appSessions.getSession(completed.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
    })
  })

  it('repairs a safe wallet-only duplicate when its owner reconnects from Telegram', async () => {
    await db.insert(schema.scoreEvents).values({
      playerId: ids.walletPlayer,
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      sourceType: 'QUIZ',
      sourceId: 'quiz:wallet-duplicate',
      delta: 9,
      reason: 'wallet duplicate history',
      idempotencyKey: 'score:wallet-duplicate',
    })
    const duplicateSession = await appSessions.createSession({ playerId: ids.walletPlayer, now })
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const challenge = await walletAuth.beginChallenge({ address: walletAddress, now })
    const signature = walletKeyPair.sign(nimiqSignedMessageHash(challenge.message))

    const completed = await walletAuth.completeChallenge({
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: walletKeyPair.publicKey.toHex(),
      signature: signature.toHex(),
      authenticatedSession: actor,
      now,
    })

    expect(completed.playerId).toBe(ids.telegramPlayer)
    expect(await db.select().from(schema.players)).toHaveLength(3)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, walletAddress)),
    ).toMatchObject([{ playerId: ids.telegramPlayer }])
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.idempotencyKey, 'score:wallet-duplicate')),
    ).toMatchObject([{ playerId: ids.telegramPlayer }])
    expect(await appSessions.getSession(duplicateSession.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
    })
    expect(await appSessions.getSession(current.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
    })

    const walletLogin = await walletAuth.beginChallenge({ address: walletAddress, now })
    const walletSignature = walletKeyPair.sign(nimiqSignedMessageHash(walletLogin.message))
    const walletCompleted = await walletAuth.completeChallenge({
      challengeId: walletLogin.challengeId,
      message: walletLogin.message,
      publicKey: walletKeyPair.publicKey.toHex(),
      signature: walletSignature.toHex(),
      now,
    })
    expect(walletCompleted.playerId).toBe(ids.telegramPlayer)
  })

  it('keeps reconnecting the same wallet idempotent for the current Telegram Player', async () => {
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const first = await walletAuth.beginChallenge({ address: walletAddress, now })
    const firstSignature = walletKeyPair.sign(nimiqSignedMessageHash(first.message))
    await walletAuth.completeChallenge({
      challengeId: first.challengeId,
      message: first.message,
      publicKey: walletKeyPair.publicKey.toHex(),
      signature: firstSignature.toHex(),
      authenticatedSession: actor,
      now,
    })
    const second = await walletAuth.beginChallenge({ address: walletAddress, now })
    const secondSignature = walletKeyPair.sign(nimiqSignedMessageHash(second.message))
    const completed = await walletAuth.completeChallenge({
      challengeId: second.challengeId,
      message: second.message,
      publicKey: walletKeyPair.publicKey.toHex(),
      signature: secondSignature.toHex(),
      authenticatedSession: actor,
      now,
    })

    expect(completed.playerId).toBe(ids.telegramPlayer)
    expect(await db.select().from(schema.players)).toHaveLength(3)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, walletAddress)),
    ).toHaveLength(1)
  })

  it('does not replace a Telegram Player wallet or merge a conflicting Telegram identity', async () => {
    const secondWallet = KeyPair.generate()
    await db.insert(schema.walletIdentities).values({
      playerId: ids.telegramPlayer,
      address: secondWallet.toAddress().toUserFriendlyAddress(),
      publicKey: secondWallet.publicKey.toHex(),
    })
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const challenge = await walletAuth.beginChallenge({ address: walletAddress, now })
    const signature = walletKeyPair.sign(nimiqSignedMessageHash(challenge.message))

    await expect(
      walletAuth.completeChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: walletKeyPair.publicKey.toHex(),
        signature: signature.toHex(),
        authenticatedSession: actor,
        now,
      }),
    ).rejects.toThrow('different active wallet')
    expect(await appSessions.getSession(current.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
    })
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, walletAddress)),
    ).toMatchObject([{ playerId: ids.walletPlayer }])
  })

  it('does not auto-merge a wallet Player that already owns another Telegram identity', async () => {
    await db.insert(schema.telegramIdentities).values({
      playerId: ids.walletPlayer,
      telegramUserId: 6003n,
      displayName: 'Conflicting wallet Telegram',
      username: 'wallet-conflict',
    })
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const challenge = await walletAuth.beginChallenge({ address: walletAddress, now })
    const signature = walletKeyPair.sign(nimiqSignedMessageHash(challenge.message))

    await expect(
      walletAuth.completeChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: walletKeyPair.publicKey.toHex(),
        signature: signature.toHex(),
        authenticatedSession: actor,
        now,
      }),
    ).rejects.toThrow('already has a Telegram identity')
    expect(await db.select().from(schema.players)).toHaveLength(4)
    expect(await appSessions.getSession(current.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
    })
  })

  it('preserves revoked-wallet recovery and consumes no conflicting session state', async () => {
    await db
      .update(schema.walletIdentities)
      .set({ revokedAt: now })
      .where(eq(schema.walletIdentities.address, walletAddress))
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const challenge = await walletAuth.beginChallenge({ address: walletAddress, now })
    const signature = walletKeyPair.sign(nimiqSignedMessageHash(challenge.message))

    await expect(
      walletAuth.completeChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: walletKeyPair.publicKey.toHex(),
        signature: signature.toHex(),
        authenticatedSession: actor,
        now,
      }),
    ).rejects.toThrow('operator-assisted recovery')
    expect(await appSessions.getSession(current.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
    })
    expect(
      (await db.select().from(schema.appWalletChallenges)).find(
        (row) => row.id === challenge.challengeId,
      )?.consumedAt,
    ).toBeNull()
  })

  it('keeps a wallet challenge one-time under concurrent completion retries', async () => {
    const keyPair = KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const current = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const actor = await appSessions.getSession(current.token, now)
    if (!actor) throw new Error('Telegram session fixture was not created.')
    const challenge = await walletAuth.beginChallenge({ address, now })
    const signature = keyPair.sign(nimiqSignedMessageHash(challenge.message))
    const input = {
      challengeId: challenge.challengeId,
      message: challenge.message,
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
      authenticatedSession: actor,
      now,
    }

    const results = await Promise.allSettled([
      walletAuth.completeChallenge(input),
      walletAuth.completeChallenge(input),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.address, address)),
    ).toMatchObject([{ playerId: ids.telegramPlayer }])
  })

  it('reconciles a wallet-origin Player into the existing Telegram Player without duplicate history', async () => {
    await db.insert(schema.socialTasks).values({
      id: ids.task,
      communityId: ids.communityOne,
      title: 'Identity task',
      instructions: 'Submit proof.',
      points: 5,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      createdByTelegramUserId: 6001n,
    })
    await db.insert(schema.socialTaskSubmissions).values([
      {
        taskId: ids.task,
        playerId: ids.telegramPlayer,
        reference: 'https://example.com/proof',
        status: 'APPROVED',
      },
      {
        taskId: ids.task,
        playerId: ids.walletPlayer,
        reference: 'https://example.com/proof',
      },
    ])
    await db.insert(schema.scoreEvents).values([
      {
        playerId: ids.telegramPlayer,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'QUIZ',
        sourceId: 'quiz:canonical',
        delta: 10,
        reason: 'canonical score',
        idempotencyKey: 'score:canonical',
      },
      {
        playerId: ids.walletPlayer,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'SOCIAL_TASK',
        sourceId: ids.task,
        delta: 5,
        reason: 'wallet-origin score',
        idempotencyKey: 'score:wallet-origin',
      },
    ])
    await db.insert(schema.rewardEntitlements).values([
      {
        seasonId: ids.seasonOne,
        playerId: ids.telegramPlayer,
        rank: 1,
        amountLuna: 100n,
        status: 'ELIGIBLE',
        idempotencyKey: 'reward:canonical',
      },
      {
        seasonId: ids.seasonOne,
        playerId: ids.walletPlayer,
        rank: 1,
        amountLuna: 100n,
        status: 'SENT',
        idempotencyKey: 'reward:wallet',
      },
    ])
    await db.insert(schema.communityActivityRollups).values({
      communityId: ids.communityOne,
      playerId: ids.walletPlayer,
      bucketStart: now,
      messageCount: 2,
      replyCount: 1,
    })

    const session = await appSessions.createSession({ playerId: ids.walletPlayer, now })
    const pairing = await appSessions.issueTelegramPairingCode({
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const result = await appSessions.pairTelegram({
      sessionToken: session.token,
      code: pairing.code,
      now,
    })

    expect(result.playerId).toBe(ids.telegramPlayer)
    expect(await db.select().from(schema.players)).toHaveLength(3)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.playerId, ids.telegramPlayer)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.playerId, ids.walletPlayer)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.telegramIdentities)
        .where(eq(schema.telegramIdentities.playerId, ids.telegramPlayer)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.playerId, ids.telegramPlayer)),
    ).toHaveLength(2)
    expect(
      await db
        .select()
        .from(schema.scoreEvents)
        .where(eq(schema.scoreEvents.playerId, ids.walletPlayer)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.socialTaskSubmissions)
        .where(eq(schema.socialTaskSubmissions.playerId, ids.telegramPlayer)),
    ).toHaveLength(1)
    expect(await db.select().from(schema.socialTaskSubmissions)).toHaveLength(1)
    expect(await db.select().from(schema.rewardEntitlements)).toMatchObject([
      expect.objectContaining({ playerId: ids.telegramPlayer, status: 'SENT' }),
    ])
    expect(await db.select().from(schema.rewardEntitlements)).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.communityActivityRollups)
        .where(eq(schema.communityActivityRollups.playerId, ids.telegramPlayer)),
    ).toHaveLength(1)
    expect((await db.select().from(schema.telegramPairingCodes))[0]?.consumedAt).not.toBeNull()
    expect(await appSessions.getSession(session.token, now)).toMatchObject({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      telegramUserId: 6001n,
    })
    await expect(
      appSessions.pairTelegram({ sessionToken: session.token, code: pairing.code, now }),
    ).rejects.toBeInstanceOf(AppSessionError)
  })

  it('rejects expired and replayed Telegram codes', async () => {
    const session = await appSessions.createSession({ playerId: ids.walletPlayer, now })
    const expired = await appSessions.issueTelegramPairingCode({
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    await expect(
      appSessions.pairTelegram({
        sessionToken: session.token,
        code: expired.code,
        now: new Date(now.getTime() + 10 * 60_000 + 1),
      }),
    ).rejects.toThrow('invalid or expired')

    const valid = await appSessions.issueTelegramPairingCode({
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    await appSessions.pairTelegram({ sessionToken: session.token, code: valid.code, now })
    await expect(
      appSessions.pairTelegram({ sessionToken: session.token, code: valid.code, now }),
    ).rejects.toThrow('invalid or expired')
  })

  it('rejects duplicate wallet attachment and duplicate Telegram ownership', async () => {
    const secondWalletLink = await walletLinks.issueCode({
      telegramIdentityId: ids.secondTelegramIdentity,
      now,
    })
    const challenge = await walletLinks.beginChallenge({
      code: secondWalletLink.code,
      address: walletAddress,
      now,
    })
    const signature = walletKeyPair.sign(nimiqSignedMessageHash(challenge.message))
    await expect(
      walletLinks.completeChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: walletKeyPair.publicKey.toHex(),
        signature: signature.toHex(),
        now,
      }),
    ).rejects.toBeInstanceOf(WalletLinkError)

    const telegramSession = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const secondPairing = await appSessions.issueTelegramPairingCode({
      telegramIdentityId: ids.secondTelegramIdentity,
      now,
    })
    await expect(
      appSessions.pairTelegram({
        sessionToken: telegramSession.token,
        code: secondPairing.code,
        now,
      }),
    ).rejects.toThrow('different Telegram identity')
    expect(
      (await db.select().from(schema.telegramPairingCodes)).find(
        (row) => row.id === secondPairing.id,
      )?.consumedAt,
    ).toBeNull()
    expect(await db.select().from(schema.players)).toHaveLength(4)
  })

  it('exposes server-derived admin communities and keeps access community-scoped', async () => {
    await db.insert(schema.scoreEvents).values({
      playerId: ids.telegramPlayer,
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      sourceType: 'QUIZ',
      sourceId: 'quiz:access',
      delta: 3,
      reason: 'access fixture',
      idempotencyKey: 'score:access',
    })
    await db.insert(schema.socialTasks).values({
      communityId: ids.communityTwo,
      title: 'Private admin task',
      instructions: 'Not visible outside the community.',
      points: 2,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 60 * 60_000),
      createdByTelegramUserId: 6001n,
    })
    await db.insert(schema.rewardEntitlements).values({
      seasonId: ids.seasonOne,
      playerId: ids.telegramPlayer,
      rank: 1,
      amountLuna: 100n,
      idempotencyKey: 'reward:app-api-context',
      status: 'ELIGIBLE',
    })
    const actor = {
      sessionId: '60000000-0000-4000-8000-000000000071',
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      telegramUserId: 6001n,
      targetCommunityId: null,
      targetMode: 'player' as const,
      expiresAt: new Date(now.getTime() + 60_000),
    }
    const bootstrap = await appApi.bootstrap(actor, now)
    expect(bootstrap.adminCommunities).toEqual([
      { id: ids.communityTwo, title: 'Admin community', telegramChatId: '6102' },
    ])
    expect(bootstrap.communities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ids.communityOne, isAdmin: false }),
        expect.objectContaining({ id: ids.communityTwo, isAdmin: true }),
      ]),
    )
    await expect(appApi.rewards(actor)).resolves.toEqual({
      wallet: { linked: false },
      entitlements: [
        expect.objectContaining({
          communityTitle: 'History community',
          seasonName: 'Identity season',
        }),
      ],
    })

    const walletActor = {
      ...actor,
      playerId: ids.walletPlayer,
      telegramIdentityId: null,
      telegramUserId: null,
    }
    await expect(appApi.community(walletActor, ids.communityTwo, now)).rejects.toBeInstanceOf(
      AppApiForbiddenError,
    )
    await expect(appApi.tasks(walletActor, undefined, now)).resolves.toEqual([])
  })

  it('rolls back all merge changes when a score-history conflict is ambiguous', async () => {
    await db.insert(schema.questions).values({
      id: ids.question,
      scope: 'GLOBAL',
      source: 'DEFAULT',
      mode: 'QUICK',
      category: 'Identity',
      difficulty: 'easy',
      prompt: 'What is Rallyo?',
      correctAnswer: 'Rallyo',
      acceptedAnswers: ['Rallyo'],
      basePoints: 1,
      fingerprint: 'identity-conflict-question',
      status: 'APPROVED',
    })
    await db.insert(schema.rounds).values({
      id: ids.round,
      communityId: ids.communityOne,
      seasonId: ids.seasonOne,
      questionId: ids.question,
      state: 'SCORED',
      startsAt: new Date(now.getTime() - 120_000),
      locksAt: new Date(now.getTime() - 60_000),
    })
    await db.insert(schema.scoreEvents).values([
      {
        playerId: ids.telegramPlayer,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'QUIZ',
        sourceId: 'quiz:canonical-conflict',
        roundId: ids.round,
        questionId: ids.question,
        delta: 5,
        reason: 'canonical conflict row',
        idempotencyKey: 'score:canonical-conflict',
      },
      {
        playerId: ids.thirdPlayer,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'QUIZ',
        sourceId: 'quiz:third-conflict',
        roundId: ids.round,
        questionId: ids.question,
        delta: 5,
        reason: 'third-party conflict row',
        idempotencyKey: 'score:third-conflict',
      },
      {
        playerId: ids.walletPlayer,
        communityId: ids.communityOne,
        seasonId: ids.seasonOne,
        sourceType: 'QUIZ',
        sourceId: 'quiz:wallet-conflict',
        roundId: ids.round,
        questionId: ids.question,
        delta: 5,
        reason: 'wallet conflict row',
        idempotencyKey: 'score:wallet-conflict',
      },
    ])
    await db.insert(schema.rewardEntitlements).values([
      {
        seasonId: ids.seasonOne,
        playerId: ids.telegramPlayer,
        rank: 1,
        amountLuna: 100n,
        status: 'ELIGIBLE',
        idempotencyKey: 'reward:canonical-conflict',
      },
      {
        seasonId: ids.seasonOne,
        playerId: ids.walletPlayer,
        rank: 2,
        amountLuna: 200n,
        status: 'ELIGIBLE',
        idempotencyKey: 'reward:wallet-conflict',
      },
    ])
    const session = await appSessions.createSession({ playerId: ids.walletPlayer, now })
    const pairing = await appSessions.issueTelegramPairingCode({
      telegramIdentityId: ids.telegramIdentity,
      now,
    })

    await expect(
      appSessions.pairTelegram({ sessionToken: session.token, code: pairing.code, now }),
    ).rejects.toThrow('Reward entitlement values conflict')
    expect(await db.select().from(schema.players)).toHaveLength(4)
    expect(
      await db
        .select()
        .from(schema.walletIdentities)
        .where(eq(schema.walletIdentities.playerId, ids.walletPlayer)),
    ).toHaveLength(1)
    expect(await appSessions.getSession(session.token, now)).toMatchObject({
      playerId: ids.walletPlayer,
      telegramIdentityId: null,
    })
    expect(
      (await db.select().from(schema.telegramPairingCodes)).find((row) => row.id === pairing.id)
        ?.consumedAt,
    ).toBeNull()
  })

  it('keeps a Telegram-connected session valid before wallet connection', async () => {
    const session = await appSessions.createSession({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    const pairing = await appSessions.issueTelegramPairingCode({
      telegramIdentityId: ids.telegramIdentity,
      now,
    })
    await appSessions.pairTelegram({ sessionToken: session.token, code: pairing.code, now })
    const actor = await appSessions.getSession(session.token, now)
    expect(actor).toMatchObject({
      playerId: ids.telegramPlayer,
      telegramIdentityId: ids.telegramIdentity,
      telegramUserId: 6001n,
    })
    const bootstrap = await appApi.bootstrap(actor!, now)
    expect(bootstrap.wallet).toEqual({ linked: false })
  })
})
