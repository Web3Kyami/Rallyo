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
    return { requiresConfirmation: false, confirm: authenticateInNimiqPay }
  }

  const hub = new HubApi(HUB_ENDPOINT)
  const selected = (await hub.chooseAddress({ appName: 'Rallyo' })) as { readonly address: string }
  const challenge = await api.walletChallenge(selected.address)

  return {
    requiresConfirmation: true,
    confirm: async () => {
      const signed = await hub.signMessage({
        appName: 'Rallyo',
        signer: selected.address,
        message: challenge.message,
      })

      return api.walletComplete({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: bytesToHex(signed.signerPublicKey),
        signature: bytesToHex(signed.signature),
        format: 'hub',
      })
    },
  }
}

export async function authenticateWithNimiq(): Promise<{ readonly redirectPath: string }> {
  const prepared = await prepareNimiqAuthentication()
  return prepared.confirm()
}

async function authenticateInNimiqPay(): Promise<{ readonly redirectPath: string }> {
  const provider = await init({ timeout: 10_000 })
  await provider.connect()
  const accounts = await provider.listAccounts()
  if (!Array.isArray(accounts) || accounts.length === 0 || !accounts[0]) {
    throw new Error('No Nimiq account is available in this wallet.')
  }

  const challenge = await api.walletChallenge(accounts[0])
  const signed = await provider.sign(challenge.message)
  if ('error' in signed) throw new Error(signed.error.message)

  return api.walletComplete({
    challengeId: challenge.challengeId,
    message: challenge.message,
    publicKey: signed.publicKey,
    signature: signed.signature,
    format: 'mini-app',
  })
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
