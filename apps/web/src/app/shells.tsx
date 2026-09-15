import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'

import { Avatar, Icon, LoadingState, ToneBadge, type IconName } from '../components/design-system'
import { detectEnvironment } from '../platform/environment'
import { useAppSession } from './session'

const playerNav = [
  { to: '/app', label: 'Home', icon: 'home' as IconName, end: true },
  { to: '/app/league', label: 'League', icon: 'trophy' as IconName },
  { to: '/app/tasks', label: 'Tasks', icon: 'list' as IconName },
  { to: '/app/communities', label: 'Communities', icon: 'users' as IconName },
  { to: '/app/me', label: 'You', icon: 'user' as IconName },
]

export function PublicShell() {
  return (
    <div className="public-shell">
      <PublicHeader />
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export function PlayerGate() {
  const session = useAppSession()
  if (session.status === 'loading')
    return (
      <div className="entry-gate">
        <LoadingState />
      </div>
    )
  if (session.status !== 'ready') return <EntryGate />
  return <PlayerShell />
}

export function AdminGate() {
  const session = useAppSession()
  if (session.status === 'loading')
    return (
      <div className="entry-gate">
        <LoadingState />
      </div>
    )
  if (session.status !== 'ready') return <EntryGate />
  if (session.data.adminCommunities.length === 0) return <ForbiddenGate />
  return <AdminShell />
}

export function OperatorBoundary() {
  return (
    <div className="operator-shell">
      <aside className="operator-sidebar">
        <Link className="brand-lockup" to="/">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>RALLYO</span>
        </Link>
        <div className="rail-context">
          <span className="rail-context-label">OPERATOR CONSOLE</span>
          <strong>Diagnostics</strong>
          <span>Owner session required</span>
        </div>
        <nav className="desktop-nav" aria-label="Operator navigation">
          <span className="app-nav-link active">
            <Icon name="home" size={19} />
            Overview
          </span>
          <span className="app-nav-link">
            <Icon name="users" size={19} />
            Communities
          </span>
          <span className="app-nav-link">
            <Icon name="user" size={19} />
            Identity support
          </span>
          <span className="app-nav-link">
            <Icon name="wallet" size={19} />
            Rewards
          </span>
        </nav>
      </aside>
      <main className="operator-workspace">
        <div className="operator-card">
          <p className="eyebrow">PRIVATE SURFACE</p>
          <h1>Operator access is separate.</h1>
          <p>
            This boundary is reserved for the later owner session. Player and community admin
            sessions cannot cross into operator controls.
          </p>
          <Link className="button button-primary" to="/">
            Return to Rallyo
          </Link>
        </div>
      </main>
    </div>
  )
}

function PlayerShell() {
  const session = useAppSession()
  const environment = detectEnvironment()
  if (session.status !== 'ready') return null

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <Link className="brand-lockup" to="/app" aria-label="Rallyo home">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>Rallyo</span>
        </Link>
        <div className="rail-context">
          <span className="rail-context-label">PLAYER HQ</span>
          <strong>{session.data.player.displayName}</strong>
          <span>{environment.host === 'nimiq-pay' ? 'Nimiq Pay' : 'Browser session'}</span>
        </div>
        <nav className="desktop-nav" aria-label="Player navigation">
          {playerNav.map((item) => (
            <AppNavLink key={item.to} {...item} />
          ))}
        </nav>
        {session.data.adminCommunities.length > 0 ? (
          <Link className="manage-link" to="/app/admin">
            <span>Manage</span>
            <span aria-hidden="true">↗</span>
          </Link>
        ) : null}
        <div className="rail-footer">
          <ToneBadge tone={session.data.wallet.linked ? 'success' : 'neutral'}>
            {session.data.wallet.linked ? 'Wallet linked' : 'Wallet optional'}
          </ToneBadge>
          <button className="text-button" type="button" onClick={() => void session.logout()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="app-main">
        <MobileHeader />
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Player navigation">
        {playerNav.map((item) => (
          <AppNavLink key={item.to} {...item} compact />
        ))}
      </nav>
    </div>
  )
}

function AdminShell() {
  const session = useAppSession()
  return (
    <div className="admin-shell">
      <aside className="side-rail side-rail-admin">
        <Link className="brand-lockup" to="/app">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>Rallyo</span>
        </Link>
        <div className="rail-context">
          <span className="rail-context-label">COMMUNITY CONTROL</span>
          <strong>
            {session.status === 'ready'
              ? (session.data.adminCommunities[0]?.title ?? 'Select community')
              : 'Select community'}
          </strong>
          <span>Admin mode</span>
        </div>
        <nav className="desktop-nav" aria-label="Admin navigation">
          <AppNavLink to="/app/admin" label="Overview" icon="home" end />
          <AppNavLink to="/app/admin/games" label="Games" icon="game" />
          <AppNavLink to="/app/admin/season" label="Season" icon="trophy" />
          <AppNavLink to="/app/admin/tasks" label="Social tasks" icon="list" />
          <AppNavLink to="/app/admin/content" label="Project content" icon="search" />
        </nav>
        <Link className="manage-link" to="/app">
          Back to player view <span aria-hidden="true">↙</span>
        </Link>
      </aside>
      <main className="app-main">
        <MobileHeader admin />
        <Outlet />
      </main>
    </div>
  )
}

function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand-lockup" to="/">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span>Rallyo</span>
      </Link>
      <nav className="public-nav" aria-label="Public navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#for-communities">For communities</a>
        <Link className="button button-small button-outline" to="/app/open">
          Open Rallyo
        </Link>
      </nav>
    </header>
  )
}

