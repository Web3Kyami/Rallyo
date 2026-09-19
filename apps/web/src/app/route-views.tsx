import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { ErrorState, PageFrame, ToneBadge } from '../components/primitives'
import { Icon, RallyoBrand } from '../components/design-system'
import { useAppSession } from './session'
import { PlayerEntryPage } from './player-views'

export function PublicHome() {
  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-kicker">
            <p className="eyebrow">TELEGRAM-FIRST COMPETITION</p>
          </div>
          <h1>
            Play the moment.
            <span>Keep the record.</span>
          </h1>
          <p className="landing-lede">
            Games, community tasks, seasons, and rewards in one Rallyo record.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" to="/app/open">
              Open Rallyo
            </Link>
            <a className="button button-outline" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className="landing-microcopy">
            <Icon name="telegram" size={18} /> Games stay in Telegram. Wallet access stays optional.
          </p>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-visual-label">
            <RallyoBrand compact />
            <span>COMMUNITY COMPETITION</span>
          </div>
          <LandingHeroBoard />
        </div>
      </section>

      <section className="landing-section" id="how-it-works">
        <div className="landing-section-intro">
          <div>
            <p className="eyebrow">THE MODEL</p>
            <h2>The live game is in Telegram. The momentum stays in Rallyo.</h2>
          </div>
          <p>Rallyo gives community participation a visible record across the places you play.</p>
        </div>
        <div className="landing-model">
          <div className="landing-game-list">
            <div className="landing-subheading">
              <span className="eyebrow">PLAY SURFACE</span>
              <span>Telegram</span>
            </div>
            <LandingGame
              accent="quiz"
              detail="Project knowledge and first-correct races."
              icon="list"
              name="Quiz / Race"
            />
            <LandingGame
              accent="scramble"
              detail="Solve mixed-up project terms."
              icon="game"
              name="Scramble"
            />
            <LandingGame
              accent="word-seek"
              detail="Find the hidden word before the round ends."
              icon="search"
              name="Word Seek"
            />
            <LandingGame
              accent="more"
              detail="More community games are on the way."
              icon="spark"
              name="More coming soon"
            />
          </div>
          <div className="landing-record-panel">
            <div className="landing-record-heading">
              <span className="eyebrow">TRACKING SURFACE</span>
            </div>
            <div className="landing-record-title">
              <span className="landing-record-mark">R</span>
              <strong>One Rallyo Player</strong>
            </div>
            <p>Separate community records, one identity.</p>
            <div className="landing-record-list">
              <RecordLine label="Community seasons" detail="Real points and ranks by community" />
              <RecordLine label="Contribution tasks" detail="Proof, review, and status" />
              <RecordLine label="Rewards" detail="Optional wallet-backed claims" />
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-loop-section">
        <div className="landing-section-intro landing-section-intro-loop">
          <div>
            <p className="eyebrow">THE LOOP</p>
            <h2>A simple loop for real participation.</h2>
          </div>
          <p>Each step leaves a useful record for the player and the community.</p>
        </div>
        <div className="loop-grid">
          <LoopStep title="Play" detail="Answer enabled games in Telegram." />
          <LoopStep title="Contribute" detail="Complete real community tasks." />
          <LoopStep title="Climb" detail="Follow rank and points by season." />
          <LoopStep title="Earn" detail="Claim rewards when the community enables them." />
        </div>
      </section>

      <section className="landing-section landing-section-dark" id="for-communities">
        <div className="landing-section-intro landing-section-intro-dark">
          <div>
            <p className="eyebrow">FOR COMMUNITIES</p>
            <h2>Give participation a place to go.</h2>
          </div>
          <p>
            Community admins keep the arena focused: enable games, run seasons, publish tasks, and
            decide whether rewards belong in the loop.
          </p>
        </div>
        <div className="landing-admin-list">
          <AdminRow
            title="Enable the games your community wants to play."
            detail="Quiz / Race · Scramble · Word Seek"
          />
          <AdminRow
            title="Run seasons with a clear community leaderboard."
            detail="Community-scoped points and ranks"
          />
          <AdminRow
            title="Publish contribution tasks with reviewable proof."
            detail="Social tasks and manual review"
          />
          <AdminRow
            title="Keep wallet-backed rewards optional."
            detail="Nimiq when it adds something"
          />
        </div>
      </section>

      <section className="landing-section landing-nimiq-section">
        <div className="landing-nimiq-copy">
          <p className="eyebrow">NIMIQ PAY</p>
          <h2>Wallet when it helps. Rallyo always comes first.</h2>
          <p>
            Rallyo runs inside Nimiq Pay for wallet entry and reward actions. Telegram players can
            join without a wallet.
          </p>
          <Link className="button button-primary" to="/app/open">
            Open Rallyo
          </Link>
        </div>
        <div className="landing-nimiq-note">
          <div className="landing-nimiq-note-mark">
            <Icon name="wallet" size={24} />
          </div>
          <div>
            <strong>Two ways in</strong>
            <p>Pair Telegram in a browser, or continue with Nimiq Pay inside its Mini App.</p>
          </div>
        </div>
      </section>

      <section className="landing-final-cta">
        <p className="eyebrow">YOUR TURN</p>
        <h2>Join the record your community is building.</h2>
        <Link className="button button-primary" to="/app/open">
          Open Rallyo
        </Link>
      </section>
    </div>
  )
}

