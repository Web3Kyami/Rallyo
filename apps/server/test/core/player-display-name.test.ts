import { describe, expect, it } from 'vitest'

import {
  FALLBACK_PLAYER_NAME,
  resolvePlayerDisplayName,
  validatePlayerNickname,
} from '../../src/core/player-display-name'

describe('canonical Player display names', () => {
  it('prefers Telegram, then persistent nickname, then the safe fallback', () => {
    expect(resolvePlayerDisplayName('Telegram Alice', 'Wallet Alice')).toBe('Telegram Alice')
    expect(resolvePlayerDisplayName(null, 'Wallet Alice')).toBe('Wallet Alice')
    expect(resolvePlayerDisplayName(null, null)).toBe(FALLBACK_PLAYER_NAME)
  })

  it('normalizes valid nicknames and rejects control, markup-like, and oversized names', () => {
    expect(validatePlayerNickname('  Kyami  ')).toBe('Kyami')
    expect(validatePlayerNickname('東京プレイヤー')).toBe('東京プレイヤー')
    for (const value of ['x', 'x'.repeat(33), '<b>Alice</b>', 'Alice\nBob', '\u200bAlice']) {
      expect(() => validatePlayerNickname(value)).toThrow()
    }
  })
})
