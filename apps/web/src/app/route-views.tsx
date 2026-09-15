import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { init } from '@nimiq/mini-app-sdk'

import { api, ApiError } from '../api/client'
import {
  EmptyState,
  ErrorState,
  PageFrame,
  SectionLabel,
  ToneBadge,
} from '../components/primitives'
import { detectEnvironment } from '../platform/environment'
import { useAppSession } from './session'

export function PublicHome() {
  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">COMMUNITY COMPETITION, CONNECTED</p>
          <h1>Turn your community into a live competition.</h1>
          <p className="landing-lede">
            Games, contribution tasks, seasons, and rewards. One Rallyo identity across every
            community you join.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" to="/app/open">
              Open Rallyo
            </Link>
            <a className="button button-outline" href="#how-it-works">
              See how it works
            </a>
          </div>
        </div>
        <div className="landing-proof" aria-label="Rallyo product preview">
          <div className="proof-topline">
            <span>LIVE COMMUNITY</span>
            <span>SEASON 04</span>
          </div>
          <div className="proof-score">#04</div>
          <p>Northstar Guild</p>
          <div className="proof-row">
            <span>Community points</span>
            <strong>1,240</strong>
          </div>
          <div className="proof-row">
            <span>Next action</span>
            <strong>Task review</strong>
          </div>
          <div className="proof-stamp">RALLYO / ONE IDENTITY</div>
        </div>
      </section>
      <section className="landing-section" id="how-it-works">
        <div>
          <p className="eyebrow">THE LOOP</p>
          <h2>Play in Telegram. Keep the record in Rallyo.</h2>
        </div>
        <div className="loop-grid">
          <LoopStep number="01" title="Play" detail="Race through the enabled community games." />
          <LoopStep
            number="02"
            title="Contribute"
            detail="Complete tasks and submit proof for review."
          />
          <LoopStep
            number="03"
            title="Climb"
            detail="See your real rank and points by community."
          />
          <LoopStep
            number="04"
            title="Claim"
            detail="Link Nimiq when wallet-backed rewards are ready."
          />
        </div>
      </section>
      <section className="landing-section landing-section-dark" id="for-communities">
        <p className="eyebrow">FOR COMMUNITIES</p>
        <h2>One control surface for the arena you already run.</h2>
        <div className="landing-admin-row">
          <span>01</span>
          <strong>Enable games and set the season</strong>
          <span>Telegram + Rallyo</span>
        </div>
        <div className="landing-admin-row">
          <span>02</span>
          <strong>Publish contribution tasks</strong>
          <span>Reviewable proof</span>
        </div>
        <div className="landing-admin-row">
          <span>03</span>
          <strong>Keep rewards optional and truthful</strong>
          <span>Nimiq when useful</span>
        </div>
      </section>
    </div>
  )
}

export function OpenSessionPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useAppSession()
  const [state, setState] = useState<'idle' | 'exchanging' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const exchanged = useRef(false)
  const code = new URLSearchParams(location.search).get('code')

  useEffect(() => {
    if (!code || exchanged.current) return
    exchanged.current = true
    setState('exchanging')
    void api
      .exchangeSession(code)
      .then(async (result) => {
        await session.refresh()
        void navigate(result.redirectPath, { replace: true })
      })
      .catch((reason: unknown) => {
        setState('error')
        setError(
          reason instanceof ApiError ? reason.message : 'The Rallyo link could not be opened.',
        )
      })
  }, [code, navigate, session])

  if (state === 'exchanging') {
    return (
      <div className="entry-gate">
        <div className="entry-card">
          <p className="eyebrow">ONE-TIME HANDOFF</p>
          <h1>Opening your Rallyo session.</h1>
          <p>
            This link is being exchanged for a secure app session. Wallet access is not part of
            login.
          </p>
        </div>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="entry-gate">
        <div className="entry-card">
          <ErrorState
            title="This Rallyo link has expired."
            detail={error ?? 'Open a fresh link from Telegram.'}
          />
          <Link className="button button-outline" to="/">
            Return to Rallyo
          </Link>
        </div>
      </div>
    )
  }
  return <DirectEntryView />
}

