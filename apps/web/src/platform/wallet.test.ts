import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chooseAddress: vi.fn(),
  signMessage: vi.fn(),
  walletChallenge: vi.fn(),
  walletComplete: vi.fn(),
  detectEnvironment: vi.fn(),
  init: vi.fn(),
}))

vi.mock('@nimiq/hub-api', () => ({
  default: class MockHubApi {
    chooseAddress = mocks.chooseAddress
    signMessage = mocks.signMessage
  },
}))

vi.mock('@nimiq/mini-app-sdk', () => ({
  getHostLanguage: vi.fn(() => 'en'),
  init: mocks.init,
}))

vi.mock('../api/client', () => ({
  api: {
    walletChallenge: mocks.walletChallenge,
    walletComplete: mocks.walletComplete,
  },
}))

vi.mock('./environment', () => ({
  detectEnvironment: mocks.detectEnvironment,
}))

import { prepareNimiqAuthentication } from './wallet'

describe('browser Nimiq authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectEnvironment.mockReturnValue({ host: 'browser' })
    mocks.chooseAddress.mockResolvedValue({ address: 'NQ12 TEST ADDRESS' })
    mocks.walletChallenge.mockResolvedValue({
      challengeId: 'challenge-1',
      message: 'Rallyo wallet sign in\nNonce: test',
      expiresAt: '2026-09-21T12:05:00.000Z',
    })
    mocks.signMessage.mockResolvedValue({
      signer: 'NQ12 TEST ADDRESS',
      signerPublicKey: new Uint8Array([0xab, 0xcd]),
      signature: new Uint8Array([0x01, 0x02]),
    })
    mocks.walletComplete.mockResolvedValue({ redirectPath: '/app' })
  })

  it('waits for the explicit confirmation before opening the Hub signature request', async () => {
    const prepared = await prepareNimiqAuthentication()

    expect(prepared.requiresConfirmation).toBe(true)
    expect(mocks.chooseAddress).toHaveBeenCalledOnce()
    expect(mocks.chooseAddress).toHaveBeenCalledWith({
      appName: 'Rallyo',
      disableContracts: true,
    })
    expect(mocks.walletChallenge).toHaveBeenCalledWith({
      address: 'NQ12 TEST ADDRESS',
      format: 'hub',
    })
    expect(mocks.signMessage).not.toHaveBeenCalled()

    await prepared.confirm()

    expect(mocks.signMessage).toHaveBeenCalledWith({
      appName: 'Rallyo',
      signer: 'NQ12 TEST ADDRESS',
      message: 'Rallyo wallet sign in\nNonce: test',
    })
    expect(mocks.walletComplete).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      message: 'Rallyo wallet sign in\nNonce: test',
      publicKey: 'abcd',
      signature: '0102',
      signer: 'NQ12 TEST ADDRESS',
      format: 'hub',
    })
  })

  it('propagates a cancelled account selection', async () => {
    mocks.chooseAddress.mockRejectedValue(new Error('User cancelled chooseAddress'))

    await expect(prepareNimiqAuthentication()).rejects.toThrow('User cancelled chooseAddress')
    expect(mocks.walletChallenge).not.toHaveBeenCalled()
  })

  it('propagates a cancelled signature request from the confirmation action', async () => {
    mocks.signMessage.mockRejectedValue(new Error('User cancelled signMessage'))
    const prepared = await prepareNimiqAuthentication()

    await expect(prepared.confirm()).rejects.toThrow('User cancelled signMessage')
    expect(mocks.walletComplete).not.toHaveBeenCalled()
  })

  it('does not submit when Hub returns a different signer', async () => {
    mocks.signMessage.mockResolvedValue({
      signer: 'NQ99 DIFFERENT ADDRESS',
      signerPublicKey: new Uint8Array([0xab, 0xcd]),
      signature: new Uint8Array([0x01, 0x02]),
    })
    const prepared = await prepareNimiqAuthentication()

    await expect(prepared.confirm()).rejects.toThrow(
      'Nimiq returned a different account. Restart the connection.',
    )
    expect(mocks.walletComplete).not.toHaveBeenCalled()
  })

  it('uses the signing key rather than an exposed account position in Nimiq Pay', async () => {
    mocks.detectEnvironment.mockReturnValue({ host: 'nimiq-pay' })
    const listAccounts = vi
      .fn()
      .mockResolvedValue(['NQ12 FIRST EXPOSED ACCOUNT', 'NQ34 SIGNING ACCOUNT'])
    const sign = vi.fn().mockResolvedValue({
      publicKey: 'abcd',
      signature: '0102',
    })
    mocks.init.mockResolvedValue({ listAccounts, sign })

    const prepared = await prepareNimiqAuthentication()
    expect(prepared.requiresConfirmation).toBe(true)
    expect(mocks.walletChallenge).toHaveBeenCalledWith({ format: 'mini-app' })
    expect(sign).not.toHaveBeenCalled()
    await prepared.confirm()

    expect(listAccounts).toHaveBeenCalledOnce()
    expect(sign).toHaveBeenCalledWith('Rallyo wallet sign in\nNonce: test')
    expect(mocks.chooseAddress).not.toHaveBeenCalled()
    expect(mocks.walletComplete).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      message: 'Rallyo wallet sign in\nNonce: test',
      publicKey: 'abcd',
      signature: '0102',
      format: 'mini-app',
    })
  })

  it('handles a cancelled Nimiq Pay account request response', async () => {
    mocks.detectEnvironment.mockReturnValue({ host: 'nimiq-pay' })
    mocks.init.mockResolvedValue({
      listAccounts: vi.fn().mockResolvedValue({
        error: { type: 'PERMISSION_DENIED', message: 'User cancelled' },
      }),
    })

    await expect(prepareNimiqAuthentication()).rejects.toThrow('Nimiq Pay request was cancelled.')
    expect(mocks.walletChallenge).not.toHaveBeenCalled()
  })

  it('reports when Nimiq Pay shares no account', async () => {
    mocks.detectEnvironment.mockReturnValue({ host: 'nimiq-pay' })
    mocks.init.mockResolvedValue({ listAccounts: vi.fn().mockResolvedValue([]) })

    await expect(prepareNimiqAuthentication()).rejects.toThrow(
      'Nimiq Pay did not share an account.',
    )
    expect(mocks.walletChallenge).not.toHaveBeenCalled()
  })

  it('handles a cancelled Nimiq Pay signing response without completing authentication', async () => {
    mocks.detectEnvironment.mockReturnValue({ host: 'nimiq-pay' })
    const sign = vi.fn().mockResolvedValue({
      error: { type: 'PERMISSION_DENIED', message: 'User cancelled' },
    })
    mocks.init.mockResolvedValue({
      listAccounts: vi.fn().mockResolvedValue(['NQ12 MINI APP ADDRESS']),
      sign,
    })

    const prepared = await prepareNimiqAuthentication()
    await expect(prepared.confirm()).rejects.toThrow('Nimiq Pay request was cancelled.')
    expect(mocks.walletComplete).not.toHaveBeenCalled()
  })

  it('reports an unavailable Nimiq Pay provider', async () => {
    mocks.detectEnvironment.mockReturnValue({ host: 'nimiq-pay' })
    mocks.init.mockRejectedValue(new Error('provider timeout'))

    await expect(prepareNimiqAuthentication()).rejects.toThrow('Nimiq Pay is unavailable.')
  })
})
