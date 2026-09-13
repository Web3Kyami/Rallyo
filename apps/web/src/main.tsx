import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { getHostLanguage, init } from '@nimiq/mini-app-sdk'

function Bootstrap() {
  const [status, setStatus] = useState('Ready to link a Nimiq wallet.')
  const [address, setAddress] = useState<string | null>(null)
  const code = new URLSearchParams(window.location.search).get('link')
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? window.location.origin

  async function linkWallet() {
    if (!code) {
      setStatus('Open Player HQ from the Telegram link code.')
      return
    }
    try {
      setStatus('Connecting to Nimiq Pay…')
      const nimiq = await init({ timeout: 10_000 })
      const accounts = await nimiq.listAccounts()
      if (!Array.isArray(accounts) || accounts.length === 0)
        throw new Error('No Nimiq account was shared.')
      const selectedAddress = accounts[0]
      if (!selectedAddress) throw new Error('No Nimiq account was shared.')
      setAddress(selectedAddress)
      const challengeResponse = await fetch(`${apiBase}/api/wallet/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, address: selectedAddress }),
      })
      const challenge = (await challengeResponse.json()) as {
        challengeId?: string
        message?: string
        error?: string
      }
      if (!challengeResponse.ok || !challenge.challengeId || !challenge.message)
        throw new Error(challenge.error ?? 'Challenge failed.')
      setStatus('Approve the signing request in Nimiq Pay…')
      const signed = await nimiq.sign(challenge.message)
      if (!('publicKey' in signed) || !('signature' in signed))
        throw new Error('Nimiq signature was not returned.')
      const completeResponse = await fetch(`${apiBase}/api/wallet/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          message: challenge.message,
          ...signed,
        }),
      })
      const completed = (await completeResponse.json()) as { error?: string }
      if (!completeResponse.ok) throw new Error(completed.error ?? 'Wallet link failed.')
      setStatus('Wallet linked. You can return to Telegram.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Wallet link failed.')
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <p style={{ opacity: 0.65 }}>{getHostLanguage() ?? 'en'}</p>
      <h1>Rallyo Player HQ</h1>
      <p>Wallet identity link (functional scaffolding; visual polish is pending).</p>
      {address && <p>Selected address: {address}</p>}
      <button
        type="button"
        onClick={() => void linkWallet()}
        style={{ minHeight: 44, padding: '0 18px' }}
      >
        Link Nimiq wallet
      </button>
      <p role="status">{status}</p>
    </main>
  )
}

const root = document.getElementById('root')

if (!root) {
  throw new Error('Rallyo web root is missing.')
}

createRoot(root).render(<Bootstrap />)
