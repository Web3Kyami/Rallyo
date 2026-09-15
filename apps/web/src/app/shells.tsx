import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'

import {
  Avatar,
  Icon,
  LoadingState,
  RallyoBrand,
  ToneBadge,
  type IconName,
} from '../components/design-system'
import { detectEnvironment } from '../platform/environment'
import { useAppSession } from './session'
import { PlayerEntryPage } from './player-views'
import { getStoredAvatarId } from './player-data'

const playerNav = [
  { to: '/app', label: 'Home', icon: 'home' as IconName, end: true },
  { to: '/app/league', label: 'League', icon: 'trophy' as IconName },
  { to: '/app/tasks', label: 'Tasks', icon: 'list' as IconName },
  { to: '/app/communities', label: 'Communities', icon: 'users' as IconName },
  { to: '/app/me', label: 'You', icon: 'user' as IconName },
]

export function PublicShell() {
  const location = useLocation()
  const isEntry = location.pathname === '/app/open'

  return (
    <div className={`public-shell${isEntry ? ' public-shell-entry' : ''}`}>
      <PublicHeader isEntry={isEntry} />
      <main className={isEntry ? 'public-main public-main-entry' : 'public-main'}>
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
  const location = useLocation()
  const routeCommunityId = location.pathname.match(/^\/app\/admin\/([^/]+)/)?.[1]
  const currentCommunityId =
    routeCommunityId ??
    (session.status === 'ready' ? session.data.adminCommunities[0]?.id : undefined)
  const adminBase = currentCommunityId ? `/app/admin/${currentCommunityId}` : '/app/admin'
  const currentCommunity =
    session.status === 'ready'
      ? session.data.adminCommunities.find((community) => community.id === currentCommunityId)
      : undefined
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
          <strong>{currentCommunity?.title ?? 'Select community'}</strong>
          <span>Admin mode</span>
        </div>
        <nav className="desktop-nav" aria-label="Admin navigation">
          <AppNavLink to={adminBase} label="Overview" icon="home" end />
          <AppNavLink to={`${adminBase}/games`} label="Games" icon="game" />
          <AppNavLink to={`${adminBase}/season`} label="Season" icon="trophy" />
          <AppNavLink to={`${adminBase}/tasks`} label="Social tasks" icon="list" />
          <AppNavLink to={`${adminBase}/content`} label="Project content" icon="search" />
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

function PublicHeader({ isEntry }: { readonly isEntry: boolean }) {
  return (
    <header className={`public-header${isEntry ? ' public-header-entry' : ''}`}>
      <Link className="public-header-brand" to="/" aria-label="Rallyo overview">
        <RallyoBrand compact />
      </Link>
      {isEntry ? (
        <Link className="public-header-back" to="/">
          <span aria-hidden="true">←</span> Rallyo overview
        </Link>
      ) : (
        <nav className="public-nav" aria-label="Public navigation">
          <a href="#how-it-works">How Rallyo works</a>
          <a href="#for-communities">For communities</a>
          <Link className="button button-small button-outline" to="/app/open">
            Open Rallyo
          </Link>
        </nav>
      )}
    </header>
  )
}

function MobileHeader({ admin = false }: { readonly admin?: boolean }) {
  const location = useLocation()
  const session = useAppSession()
  const title = admin
    ? 'Admin control'
    : (playerNav.find((item) =>
        item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
      )?.label ?? 'Rallyo')
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
      <div className="mobile-header-actions">
        {admin ? (
          <Link className="mobile-header-player-link" to="/app">
            Player
          </Link>
        ) : null}
        <Avatar
          avatarId={session.status === 'ready' ? getStoredAvatarId() : 'neutral-01'}
          name={session.status === 'ready' ? session.data.player.displayName : 'Player'}
          size="xs"
        />
      </div>
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
  return <PlayerEntryPage />
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
