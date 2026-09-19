import { getHostLanguage } from '@nimiq/mini-app-sdk'

export type RallyoEnvironment = {
  readonly host: 'nimiq-pay' | 'browser'
  readonly language: string
  readonly isWalletProviderAvailable: boolean
}

export function detectEnvironment(): RallyoEnvironment {
  let language: string
  try {
    language = getHostLanguage() ?? 'en'
  } catch {
    language = 'en'
  }

  const hasNimiqPayHost = Boolean(window.nimiqPay || window.nimiq)
  return {
    host: hasNimiqPayHost ? 'nimiq-pay' : 'browser',
    language,
    isWalletProviderAvailable: hasNimiqPayHost,
  }
}
