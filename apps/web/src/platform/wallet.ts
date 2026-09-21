import HubApi from '@nimiq/hub-api'
import { init } from '@nimiq/mini-app-sdk'

import { api } from '../api/client'
import { detectEnvironment } from './environment'

const HUB_ENDPOINT =
  typeof import.meta.env.VITE_NIMIQ_HUB_URL === 'string'
    ? import.meta.env.VITE_NIMIQ_HUB_URL
    : 'https://hub.nimiq.com'

export type PreparedNimiqAuthentication = {
  readonly requiresConfirmation: boolean
  readonly confirm: () => Promise<{ readonly redirectPath: string }>
}

export async function prepareNimiqAuthentication(): Promise<PreparedNimiqAuthentication> {
  if (detectEnvironment().host === 'nimiq-pay') {
    return prepareNimiqPayAuthentication()
  }

  const hub = new HubApi(HUB_ENDPOINT)
  const selected = (await hub.chooseAddress({
    appName: 'Rallyo',
    disableContracts: true,
  })) as { readonly address: string }
  const challenge = await api.walletChallenge({ address: selected.address, format: 'hub' })

  return {
    requiresConfirmation: true,
    confirm: async () => {
      const signed = await hub.signMessage({
        appName: 'Rallyo',
        signer: selected.address,
        message: challenge.message,
      })
      if (
        typeof signed.signer !== 'string' ||
        normalizeAddressForComparison(signed.signer) !==
          normalizeAddressForComparison(selected.address)
      ) {
        throw new Error('Nimiq returned a different account. Restart the connection.')
      }

      return api.walletComplete({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: bytesToHex(signed.signerPublicKey),
        signature: bytesToHex(signed.signature),
        signer: signed.signer,
        format: 'hub',
      })
    },
  }
}

export async function authenticateWithNimiq(): Promise<{ readonly redirectPath: string }> {
  const prepared = await prepareNimiqAuthentication()
  return prepared.confirm()
}

async function prepareNimiqPayAuthentication(): Promise<PreparedNimiqAuthentication> {
  let provider: Awaited<ReturnType<typeof init>>
  try {
    provider = await init({ timeout: 10_000 })
  } catch {
    throw new Error('Nimiq Pay is unavailable. Open Rallyo inside Nimiq Pay and try again.')
  }

  const accounts = await provider.listAccounts()
  ensureNimiqPaySuccess(accounts, 'accounts')
  if (!Array.isArray(accounts) || accounts.length === 0 || !accounts.some(isNimiqAddress)) {
    throw new Error('Nimiq Pay did not share an account.')
  }

  const challenge = await api.walletChallenge({ format: 'mini-app' })
  return {
    requiresConfirmation: true,
    confirm: async () => {
      const signed = await provider.sign(challenge.message)
      ensureNimiqPaySuccess(signed, 'signature')
      if (!isNimiqSignature(signed)) throw new Error('Nimiq Pay could not sign the request.')

      return api.walletComplete({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: signed.publicKey,
        signature: signed.signature,
        format: 'mini-app',
      })
    },
  }
}

function ensureNimiqPaySuccess(value: unknown, action: 'accounts' | 'signature'): void {
  if (!isNimiqPayError(value)) return
  const error = `${value.error.type} ${value.error.message}`.toLowerCase()
  if (error.includes('permission') || error.includes('cancel') || error.includes('reject')) {
    throw new Error('Nimiq Pay request was cancelled.')
  }
  throw new Error(
    action === 'accounts'
      ? 'Nimiq Pay did not share an account.'
      : 'Nimiq Pay could not sign the request.',
  )
}

function isNimiqPayError(
  value: unknown,
): value is { readonly error: { readonly type: string; readonly message: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'type' in value.error &&
    'message' in value.error &&
    typeof value.error.type === 'string' &&
    typeof value.error.message === 'string'
  )
}

function isNimiqAddress(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNimiqSignature(
  value: unknown,
): value is { readonly publicKey: string; readonly signature: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'publicKey' in value &&
    'signature' in value &&
    typeof value.publicKey === 'string' &&
    value.publicKey.length > 0 &&
    typeof value.signature === 'string' &&
    value.signature.length > 0
  )
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeAddressForComparison(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}
