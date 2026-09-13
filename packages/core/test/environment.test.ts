import { describe, expect, it } from 'vitest'

import { parseEnvironment } from '../src/environment'

describe('environment schema', () => {
  it('accepts a minimal local development environment', () => {
    expect(parseEnvironment({ NODE_ENV: 'development' })).toEqual({ NODE_ENV: 'development' })
  })

  it('rejects an invalid application URL', () => {
    expect(() => parseEnvironment({ APP_BASE_URL: 'not-a-url' })).toThrow()
  })

  it('accepts explicit Telegram polling or webhook transport', () => {
    expect(parseEnvironment({ TELEGRAM_TRANSPORT: 'polling' }).TELEGRAM_TRANSPORT).toBe('polling')
    expect(parseEnvironment({ TELEGRAM_TRANSPORT: 'webhook' }).TELEGRAM_TRANSPORT).toBe('webhook')
  })
})