export function PlayerHome() {
  const session = useAppSession()
  if (session.status !== 'ready') return null
  const strongest = [...session.data.communities].sort((a, b) => b.points - a.points)[0]
  return (
    <PageFrame
      eyebrow="PLAYER HQ"
      title={`Welcome back, ${session.data.player.displayName}.`}
      detail="Your record stays separate by community. Pick up where the competition is active."
      action={
        <ToneBadge tone={session.data.wallet.linked ? 'success' : 'neutral'}>
          {session.data.wallet.linked ? 'Nimiq linked' : 'Wallet optional'}
        </ToneBadge>
      }
    >
      <section className="identity-banner">
        <div className="identity-avatar">
          {session.data.player.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="section-label">RALLYO IDENTITY</p>
          <h2>{session.data.player.displayName}</h2>
          <p>
            {session.data.communities.length} active community record
            {session.data.communities.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link className="button button-outline" to="/app/me">
          View profile
        </Link>
      </section>
      {strongest ? (
        <section className="home-scorecard">
          <div className="scorecard-header">
            <div>
              <SectionLabel>STRONGEST CURRENT RECORD</SectionLabel>
              <h2>{strongest.title}</h2>
              <p>{strongest.activeSeason?.name ?? 'No active season'}</p>
            </div>
            <Link className="text-button" to={`/app/communities/${strongest.id}`}>
              Open community
            </Link>
          </div>
          <div className="scorecard-grid">
            <div>
              <span>Rank</span>
              <strong>{strongest.rank ? `#${strongest.rank}` : 'Not ranked'}</strong>
            </div>
            <div>
              <span>Points</span>
              <strong>{strongest.points.toLocaleString()}</strong>
            </div>
            <div>
              <span>Season</span>
              <strong>{strongest.activeSeason ? 'Active' : 'Waiting'}</strong>
            </div>
          </div>
        </section>
      ) : (
        <EmptyState
          title="Your first community record is waiting."
          detail="Join a Rallyo community in Telegram to start building a real score."
        />
      )}
      <div className="content-grid content-grid-two">
        <section className="panel">
          <div className="panel-heading">
            <SectionLabel>NEXT ACTIONS</SectionLabel>
            <span className="panel-count">
              {session.data.communities.length ? 'READY' : 'START'}
            </span>
          </div>
          <div className="action-row">
            <span className="action-index">01</span>
            <div>
              <strong>Check your community record</strong>
              <p>Review rank, games, tasks, and reward state.</p>
            </div>
            <span aria-hidden="true">↗</span>
          </div>
          <div className="action-row">
            <span className="action-index">02</span>
            <div>
              <strong>Link Nimiq when useful</strong>
              <p>Wallet access is for rewards, not Rallyo login.</p>
            </div>
            <span aria-hidden="true">↗</span>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <SectionLabel>RECENT SIGNALS</SectionLabel>
            <span className="panel-count">REAL DATA</span>
          </div>
          <p className="panel-empty">
            Score, task, and reward activity will appear here as the shared backend exposes it.
          </p>
        </section>
      </div>
    </PageFrame>
  )
}

export function PlayerRoutePlaceholder({
  title,
  detail,
  eyebrow = 'PLAYER HQ',
}: {
  readonly title: string
  readonly detail: string
  readonly eyebrow?: string
}) {
  return (
    <PageFrame eyebrow={eyebrow} title={title} detail={detail}>
      <EmptyState
        title="Foundation route ready."
        detail="This Phase 8A surface is intentionally a placeholder. The worker lane will connect its real states after visual direction approval."
      />
    </PageFrame>
  )
}

export function PlayerProfile() {
  const session = useAppSession()
  const [code, setCode] = useState('')
  const [state, setState] = useState<'idle' | 'pairing' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  if (session.status !== 'ready') return null

  const pairTelegram = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setState('pairing')
    setError(null)
    try {
      await api.pairTelegram(code.trim())
      setCode('')
      setState('success')
      await session.refresh()
    } catch (reason: unknown) {
      setState('error')
      setError(
        reason instanceof ApiError ? reason.message : 'Telegram pairing could not be completed.',
      )
    }
  }

  return (
    <PageFrame
      eyebrow="PLAYER HQ"
      title="Your Rallyo identity"
      detail="Telegram and Nimiq are connected methods for the same Player. Wallet access stays optional."
    >
      <section className="panel">
        <SectionLabel>IDENTITY METHODS</SectionLabel>
        <p>{session.data.player.displayName}</p>
        <p>
          {session.data.wallet.linked ? 'Nimiq wallet connected.' : 'Nimiq wallet not connected.'}
        </p>
        <p>
          {session.data.player.username
            ? `Telegram @${session.data.player.username}`
            : 'Telegram not connected.'}
        </p>
      </section>
      <form className="panel" onSubmit={(event) => void pairTelegram(event)}>
        <SectionLabel>CONNECT TELEGRAM</SectionLabel>
        <p>Ask RallyoBot for a one-time pairing code, then enter it here.</p>
        <label htmlFor="telegram-pairing-code">Pairing code</label>
        <input
          id="telegram-pairing-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={100}
          required
        />
        <button className="button button-primary" type="submit" disabled={state === 'pairing'}>
          {state === 'pairing' ? 'Connecting…' : 'Connect Telegram'}
        </button>
        {state === 'success' ? (
          <p role="status">Telegram is now connected to this Player.</p>
        ) : null}
        {state === 'error' ? <p role="alert">{error}</p> : null}
      </form>
    </PageFrame>
  )
}

export function AdminRoutePlaceholder({
  title,
  detail,
}: {
  readonly title: string
  readonly detail: string
}) {
  return (
    <PageFrame eyebrow="COMMUNITY CONTROL" title={title} detail={detail}>
      <section className="admin-placeholder">
        <div className="admin-placeholder-index">A0</div>
        <div>
          <h2>Authorized control surface</h2>
          <p>
            Server-derived community access is wired. Page actions arrive after the Phase 8A gate.
          </p>
        </div>
        <ToneBadge tone="accent">Foundation</ToneBadge>
      </section>
    </PageFrame>
  )
}

export function DirectEntryView() {
  const environment = detectEnvironment()
  const session = useAppSession()
  return (
    <div className="entry-gate">
      <div className="entry-card">
        <p className="eyebrow">
          {environment.host === 'nimiq-pay' ? 'NIMIQ PAY ENTRY' : 'RALLYO ENTRY'}
        </p>
        <h1>Choose how to enter Rallyo.</h1>
        <p>
          Continue with Nimiq Pay inside the wallet, or open Telegram to use the Rallyo identity
          already connected to your communities.
        </p>
        <div className="entry-actions">
          <WalletSignInButton
            enabled={environment.isWalletProviderAvailable}
            onAuthenticated={async (redirectPath) => {
              await session.refresh()
              window.history.replaceState(null, '', redirectPath)
              window.location.assign(redirectPath)
            }}
          />
          <a className="button button-primary" href="https://t.me/">
            Open Telegram
          </a>
          <Link className="button button-outline" to="/">
            Explore public Rallyo
          </Link>
        </div>
        <p className="entry-note">
          Wallet linking is optional.{' '}
          {environment.host === 'nimiq-pay'
            ? 'Wallet-backed actions can continue in Nimiq Pay after login.'
            : 'Open wallet-backed actions in Nimiq Pay when supported.'}
        </p>
      </div>
    </div>
  )
}

function WalletSignInButton({
  enabled,
  onAuthenticated,
}: {
  readonly enabled: boolean
  readonly onAuthenticated: (redirectPath: string) => Promise<void>
}) {
  const [state, setState] = useState<'idle' | 'signing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setState('signing')
    setError(null)
    try {
      const provider = await init({ timeout: 10_000 })
      await provider.connect()
      const accounts = await provider.listAccounts()
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No Nimiq account is available in this wallet.')
      }
      const address = accounts[0]
      if (!address) throw new Error('No Nimiq account is available in this wallet.')
      const challenge = await api.walletChallenge(address)
      const signed = await provider.sign(challenge.message)
      if ('error' in signed) throw new Error(signed.error.message)
      const result = await api.walletComplete({
        challengeId: challenge.challengeId,
        message: challenge.message,
        publicKey: signed.publicKey,
        signature: signed.signature,
      })
      await onAuthenticated(result.redirectPath)
    } catch (reason: unknown) {
      setState('error')
      setError(reason instanceof Error ? reason.message : 'Nimiq sign-in could not be completed.')
    }
  }

  return (
    <div>
      <button
        className="button button-primary"
        type="button"
        onClick={() => void signIn()}
        disabled={!enabled || state === 'signing'}
      >
        {state === 'signing' ? 'Signing in…' : 'Continue with Nimiq Pay'}
      </button>
      {!enabled ? (
        <p className="entry-note">Available when Rallyo is opened inside Nimiq Pay.</p>
      ) : null}
      {state === 'error' ? (
        <p className="entry-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function DirectionGate() {
  return (
    <div className="direction-gate-page">
      <header className="direction-header">
        <div>
          <p className="eyebrow">PHASE 8A / VISUAL DIRECTION GATE</p>
          <h1>Three ways Rallyo can hold the competition.</h1>
          <p>
            Same product content, same three views, three distinct structural hypotheses. Fixture
            content is isolated to this gate and is not production state.
          </p>
        </div>
        <Link className="button button-outline" to="/">
          Exit gate
        </Link>
      </header>
      <div className="direction-legend">
        <span>
          <i className="legend-dot legend-dot-scorecard" />
          League Scorecard
        </span>
        <span>
          <i className="legend-dot legend-dot-passport" />
          Rally Passport
        </span>
        <span>
          <i className="legend-dot legend-dot-arena" />
          Live Arena
        </span>
      </div>
      <div className="direction-worlds">
        <DirectionWorld
          theme="scorecard"
          name="League Scorecard"
          description="Crisp record keeping, confident borders, and a lime signal for live competition."
        />
        <DirectionWorld
          theme="passport"
          name="Rally Passport"
          description="Identity first, calmer paper surfaces, and a more editorial community record."
        />
        <DirectionWorld
          theme="arena"
          name="Live Arena"
          description="Broadcast energy, dark field surfaces, and a stronger sense of live momentum."
        />
      </div>
      <footer className="direction-footer">
        Review the same Player Home, League, and Community Admin Overview in each world. Choose one
        direction or name a combination before page fan-out.
      </footer>
    </div>
  )
}

function DirectionWorld({
  theme,
  name,
  description,
}: {
  readonly theme: 'scorecard' | 'passport' | 'arena'
  readonly name: string
  readonly description: string
}) {
  return (
    <section className={`direction-world direction-world-${theme}`} data-theme={theme}>
      <div className="world-heading">
        <div>
          <span className="world-index">
            0{theme === 'scorecard' ? '1' : theme === 'passport' ? '2' : '3'}
          </span>
          <h2>{name}</h2>
          <p>{description}</p>
        </div>
        <span className="fixture-tag">FIXTURE VIEW</span>
      </div>
      <div className="direction-preview-grid">
        <PreviewHome />
        <PreviewLeague />
        <PreviewAdmin />
      </div>
    </section>
  )
}

function PreviewHome() {
  return (
    <article className="direction-preview">
      <PreviewTitle label="PLAYER HOME" title="Mira K" />
      <div className="preview-identity">
        <span className="preview-avatar">M</span>
        <div>
          <strong>Northstar Guild</strong>
          <span>Season 04 / active</span>
        </div>
        <b>#04</b>
      </div>
      <div className="preview-score-row">
        <div>
          <span>Points</span>
          <strong>1,240</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>Task review</strong>
        </div>
      </div>
      <div className="preview-rule" />
      <p className="preview-note">One identity, separate community records.</p>
    </article>
  )
}

function PreviewLeague() {
  return (
    <article className="direction-preview">
      <PreviewTitle label="LEAGUE" title="Northstar Guild" />
      <div className="preview-league-head">
        <strong>#04</strong>
        <span>1,240 pts</span>
        <span>Season 04</span>
      </div>
      <div className="preview-table">
        <div>
          <span>01</span>
          <strong>Owen R.</strong>
          <b>1,820</b>
        </div>
        <div>
          <span>02</span>
          <strong>Lin S.</strong>
          <b>1,640</b>
        </div>
        <div className="preview-current">
          <span>04</span>
          <strong>Mira K.</strong>
          <b>1,240</b>
        </div>
      </div>
      <p className="preview-note">Current player stays visible in the record.</p>
    </article>
  )
}

function PreviewAdmin() {
  return (
    <article className="direction-preview">
      <PreviewTitle label="COMMUNITY CONTROL" title="Northstar Guild" />
      <div className="preview-admin-state">
        <span className="status-dot" />
        ACTIVE SEASON<strong>Week 03</strong>
      </div>
      <div className="preview-admin-list">
        <div>
          <span>Players</span>
          <b>24</b>
        </div>
        <div>
          <span>Tasks awaiting review</span>
          <b>04</b>
        </div>
        <div>
          <span>Enabled games</span>
          <b>03</b>
        </div>
      </div>
      <button className="preview-action" type="button">
        Open control row
      </button>
    </article>
  )
}

function PreviewTitle({ label, title }: { readonly label: string; readonly title: string }) {
  return (
    <header className="preview-title">
      <span>{label}</span>
      <h3>{title}</h3>
      <i aria-hidden="true">↗</i>
    </header>
  )
}

function LoopStep({
  number,
  title,
  detail,
}: {
  readonly number: string
  readonly title: string
  readonly detail: string
}) {
  return (
    <div className="loop-step">
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}
