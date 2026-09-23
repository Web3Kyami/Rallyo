import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { AppBootstrap } from '../api/client'
import {
  PlayerHomePage,
  PlayerProfilePage,
  TelegramBotAccess,
  TelegramPairingHelpDialog,
} from './player-views'
import { SessionContext } from './session'

const bootstrap: AppBootstrap = {
  session: {
    targetMode: 'player',
    targetCommunityId: null,
    expiresAt: '2026-10-15T10:00:00.000Z',
  },
  player: { id: 'canonical-player', displayName: 'Alice', username: 'alice', nickname: null },
  telegram: {
    linked: true,
    identityId: 'telegram-alice',
    username: 'alice',
    displayName: 'Alice',
  },
  progression: {
    totalXp: 48,
    todayClaimed: true,
    nextEligibleAt: '2026-10-16T00:00:00.000Z',
    globalRank: 3,
  },
  wallet: { linked: true, address: 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234' },
  communities: [
    {
      id: 'community-one',
      title: 'Builders',
      slug: 'builders',
      status: 'ACTIVE',
      activeSeason: {
        id: 'season-one',
        name: 'Builders Sprint',
        endsAt: '2026-10-20T00:00:00.000Z',
      },
      points: 92,
      rank: 1,
      isAdmin: false,
    },
  ],
  adminCommunities: [],
  featureFlags: { walletLinking: true, globalLeague: true },
}

describe('player identity and Telegram pairing UI', () => {
  it('prompts a wallet-only Player for a persistent nickname and offers editing on You', () => {
    const walletOnly: AppBootstrap = {
      ...bootstrap,
      player: { id: 'wallet-player', displayName: 'Rallyo player', username: null, nickname: null },
      telegram: { linked: false },
      communities: [],
    }
    const session = {
      status: 'ready' as const,
      data: walletOnly,
      error: null,
      refresh: () => Promise.resolve(),
      logout: () => Promise.resolve(),
    }
    const home = renderToStaticMarkup(
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <PlayerHomePage />
        </SessionContext.Provider>
      </MemoryRouter>,
    )
    const profile = renderToStaticMarkup(
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <PlayerProfilePage />
        </SessionContext.Provider>
      </MemoryRouter>,
    )
    expect(home).toContain('What should Rallyo call you?')
    expect(home).toContain('Save nickname')
    expect(profile).toContain('Add a nickname')
  })

  it('renders the same connected Telegram, Nimiq, and community state after wallet linking', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SessionContext.Provider
          value={{
            status: 'ready',
            data: bootstrap,
            error: null,
            refresh: () => Promise.resolve(),
            logout: () => Promise.resolve(),
          }}
        >
          <PlayerProfilePage />
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    expect(markup).toContain('Telegram')
    expect(markup).toContain('Connected')
    expect(markup).toContain('Nimiq connected')
    expect(markup).toContain('Builders')
    expect(markup).not.toContain('Telegram not connected')
  })

  it('renders an explicit Telegram pairing guide with the official bot link', () => {
    const markup = renderToStaticMarkup(<TelegramPairingHelpDialog onClose={() => undefined} />)

    expect(markup).toContain('Open Rallyo Bot')
    expect(markup).toContain('Send /pair')
    expect(markup).toContain('https://t.me/Rallyo_gamebot')
    expect(markup).toContain('Copy bot link')
  })

  it('keeps the Telegram bot username and URL visible beside open and copy actions', () => {
    const markup = renderToStaticMarkup(<TelegramBotAccess />)

    expect(markup).toContain('https://t.me/Rallyo_gamebot')
    expect(markup).toContain('Open Rallyo Bot')
    expect(markup).toContain('Copy bot link')
  })
})