function LandingHeroBoard() {
  return (
    <div className="landing-hero-board">
      <div className="landing-hero-board-top">
        <span className="eyebrow">RALLYO RECORD</span>
        <span>PLAY SURFACE: TELEGRAM</span>
      </div>
      <div className="landing-hero-board-title">
        <strong>Community competition</strong>
        <span>One record across every rally.</span>
      </div>
      <div className="landing-hero-board-games" aria-label="Rallyo games">
        <span className="landing-hero-board-game landing-hero-board-game-quiz">Quiz / Race</span>
        <span className="landing-hero-board-game landing-hero-board-game-scramble">Scramble</span>
        <span className="landing-hero-board-game landing-hero-board-game-word-seek">Word Seek</span>
      </div>
      <div className="landing-hero-board-loop">
        <span>Play</span>
        <span>Contribute</span>
        <span>Climb</span>
        <span>Earn</span>
      </div>
    </div>
  )
}

function LandingGame({
  accent,
  detail,
  icon,
  name,
}: {
  readonly accent: 'quiz' | 'scramble' | 'word-seek' | 'more'
  readonly detail: string
  readonly icon: 'list' | 'game' | 'search' | 'spark'
  readonly name: string
}) {
  return (
    <div className={`landing-game landing-game-${accent}`}>
      <span className="landing-game-icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <strong>{name}</strong>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function RecordLine({ detail, label }: { readonly detail: string; readonly label: string }) {
  return (
    <div className="landing-record-line">
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  )
}

function AdminRow({ detail, title }: { readonly detail: string; readonly title: string }) {
  return (
    <div className="landing-admin-row">
      <strong>{title}</strong>
      <span>{detail}</span>
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
      <div className="entry-gate public-entry-state">
        <div className="entry-card">
          <RallyoBrand />
          <p className="eyebrow">ONE-TIME HANDOFF</p>
          <h1>Opening your Rallyo session.</h1>
          <p>Getting your Rallyo record ready.</p>
        </div>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="entry-gate public-entry-state">
        <div className="entry-card">
          <ErrorState
            title="This one-time link could not be opened."
            detail={error ?? 'Open a fresh link from Telegram and try again.'}
          />
          <div className="entry-state-actions">
            <Link className="button button-primary" to="/app/open">
              Enter a pairing code
            </Link>
            <button
              className="button button-outline"
              type="button"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
            <Link className="button button-outline" to="/">
              Return home
            </Link>
          </div>
        </div>
      </div>
    )
  }
  return <DirectEntryView />
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
  return <PlayerEntryPage />
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

function LoopStep({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div className="loop-step">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}