function MobileHeader({ admin = false }: { readonly admin?: boolean }) {
  const location = useLocation()
  const session = useAppSession()
  const title = admin
    ? 'Admin control'
    : (playerNav.find((item) => location.pathname === item.to)?.label ?? 'Rallyo')
  return (
    <header className="mobile-header">
      <Link className="brand-lockup" to={admin ? '/app/admin' : '/app'}>
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span>{admin ? 'Control' : 'Rallyo'}</span>
      </Link>
      <div className="mobile-header-center">
        <span className="eyebrow">{title}</span>
      </div>
      <Avatar
        name={session.status === 'ready' ? session.data.player.displayName : 'Player'}
        size="xs"
      />
    </header>
  )
}

function AppNavLink({
  to,
  label,
  icon,
  end,
  compact = false,
}: {
  readonly to: string
  readonly label: string
  readonly icon: IconName
  readonly end?: boolean
  readonly compact?: boolean
}) {
  return (
    <NavLink
      className={`app-nav-link${compact ? ' app-nav-link-compact' : ''}`}
      to={to}
      {...(end ? { end: true } : {})}
    >
      <Icon name={icon} size={compact ? 20 : 19} />
      <span>{label}</span>
    </NavLink>
  )
}

function EntryGate() {
  const environment = detectEnvironment()
  return (
    <div className="entry-gate">
      <div className="entry-card">
        <p className="eyebrow">RALLYO PLAYER APP</p>
        <h1>Enter Rallyo your way.</h1>
        <p>
          Continue with Nimiq Pay when it is available, or use your Telegram identity. Wallet access
          stays optional for play, rank, tasks, and community competition.
        </p>
        <div className="entry-actions">
          <Link className="button button-primary" to="/app/open">
            Choose sign-in method
          </Link>
          <Link className="button button-outline" to="/">
            Explore Rallyo
          </Link>
        </div>
        <p className="entry-note">
          Current environment: {environment.host === 'nimiq-pay' ? 'Nimiq Pay' : 'browser'}.
        </p>
      </div>
    </div>
  )
}

function ForbiddenGate() {
  return (
    <div className="entry-gate">
      <div className="entry-card">
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1>This surface is for community admins.</h1>
        <p>Your player session does not have a server-authorized community admin role.</p>
        <Link className="button button-outline" to="/app">
          Return to player view
        </Link>
      </div>
    </div>
  )
}
