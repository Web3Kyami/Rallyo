import { useState } from 'react'

import {
  Avatar,
  BottomNav,
  Button,
  CommunityCard,
  DesktopSidebar,
  EmptyState,
  ErrorState,
  Field,
  GameCard,
  Icon,
  LeaderboardRow,
  LoadingState,
  RankBlock,
  RallyoBrand,
  StatusBanner,
  Tabs,
  TaskCard,
  ToneBadge,
} from '../components/design-system'

const previewNav = [
  { href: '#showcase-home', icon: 'home' as const, label: 'Home' },
  { href: '#showcase-league', icon: 'trophy' as const, label: 'League' },
  { href: '#showcase-tasks', icon: 'list' as const, label: 'Tasks' },
  { href: '#showcase-communities', icon: 'users' as const, label: 'Communities' },
  { href: '#showcase-you', icon: 'user' as const, label: 'You' },
]

const leaderboard = [
  { name: 'Owen R.', rank: 1, score: 1820, avatarId: 'masculine-01' },
  { name: 'Mira K.', rank: 2, score: 1640, avatarId: 'feminine-02', current: true },
  { name: 'Sana T.', rank: 3, score: 1510, avatarId: 'neutral-03' },
]

export function DesignShowcasePage() {
  const [tab, setTab] = useState('available')
  const [lastAction, setLastAction] = useState('')
  return (
    <main className="showcase-page">
      <header className="showcase-header">
        <div>
          <RallyoBrand />
          <p className="eyebrow">PHASE 8 / DESIGN FOUNDATION</p>
          <h1>Shared pieces for a live competition.</h1>
          <p>
            Dev-only showcase for the approved Rallyo system. Fixture content is clearly marked and
            is not product data.
          </p>
        </div>
        <a className="button button-outline" href="/app">
          Exit showcase <Icon name="arrow-up-right" size={18} />
        </a>
      </header>

      <div className="showcase-content">
        <StatusBanner
          detail="The player identity can use Telegram, Nimiq, or both. This banner is an example of a real connection state."
          icon="link"
          title="Connect Telegram when you are ready"
          tone="accent"
          action={
            <Button disabled size="sm" title="Showcase fixture only" variant="secondary">
              Enter code
            </Button>
          }
        />

        <section className="showcase-section" id="showcase-controls">
          <h2>Controls and state</h2>
          <div className="showcase-grid">
            <div className="showcase-panel">
              <h3>Buttons, badges, and tabs</h3>
              <div className="showcase-button-row">
                <Button icon="arrow-right" onClick={() => setLastAction('Primary action selected')}>
                  Primary action
                </Button>
                <Button
                  onClick={() => setLastAction('Secondary action selected')}
                  variant="secondary"
                >
                  Secondary
                </Button>
                <Button onClick={() => setLastAction('Text action selected')} variant="tertiary">
                  Text action
                </Button>
                <Button disabled>Disabled</Button>
              </div>
              <div className="showcase-button-row">
                <ToneBadge tone="accent">Active season</ToneBadge>
                <ToneBadge tone="success" icon="check">
                  Approved
                </ToneBadge>
                <ToneBadge tone="warning" icon="warning">
                  Needs review
                </ToneBadge>
                <ToneBadge tone="danger">Expired</ToneBadge>
              </div>
              <Tabs
                items={[
                  { value: 'available', label: 'Available' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'history', label: 'History' },
                ]}
                value={tab}
                onChange={setTab}
              />
              {lastAction ? (
                <p className="showcase-live-message" role="status">
                  {lastAction}
                </p>
              ) : null}
            </div>
            <div className="showcase-panel">
              <h3>Input states</h3>
              <Field
                label="Pairing code"
                defaultValue="RALLYO8"
                helper="Get a one-time code from RallyoBot."
              />
              <Field
                label="Invalid code"
                defaultValue="expired"
                error="This code has expired. Ask RallyoBot for a fresh code."
              />
            </div>
          </div>
          <div className="showcase-grid showcase-grid-three">
            <LoadingState label="Loading leaderboard" />
            <EmptyState
              title="No community record yet"
              detail="Connect Telegram to restore your communities and season history."
            />
            <ErrorState
              title="Community data needs attention"
              detail="Try again when the app service is reachable."
            />
          </div>
        </section>

        <section className="showcase-section" id="showcase-cards">
          <h2>Competition content</h2>
          <div className="showcase-grid-three">
            <GameCard
              family="quiz"
              detail="Race through the current community quiz."
              action={
                <Button disabled size="sm" title="Showcase fixture only" variant="secondary">
                  View community
                </Button>
              }
            />
            <GameCard
              family="scramble"
              detail="Unscramble the project term in Telegram."
              action={
                <Button disabled size="sm" title="Showcase fixture only" variant="secondary">
                  Open Telegram
                </Button>
              }
            />
            <GameCard
              family="word-seek"
              enabled={false}
              detail="This game is not enabled in this community."
            />
          </div>
          <div className="showcase-grid">
            <TaskCard
              action={
                <Button disabled size="sm" title="Showcase fixture only">
                  View task
                </Button>
              }
              community="Northstar Guild"
              expiry="1x daily"
              platform="X"
              points={5}
              proof="URL"
              title="Post about Nimiq"
            />
            <CommunityCard
              action={
                <Button disabled size="sm" title="Showcase fixture only" variant="secondary">
                  View community
                </Button>
              }
              admin
              name="Northstar Guild"
              points={1240}
              rank={4}
              season="Season 04 · active"
              taskCue="2 tasks need attention"
            />
          </div>
        </section>

        <section className="showcase-section" id="showcase-leaderboard">
          <h2>Rank and leaderboard</h2>
          <div className="showcase-grid">
            <div className="showcase-panel">
              <h3>Rank block</h3>
              <RankBlock
                context="Northstar Guild"
                points={1240}
                rank={4}
                season="Season 04"
                movement={2}
              />
            </div>
            <div className="showcase-panel">
              <h3>Leaderboard rows</h3>
              <div className="leaderboard-list">
                {leaderboard.map((player) => (
                  <LeaderboardRow key={player.name} {...player} tier="Season 04" />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="showcase-section" id="showcase-responsive">
          <h2>Responsive shell composition</h2>
          <p className="showcase-footnote">
            The two frames below intentionally show the same hierarchy at mobile and desktop widths.
          </p>
          <div className="showcase-viewports">
            <div className="showcase-viewport">
              <div className="showcase-viewport-label">
                <span>Mobile</span>
                <span>390 × 844</span>
              </div>
              <div className="showcase-mobile-canvas">
                <PreviewIdentity />
                <StatusBanner
                  detail="Your community history returns when pairing succeeds."
                  icon="telegram"
                  title="Telegram not connected"
                  tone="accent"
                  action={
                    <Button disabled size="sm" title="Showcase fixture only" variant="secondary">
                      Connect
                    </Button>
                  }
                />
                <RankBlock context="Northstar Guild" points={1240} rank={4} season="Season 04" />
                <div className="showcase-card-stack">
                  <GameCard family="quiz" />
                  <CommunityCard
                    name="Northstar Guild"
                    points={1240}
                    rank={4}
                    season="Season 04 · active"
                  />
                </div>
                <BottomNav items={previewNav} />
              </div>
            </div>
            <div className="showcase-viewport">
              <div className="showcase-viewport-label">
                <span>Desktop</span>
                <span>1280 × 800</span>
              </div>
              <div className="showcase-desktop-canvas">
                <DesktopSidebar context="Mira K." items={previewNav} />
                <div className="showcase-desktop-main">
                  <PreviewIdentity desktop />
                  <div className="showcase-desktop-main-grid">
                    <RankBlock
                      context="Northstar Guild"
                      points={1240}
                      rank={4}
                      season="Season 04"
                      movement={2}
                    />
                    <div className="leaderboard-list">
                      {leaderboard.map((player) => (
                        <LeaderboardRow key={player.name} {...player} tier="Season 04" />
                      ))}
                    </div>
                  </div>
                  <div className="showcase-grid showcase-grid-three">
                    <GameCard family="quiz" />
                    <GameCard family="scramble" />
                    <GameCard family="word-seek" enabled={false} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function PreviewIdentity({ desktop = false }: { readonly desktop?: boolean }) {
  return (
    <div
      className={`showcase-preview-identity${desktop ? ' showcase-preview-identity-desktop' : ''}`}
    >
      <Avatar avatarId="feminine-02" name="Mira K." size={desktop ? 'md' : 'lg'} rank={4} />
      <div>
        <span className="eyebrow">RALLYO PLAYER</span>
        <strong>Mira K.</strong>
        <p>One identity, separate community records.</p>
      </div>
      <ToneBadge tone="success" icon="wallet">
        Wallet linked
      </ToneBadge>
    </div>
  )
}
