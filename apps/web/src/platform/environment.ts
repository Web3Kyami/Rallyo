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

  return {
    host: language !== 'en' || isEmbeddedMiniApp() ? 'nimiq-pay' : 'browser',
    language,
    isWalletProviderAvailable: language !== 'en' || isEmbeddedMiniApp(),
  }
}

function isEmbeddedMiniApp(): boolean {
  return window.parent !== window
}
