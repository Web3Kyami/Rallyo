import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  api,
  ApiError,
  type OperatorBootstrap,
  type OperatorCommunity,
  type OperatorCommunityDetail,
  type OperatorOverview,
  type OperatorPlayerDetail,
  type OperatorPlayerSearchResult,
  type OperatorScoreActivity,
} from '../api/client'
import { Button, Field, Icon, LoadingState, ToneBadge } from '../components/design-system'
import '../styles/operator.css'

type OperatorState =
  | { readonly status: 'loading'; readonly data: null; readonly error: null }
  | { readonly status: 'ready'; readonly data: OperatorBootstrap; readonly error: null }
  | { readonly status: 'anonymous'; readonly data: null; readonly error: ApiError | null }

type OperatorContextValue = OperatorState & {
  readonly refresh: () => Promise<void>
  readonly logout: () => Promise<void>
}

const OperatorContext = createContext<OperatorContextValue | null>(null)

export function OperatorBoundary() {
  const [state, setState] = useState<OperatorState>({
    status: 'loading',
    data: null,
    error: null,
  })

  const refresh = async () => {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'loading', data: null, error: null }
        : current.status === 'anonymous'
          ? { status: 'loading', data: null, error: null }
          : current,
    )
    try {
      const data = await api.operatorMe()
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      setState({
        status: 'anonymous',
        data: null,
        error: error instanceof ApiError ? error : null,
      })
    }
  }

  const logout = async () => {
    await api.operatorLogout().catch(() => undefined)
    setState({ status: 'anonymous', data: null, error: null })
  }

  useEffect(() => {
    void refresh()
  }, [])

  const value = useMemo(() => ({ ...state, refresh, logout }), [state])

  if (state.status === 'loading') {
    return (
      <div className="operator-gate">
        <LoadingState label="Loading Operator console" />
      </div>
    )
  }

  if (state.status === 'anonymous') {
    return <OperatorLoginPage initialError={state.error} onAuthenticated={refresh} />
  }

  return (
    <OperatorContext.Provider value={value}>
      <OperatorShell />
    </OperatorContext.Provider>
  )
}

export function OperatorOverviewPage() {
  const operator = useOperatorSession()
  if (operator.status !== 'ready') return null
  const { overview } = operator.data

  return (
    <OperatorPage>
      <OperatorPageHeader
        eyebrow="PLATFORM OVERVIEW"
        title="The Rallyo record"
        detail="Live PostgreSQL counts across players, communities, games, tasks, scoring, and rewards."
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void operator.refresh()}>
            Refresh data
          </Button>
        }
      />
      <p className="operator-freshness">
        Generated {formatDateTime(overview.generatedAt)}. Recent score activity covers the last 7
        days.
      </p>
      <section className="operator-metric-grid" aria-label="Platform totals">
        <MetricCard
          label="Rallyo Players"
          value={overview.metrics.players}
          detail="Player records"
        />
        <MetricCard
          label="Communities"
          value={overview.metrics.communities}
          detail="Known Telegram communities"
        />
        <MetricCard
          label="Active seasons"
          value={overview.metrics.activeSeasonCommunities}
          detail="Communities with a live season"
          tone="accent"
        />
        <MetricCard
          label="Score events"
          value={overview.metrics.totalScoreEvents}
          detail={`${overview.metrics.recentScoreEvents} in the last 7 days`}
        />
      </section>

      <section className="operator-overview-grid">
        <Panel eyebrow="IDENTITY COVERAGE" title="How players connect">
          <div className="operator-split-stats">
            <SmallStat
              label="Telegram-linked Players"
              value={overview.metrics.telegramLinkedPlayers}
              detail="Telegram identities"
              icon="telegram"
            />
            <SmallStat
              label="Wallet-linked Players"
              value={overview.metrics.walletLinkedPlayers}
              detail="Active wallet links"
              icon="wallet"
            />
          </div>
          <p className="operator-note">
            Telegram group membership is not stored by Rallyo, so this surface reports linked
            identities and players with scoring history only.
          </p>
        </Panel>
        <Panel eyebrow="REWARD OPERATIONS" title="Entitlements and payout state" anchor="rewards">
          <RewardSummary metrics={overview.metrics.rewards} />
        </Panel>
      </section>

      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">GAME ACTIVITY</p>
            <h2>Games remain Telegram-native</h2>
          </div>
          <span className="operator-panel-aside">Persisted rounds and ScoreEvents</span>
        </div>
        <GameActivityTable metrics={overview.metrics.games} />
      </section>

      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">SOCIAL TASKS</p>
            <h2>Review volume</h2>
          </div>
          <span className="operator-panel-aside">All communities</span>
        </div>
        <TaskSummary metrics={overview.metrics.socialTasks} />
      </section>

      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">RECENT SCORING</p>
            <h2>Latest persisted ScoreEvents</h2>
          </div>
          <Link className="operator-inline-link" to="/operator/communities">
            Browse communities <Icon name="arrow-right" size={16} />
          </Link>
        </div>
        <ScoreActivityTable rows={overview.recentScoringActivity} />
      </section>
    </OperatorPage>
  )
}

export function OperatorCommunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('query') ?? '')
  const [communities, setCommunities] = useState<readonly OperatorCommunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (nextQuery: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.operatorCommunities(nextQuery.trim())
      setCommunities(response.communities)
    } catch (reason) {
      setError(errorMessage(reason, 'Communities could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(searchParams.get('query') ?? '')
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextQuery = query.trim()
    setSearchParams(nextQuery ? { query: nextQuery } : {})
    void load(nextQuery)
  }

  return (
    <OperatorPage>
      <OperatorPageHeader
        eyebrow="COMMUNITIES"
        title="Every community in one view"
        detail="Search by name, slug, or Telegram chat identifier. Player totals reflect players with ScoreEvents."
      />
      <form className="operator-search" onSubmit={submit}>
        <Field
          id="community-search"
          label="Find a community"
          value={query}
          placeholder="Northstar Guild or -100123456"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" icon="search" loading={loading}>
          Search communities
        </Button>
      </form>
      {error ? <OperatorInlineError detail={error} onRetry={() => void load(query)} /> : null}
      {loading ? (
        <LoadingState label="Loading communities" />
      ) : communities.length === 0 ? (
        <OperatorEmptyState
          title={query ? 'No matching communities' : 'No communities recorded'}
          detail={
            query
              ? 'Try a different name, slug, or Telegram chat identifier.'
              : 'Rallyo has no community records to show yet.'
          }
        />
      ) : (
        <div className="operator-community-list">
          {communities.map((community) => (
            <CommunityListRow community={community} key={community.id} />
          ))}
        </div>
      )}
    </OperatorPage>
  )
}

export function OperatorCommunityDetailPage() {
  const { communityId } = useParams()
  const [data, setData] = useState<OperatorCommunityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!communityId) return
    setLoading(true)
    setError(null)
    try {
      setData(await api.operatorCommunity(communityId))
    } catch (reason) {
      setError(errorMessage(reason, 'Community detail could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [communityId])

  if (loading) {
    return (
      <OperatorPage>
        <LoadingState label="Loading community" />
      </OperatorPage>
    )
  }
  if (!data) {
    return (
      <OperatorPage>
        <OperatorInlineError
          detail={error ?? 'Community detail could not be loaded.'}
          onRetry={() => void load()}
        />
        <Link className="operator-back-link" to="/operator/communities">
          <Icon name="arrow-right" size={16} /> Back to communities
        </Link>
      </OperatorPage>
    )
  }

  const { community, stats } = data
  return (
    <OperatorPage>
      <Link className="operator-back-link" to="/operator/communities">
        <Icon name="arrow-right" size={16} /> Back to communities
      </Link>
      <OperatorPageHeader
        eyebrow="COMMUNITY DETAIL"
        title={community.title}
        detail={`${community.slug} · Telegram ${community.telegramChatId} · ${community.timezone}`}
        action={<ToneBadge tone={statusTone(community.status)}>{community.status}</ToneBadge>}
      />
      <section
        className="operator-metric-grid operator-metric-grid-compact"
        aria-label="Community totals"
      >
        <MetricCard
          label="Players with scores"
          value={stats.playersWithScores}
          detail="Derived from ScoreEvents"
        />
        <MetricCard
          label="Score events"
          value={stats.scoreEventCount}
          detail="All persisted sources"
        />
        <MetricCard
          label="Active tasks"
          value={stats.activeTaskCount}
          detail="Current task records"
        />
        <MetricCard
          label="Pending reviews"
          value={stats.pendingReviewCount}
          detail="Submissions awaiting review"
          tone={stats.pendingReviewCount ? 'warning' : 'neutral'}
        />
      </section>

      <section className="operator-overview-grid">
        <Panel eyebrow="SEASON" title={data.activeSeason?.name ?? 'No active season'}>
          {data.activeSeason ? (
            <dl className="operator-detail-list">
              <DetailItem
                label="Window"
                value={`${formatDate(data.activeSeason.startsAt)} to ${formatDate(data.activeSeason.endsAt)}`}
              />
              <DetailItem label="Status" value={data.activeSeason.status} />
              <DetailItem
                label="Reward pool"
                value={
                  data.activeSeason.rewardPoolLuna
                    ? `${formatLuna(data.activeSeason.rewardPoolLuna)} Luna`
                    : 'Not recorded'
                }
              />
            </dl>
          ) : (
            <p className="operator-note">
              No season is currently ACTIVE inside its configured time window.
            </p>
          )}
          <p className="operator-note">
            Automatic rounds: {community.automaticRoundsEnabled ? 'enabled' : 'disabled'}.
          </p>
        </Panel>
        <Panel
          eyebrow="LAST MEANINGFUL ACTIVITY"
          title={
            stats.lastMeaningfulActivity
              ? formatDateTime(stats.lastMeaningfulActivity)
              : 'No activity recorded'
          }
        >
          <p className="operator-note">
            Activity is derived from scores, game rounds, and social task records. Telegram message
            volume is not presented here because only rollups are stored.
          </p>
          <div className="operator-chip-row">
            {data.games.map((game) => (
              <ToneBadge key={game.gameKey} tone={game.enabled ? 'success' : 'neutral'}>
                {gameLabel(game.gameKey)} {game.enabled ? 'enabled' : 'off'}
              </ToneBadge>
            ))}
          </div>
        </Panel>
      </section>

      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">LEADERBOARD SIGNAL</p>
            <h2>Top scored players</h2>
          </div>
          <span className="operator-panel-aside">ScoreEvents in this community</span>
        </div>
        <TopPlayersTable rows={data.topPlayers} />
      </section>
      <section className="operator-overview-grid">
        <Panel eyebrow="TASKS" title="Social task state">
          <TaskSummary metrics={data.tasks} />
        </Panel>
        <Panel eyebrow="REWARDS" title="Entitlement state">
          <RewardSummary metrics={data.rewards} />
        </Panel>
      </section>
      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">RECENT SCORING</p>
            <h2>Latest community events</h2>
          </div>
        </div>
        <ScoreActivityTable rows={data.recentScoringActivity} hideCommunity />
      </section>
    </OperatorPage>
  )
}

export function OperatorPlayersPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly OperatorPlayerSearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const performSearch = async () => {
    const value = query.trim()
    setHasSearched(true)
    setError(null)
    if (value.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      setResults((await api.operatorPlayers(value)).players)
    } catch (reason) {
      setError(errorMessage(reason, 'Player lookup could not be completed.'))
    } finally {
      setLoading(false)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void performSearch()
  }

  return (
    <OperatorPage>
      <OperatorPageHeader
        eyebrow="IDENTITY SUPPORT"
        title="Find a Rallyo Player"
        detail="Use the Player ID, Telegram numeric user ID, wallet address, or current username as a convenience search."
      />
      <form className="operator-search" onSubmit={(event) => void submit(event)}>
        <Field
          id="player-search"
          label="Stable identifier or username"
          value={query}
          placeholder="Player UUID, 123456789, NQ..., or @username"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" icon="search" loading={loading}>
          Lookup Player
        </Button>
      </form>
      <p className="operator-search-note">
        Username matches are convenience results only. The numeric Telegram user ID and wallet
        address are the authoritative link fields.
      </p>
      {error ? <OperatorInlineError detail={error} onRetry={() => void performSearch()} /> : null}
      {loading ? <LoadingState label="Searching Players" /> : null}
      {!loading && hasSearched && !error && results.length === 0 ? (
        <OperatorEmptyState
          title={query.trim().length < 2 ? 'Enter an identifier to search' : 'No Player found'}
          detail={
            query.trim().length < 2
              ? 'Use at least two characters. A username is a convenience match only.'
              : 'Try the full Player ID, Telegram numeric user ID, or wallet address.'
          }
        />
      ) : null}
      {!loading && results.length > 0 ? (
        <div className="operator-player-results">
          {results.map((player) => (
            <PlayerSearchRow key={player.id} player={player} />
          ))}
        </div>
      ) : null}
    </OperatorPage>
  )
}

export function OperatorPlayerDetailPage() {
  const { playerId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<OperatorPlayerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = async () => {
    if (!playerId) return
    setLoading(true)
    setError(null)
    try {
      setData(await api.operatorPlayer(playerId))
    } catch (reason) {
      setError(errorMessage(reason, 'Player detail could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [playerId])

  const runAction = async (key: string, action: () => Promise<string>) => {
    setActionLoading(key)
    setActionMessage(null)
    setActionError(null)
    try {
      setActionMessage(await action())
      await load()
    } catch (reason) {
      setActionError(errorMessage(reason, 'The Operator action could not be completed.'))
    } finally {
      setActionLoading(null)
    }
  }

  if (loading)
    return (
      <OperatorPage>
        <LoadingState label="Loading Player" />
      </OperatorPage>
    )
  if (!data || !playerId) {
    return (
      <OperatorPage>
        <OperatorInlineError
          detail={error ?? 'Player detail could not be loaded.'}
          onRetry={() => void load()}
        />
        <Button
          variant="secondary"
          icon="arrow-right"
          onClick={() => {
            void navigate('/operator/players')
          }}
        >
          Back to identity support
        </Button>
      </OperatorPage>
    )
  }

  const currentWallet = data.walletIdentities.find((wallet) => wallet.revokedAt === null)
  const primaryTelegram = data.telegramIdentities[0]
  return (
    <OperatorPage>
      <Link className="operator-back-link" to="/operator/players">
        <Icon name="arrow-right" size={16} /> Back to identity support
      </Link>
      <OperatorPageHeader
        eyebrow="PLAYER RECORD"
        title={primaryTelegram?.displayName ?? 'Rallyo player'}
        detail={`Player ID ${data.player.id}`}
        action={
          <ToneBadge tone={currentWallet ? 'success' : 'neutral'}>
            {currentWallet ? 'Wallet linked' : 'Wallet not linked'}
          </ToneBadge>
        }
      />
      {actionMessage ? (
        <div className="operator-action-message" role="status">
          {actionMessage}
        </div>
      ) : null}
      {actionError ? <OperatorInlineError detail={actionError} /> : null}
      <section className="operator-overview-grid">
        <Panel eyebrow="RALLYO PLAYER" title="Record and participation">
          <dl className="operator-detail-list">
            <DetailItem label="Created" value={formatDateTime(data.player.createdAt)} />
            <DetailItem label="Last seen" value={formatDateTime(data.player.lastSeenAt)} />
            <DetailItem label="Total points" value={formatNumber(data.scoreSummary.totalPoints)} />
            <DetailItem
              label="Score events"
              value={formatNumber(data.scoreSummary.totalScoreEvents)}
            />
          </dl>
          <div className="operator-chip-row">
            {data.scoreSummary.bySource.map((source) => (
              <ToneBadge key={source.sourceType}>
                {sourceLabel(source.sourceType)} {formatNumber(source.points)} pts
              </ToneBadge>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="TELEGRAM LINK" title={primaryTelegram?.displayName ?? 'Not linked'}>
          {primaryTelegram ? (
            <dl className="operator-detail-list">
              <DetailItem label="Numeric user ID" value={primaryTelegram.telegramUserId} mono />
              <DetailItem
                label="Current username"
                value={
                  primaryTelegram.username ? `@${primaryTelegram.username}` : 'No username recorded'
                }
              />
              <DetailItem label="Last seen" value={formatDateTime(primaryTelegram.lastSeenAt)} />
            </dl>
          ) : (
            <p className="operator-note">No Telegram identity is linked to this Player.</p>
          )}
        </Panel>
        <Panel
          eyebrow="WALLET LINK"
          title={currentWallet ? shortAddress(currentWallet.address) : 'Not linked'}
        >
          {data.walletIdentities.length === 0 ? (
            <p className="operator-note">No wallet identity has been linked to this Player.</p>
          ) : (
            <ul className="operator-clean-list">
              {data.walletIdentities.map((wallet) => (
                <li key={wallet.id}>
                  <strong className="operator-mono">{wallet.address}</strong>
                  <span>
                    {wallet.revokedAt
                      ? `Revoked ${formatDate(wallet.revokedAt)}`
                      : `Linked ${formatDate(wallet.linkedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="operator-panel operator-recovery-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">SAFE RECOVERY ACTIONS</p>
            <h2>Identity link controls</h2>
          </div>
          <ToneBadge tone="warning" icon="shield">
            Audited actions
          </ToneBadge>
        </div>
        <p className="operator-note">
          These actions preserve scores, community history, tasks, and rewards. Wallet attachment
          still requires proof of wallet ownership through the normal wallet challenge.
        </p>
        <div className="operator-action-grid">
          <div className="operator-action-card">
            <div>
              <h3>Revoke wallet link</h3>
              <p>
                {currentWallet
                  ? `Revoke ${shortAddress(currentWallet.address)}. This does not delete history.`
                  : 'No active wallet link is available.'}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={!currentWallet}
              loading={actionLoading === 'wallet'}
              onClick={() => {
                if (
                  !currentWallet ||
                  !window.confirm(
                    'Revoke this active wallet link? Scores and rewards will stay in the Player record.',
                  )
                )
                  return
                void runAction('wallet', async () => {
                  const result = await api.operatorRevokeWallet(data.player.id, currentWallet.id)
                  return `Wallet link revoked. ${result.pendingRewardCount ? `${result.pendingRewardCount} reward record(s) may need a new wallet before payout.` : 'No pending reward records were found.'}`
                })
              }}
            >
              Revoke wallet link
            </Button>
          </div>
          <div className="operator-action-card">
            <div>
              <h3>Revoke unused pairing codes</h3>
              <p>
                {data.recovery.unusedPairingCodes
                  ? `${data.recovery.unusedPairingCodes} active code(s) can be revoked.`
                  : 'No unused pairing codes are active.'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={actionLoading === 'pairing'}
              onClick={() =>
                void runAction('pairing', async () => {
                  const result = await api.operatorRevokePairingCodes(data.player.id)
                  return `${result.revokedCount} unused Telegram pairing code(s) revoked.`
                })
              }
            >
              Revoke codes
            </Button>
          </div>
          <div className="operator-action-card">
            <div>
              <h3>Prepare recovery pairing</h3>
              <p>
                {primaryTelegram
                  ? 'Issue a one-time code for the existing Telegram identity. Share it through a trusted channel.'
                  : 'Unavailable because this Player has no Telegram identity.'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!primaryTelegram}
              loading={actionLoading === 'recovery'}
              onClick={() =>
                void runAction('recovery', async () => {
                  const result = await api.operatorPrepareRecovery(data.player.id)
                  return `Recovery code ${result.code} is ready until ${formatDateTime(result.expiresAt)}. It is shown once, so copy it to a trusted channel now.`
                })
              }
            >
              Prepare code
            </Button>
          </div>
        </div>
      </section>

      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">COMMUNITY HISTORY</p>
            <h2>Participation by community</h2>
          </div>
        </div>
        <PlayerCommunityTable rows={data.communities} />
      </section>
      <section className="operator-overview-grid">
        <Panel eyebrow="ADMIN ROLES" title="Server-authorized roles">
          <AdminRoles data={data} />
        </Panel>
        <Panel eyebrow="REWARDS" title="Entitlements">
          <RewardEntitlements data={data} />
        </Panel>
      </section>
      <section className="operator-panel">
        <div className="operator-panel-heading">
          <div>
            <p className="operator-eyebrow">AUDIT TRAIL</p>
            <h2>Operator actions for this Player</h2>
          </div>
        </div>
        {data.audit.length === 0 ? (
          <OperatorEmptyState
            title="No recovery actions recorded"
            detail="Wallet and pairing actions will appear here after an Operator performs them."
          />
        ) : (
          <AuditList data={data} />
        )}
      </section>
    </OperatorPage>
  )
}

function OperatorLoginPage({
  initialError,
  onAuthenticated,
}: {
  readonly initialError: ApiError | null
  readonly onAuthenticated: () => Promise<void>
}) {
  const [accessKey, setAccessKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    initialError ? errorMessage(initialError, '') : null,
  )
  const unavailable = initialError?.status === 404 || initialError?.status === 503

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (unavailable) return
    setLoading(true)
    setError(null)
    try {
      await api.operatorLogin(accessKey)
      await onAuthenticated()
    } catch (reason) {
      setError(errorMessage(reason, 'Operator access was denied.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="operator-gate">
      <div className="operator-login-card">
        <Link className="operator-login-brand" to="/" aria-label="Rallyo home">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>RALLYO</span>
        </Link>
        <p className="operator-eyebrow">PRIVATE OPERATOR SURFACE</p>
        <h1>Owner session required.</h1>
        <p>
          Sign in with the server-configured Operator access key. Player and community admin
          sessions cannot cross this boundary.
        </p>
        {unavailable ? (
          <div className="operator-unavailable" role="alert">
            {error ?? 'Operator access is not configured on this server.'}
          </div>
        ) : null}
        {!unavailable ? (
          <form
            className="operator-login-form"
            onSubmit={(event) => {
              void submit(event)
            }}
          >
            <input
              className="operator-login-username"
              type="text"
              name="username"
              autoComplete="username"
              value="operator"
              readOnly
              aria-hidden="true"
              tabIndex={-1}
            />
            <Field
              id="operator-access-key"
              type="password"
              label="Operator access key"
              value={accessKey}
              autoComplete="current-password"
              onChange={(event) => setAccessKey(event.target.value)}
              {...(error ? { error } : {})}
            />
            <Button type="submit" loading={loading} icon="lock">
              Open console
            </Button>
          </form>
        ) : null}
        <Link className="operator-back-link" to="/">
          <Icon name="arrow-right" size={16} /> Return to Rallyo
        </Link>
      </div>
    </div>
  )
}

function OperatorShell() {
  const operator = useOperatorSession()
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="operator-app">
      <aside className="operator-sidebar">
        <Link className="operator-brand" to="/" aria-label="Rallyo home">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>RALLYO</span>
        </Link>
        <div className="operator-rail-context">
          <p className="operator-eyebrow">OPERATOR CONSOLE</p>
          <strong>Platform operations</strong>
          <span>Owner session</span>
        </div>
        <nav className="operator-nav" aria-label="Operator navigation">
          <OperatorNavLink to="/operator" label="Overview" icon="home" end />
          <OperatorNavLink to="/operator/communities" label="Communities" icon="users" />
          <OperatorNavLink to="/operator/players" label="Identity support" icon="user" />
        </nav>
        <div className="operator-sidebar-footer">
          <span className="operator-session-state">
            <span className="operator-live-dot" /> Live database session
          </span>
          <button className="operator-logout" type="button" onClick={() => void operator.logout()}>
            Sign out <Icon name="arrow-up-right" size={15} />
          </button>
        </div>
      </aside>
      <div className="operator-main">
        <header className="operator-mobile-header">
          <Link className="operator-brand" to="/operator" aria-label="Operator overview">
            <span className="brand-mark" aria-hidden="true">
              R
            </span>
            <span>RALLYO</span>
          </Link>
          <button
            className="operator-menu-button"
            type="button"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((current) => !current)}
          >
            <Icon name={mobileOpen ? 'x' : 'list'} size={21} label="Toggle navigation" />
          </button>
        </header>
        {mobileOpen ? (
          <nav className="operator-mobile-nav" aria-label="Operator navigation">
            <OperatorNavLink
              to="/operator"
              label="Overview"
              icon="home"
              end
              onNavigate={() => setMobileOpen(false)}
            />
            <OperatorNavLink
              to="/operator/communities"
              label="Communities"
              icon="users"
              onNavigate={() => setMobileOpen(false)}
            />
            <OperatorNavLink
              to="/operator/players"
              label="Identity support"
              icon="user"
              onNavigate={() => setMobileOpen(false)}
            />
          </nav>
        ) : null}
        <main className="operator-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function OperatorPage({ children }: { readonly children: ReactNode }) {
  return <div className="operator-page">{children}</div>
}

function OperatorPageHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly detail: string
  readonly action?: ReactNode
}) {
  return (
    <header className="operator-page-header">
      <div>
        <p className="operator-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="operator-page-detail">{detail}</p>
      </div>
      {action ? <div className="operator-page-action">{action}</div> : null}
    </header>
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  readonly label: string
  readonly value: number
  readonly detail: string
  readonly tone?: 'neutral' | 'accent' | 'warning'
}) {
  return (
    <article className={`operator-metric-card operator-metric-card-${tone}`}>
      <p>{label}</p>
      <strong>{formatNumber(value)}</strong>
      <span>{detail}</span>
    </article>
  )
}

function Panel({
  eyebrow,
  title,
  children,
  anchor,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly children: ReactNode
  readonly anchor?: string
}) {
  return (
    <section className="operator-panel" id={anchor}>
      <div className="operator-panel-heading">
        <div>
          <p className="operator-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  )
}

function SmallStat({
  label,
  value,
  detail,
  icon,
}: {
  readonly label: string
  readonly value: number
  readonly detail: string
  readonly icon: 'telegram' | 'wallet'
}) {
  return (
    <div className="operator-small-stat">
      <span className="operator-stat-icon">
        <Icon name={icon} size={19} />
      </span>
      <div>
        <strong>{formatNumber(value)}</strong>
        <p>{label}</p>
        <span>{detail}</span>
      </div>
    </div>
  )
}

function RewardSummary({ metrics }: { readonly metrics: OperatorOverview['metrics']['rewards'] }) {
  const statuses: readonly ['ELIGIBLE' | 'CLAIMING' | 'SENT' | 'CONFIRMED' | 'FAILED', string][] = [
    ['ELIGIBLE', 'Eligible'],
    ['CLAIMING', 'Claiming'],
    ['SENT', 'Sent'],
    ['CONFIRMED', 'Confirmed'],
    ['FAILED', 'Failed'],
  ]
  return (
    <>
      <div className="operator-reward-total">
        <strong>{formatNumber(metrics.total)}</strong>
        <span>entitlements, {formatLuna(metrics.totalAmountLuna)} Luna recorded</span>
      </div>
      <div className="operator-status-grid">
        {statuses.map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{formatNumber(metrics.byStatus[key])}</strong>
          </div>
        ))}
      </div>
    </>
  )
}

function GameActivityTable({
  metrics,
}: {
  readonly metrics: OperatorOverview['metrics']['games']
}) {
  const rows = [
    [
      'project_quiz',
      metrics.projectQuiz.rounds,
      metrics.projectQuiz.activeRounds,
      metrics.projectQuiz.scoreEvents,
    ],
    [
      'scramble',
      metrics.scramble.rounds,
      metrics.scramble.activeRounds,
      metrics.scramble.scoreEvents,
    ],
    [
      'word_seek',
      metrics.wordSeek.sessions,
      metrics.wordSeek.activeSessions,
      metrics.wordSeek.scoreEvents,
    ],
  ] as const
  return (
    <div className="operator-table-wrap">
      <table className="operator-table">
        <thead>
          <tr>
            <th>Game</th>
            <th>Persisted sessions</th>
            <th>Live now</th>
            <th>ScoreEvents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, total, active, scores]) => (
            <tr key={key}>
              <th>{gameLabel(key)}</th>
              <td>{formatNumber(total)}</td>
              <td>{formatNumber(active)}</td>
              <td>{formatNumber(scores)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TaskSummary({
  metrics,
}: {
  readonly metrics: OperatorOverview['metrics']['socialTasks']
}) {
  return (
    <div className="operator-task-summary">
      <div className="operator-task-main">
        <strong>{formatNumber(metrics.pending)}</strong>
        <span>pending submissions</span>
      </div>
      <div className="operator-status-grid">
        <div>
          <span>Active tasks</span>
          <strong>{formatNumber(metrics.active)}</strong>
        </div>
        <div>
          <span>Total submissions</span>
          <strong>{formatNumber(metrics.submissions)}</strong>
        </div>
        <div>
          <span>Approved</span>
          <strong>{formatNumber(metrics.approved)}</strong>
        </div>
        <div>
          <span>Rejected</span>
          <strong>{formatNumber(metrics.rejected)}</strong>
        </div>
      </div>
    </div>
  )
}

function ScoreActivityTable({
  rows,
  hideCommunity = false,
}: {
  readonly rows: readonly OperatorScoreActivity[]
  readonly hideCommunity?: boolean
}) {
  if (rows.length === 0)
    return (
      <OperatorEmptyState
        title="No scoring activity recorded"
        detail="ScoreEvents will appear here when Telegram gameplay or a scored task creates them."
      />
    )
  return (
    <div className="operator-table-wrap">
      <table className="operator-table operator-activity-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Player</th>
            {hideCommunity ? null : <th>Community</th>}
            <th>Source</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDateTime(row.createdAt)}</td>
              <td>
                <Link to={`/operator/players/${row.playerId}`} className="operator-table-link">
                  {row.playerName}
                </Link>
              </td>
              {hideCommunity ? null : (
                <td>
                  <Link
                    to={`/operator/communities/${row.communityId}`}
                    className="operator-table-link"
                  >
                    {row.communityTitle}
                  </Link>
                </td>
              )}
              <td>
                <ToneBadge>{sourceLabel(row.sourceType)}</ToneBadge>
              </td>
              <td className="operator-points">+{formatNumber(row.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TopPlayersTable({ rows }: { readonly rows: OperatorCommunityDetail['topPlayers'] }) {
  if (rows.length === 0)
    return (
      <OperatorEmptyState
        title="No scored players"
        detail="This community has no ScoreEvents yet."
      />
    )
  return (
    <div className="operator-table-wrap">
      <table className="operator-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>ScoreEvents</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId}>
              <td className="operator-rank">{String(row.rank).padStart(2, '0')}</td>
              <td>
                <Link to={`/operator/players/${row.playerId}`} className="operator-table-link">
                  {row.displayName}
                </Link>
              </td>
              <td>{formatNumber(row.scoreEventCount)}</td>
              <td className="operator-points">{formatNumber(row.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CommunityListRow({ community }: { readonly community: OperatorCommunity }) {
  return (
    <Link className="operator-community-row" to={`/operator/communities/${community.id}`}>
      <div className="operator-community-main">
        <div className="operator-list-title">
          <h2>{community.title}</h2>
          <ToneBadge tone={statusTone(community.status)}>{community.status}</ToneBadge>
        </div>
        <p>
          {community.slug} · Telegram {community.telegramChatId}
        </p>
        <div className="operator-chip-row">
          {community.games.map((game) => (
            <ToneBadge key={game.gameKey} tone={game.enabled ? 'success' : 'neutral'}>
              {gameLabel(game.gameKey)}
            </ToneBadge>
          ))}
        </div>
      </div>
      <div className="operator-community-facts">
        <Fact label="Season" value={community.activeSeason?.name ?? 'None'} />
        <Fact label="Players" value={formatNumber(community.playersWithScores)} />
        <Fact label="Events" value={formatNumber(community.scoreEventCount)} />
        <Fact
          label="Last activity"
          value={
            community.lastMeaningfulActivity
              ? formatDateTime(community.lastMeaningfulActivity)
              : 'None'
          }
        />
      </div>
      <Icon name="arrow-up-right" size={19} />
    </Link>
  )
}

function PlayerSearchRow({ player }: { readonly player: OperatorPlayerSearchResult }) {
  return (
    <Link className="operator-player-row" to={`/operator/players/${player.id}`}>
      <div>
        <div className="operator-list-title">
          <h2>{player.displayName}</h2>
          {player.username ? <span className="operator-username">@{player.username}</span> : null}
        </div>
        <p className="operator-mono">{player.id}</p>
      </div>
      <Fact label="Telegram ID" value={player.telegramUserId ?? 'Not linked'} />
      <Fact
        label="Wallet"
        value={player.walletAddress ? shortAddress(player.walletAddress) : 'Not linked'}
      />
      <Fact label="Points" value={formatNumber(player.totalPoints)} />
      <Icon name="arrow-up-right" size={19} />
    </Link>
  )
}

function PlayerCommunityTable({ rows }: { readonly rows: OperatorPlayerDetail['communities'] }) {
  if (rows.length === 0)
    return (
      <OperatorEmptyState
        title="No scored communities"
        detail="This Player has no ScoreEvents linked to a community."
      />
    )
  return (
    <div className="operator-table-wrap">
      <table className="operator-table">
        <thead>
          <tr>
            <th>Community</th>
            <th>Status</th>
            <th>ScoreEvents</th>
            <th>Points</th>
            <th>Last score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.communityId}>
              <td>
                <Link
                  className="operator-table-link"
                  to={`/operator/communities/${row.communityId}`}
                >
                  {row.communityTitle}
                </Link>
              </td>
              <td>
                <ToneBadge tone={statusTone(row.communityStatus)}>{row.communityStatus}</ToneBadge>
              </td>
              <td>{formatNumber(row.scoreEventCount)}</td>
              <td className="operator-points">{formatNumber(row.points)}</td>
              <td>{row.lastScoreAt ? formatDateTime(row.lastScoreAt) : 'None'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminRoles({ data }: { readonly data: OperatorPlayerDetail }) {
  if (data.adminRoles.length === 0)
    return (
      <p className="operator-note">
        No current Community Admin roles are linked to this Player's Telegram identities.
      </p>
    )
  return (
    <ul className="operator-clean-list">
      {data.adminRoles.map((role) => (
        <li key={`${role.communityId}:${role.telegramUserId}`}>
          <strong>{role.communityTitle}</strong>
          <span>
            Telegram {role.telegramUserId}, verified {formatDate(role.lastVerifiedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function RewardEntitlements({ data }: { readonly data: OperatorPlayerDetail }) {
  if (data.rewards.length === 0)
    return <p className="operator-note">No reward entitlements recorded.</p>
  return (
    <ul className="operator-clean-list">
      {data.rewards.slice(0, 5).map((reward) => (
        <li key={reward.id}>
          <strong>
            {formatLuna(reward.amountLuna)} Luna, rank {reward.rank}
          </strong>
          <span>
            {reward.communityTitle} · {reward.seasonName} · {reward.status}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AuditList({ data }: { readonly data: OperatorPlayerDetail }) {
  return (
    <ul className="operator-audit-list">
      {data.audit.map((event) => (
        <li key={event.id}>
          <div>
            <strong>{event.action}</strong>
            <span>{formatDateTime(event.createdAt)}</span>
          </div>
          <code>{JSON.stringify(event.metadata)}</code>
        </li>
      ))}
    </ul>
  )
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="operator-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'operator-mono' : undefined}>{value}</dd>
    </div>
  )
}

function OperatorNavLink({
  to,
  label,
  icon,
  end,
  onNavigate,
}: {
  readonly to: string
  readonly label: string
  readonly icon: 'home' | 'users' | 'user'
  readonly end?: boolean
  readonly onNavigate?: () => void
}) {
  return (
    <NavLink
      className="operator-nav-link"
      to={to}
      {...(end ? { end: true } : {})}
      {...(onNavigate ? { onClick: onNavigate } : {})}
    >
      <Icon name={icon} size={19} />
      <span>{label}</span>
    </NavLink>
  )
}

function OperatorEmptyState({
  title,
  detail,
}: {
  readonly title: string
  readonly detail: string
}) {
  return (
    <div className="operator-empty">
      <Icon name="search" size={22} />
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function OperatorInlineError({
  detail,
  onRetry,
}: {
  readonly detail: string
  readonly onRetry?: () => void
}) {
  return (
    <div className="operator-inline-error" role="alert">
      <Icon name="warning" size={20} />
      <span>{detail}</span>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

function useOperatorSession() {
  const context = useContext(OperatorContext)
  if (!context) throw new Error('useOperatorSession must be used inside OperatorBoundary.')
  return context
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.message : fallback
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatLuna(value: string) {
  try {
    return new Intl.NumberFormat('en-US').format(Number(BigInt(value)))
  } catch {
    return value
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function shortAddress(value: string) {
  return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value
}

function sourceLabel(value: string) {
  return value === 'QUIZ'
    ? 'Quiz / Race'
    : value === 'WORD_SEEK'
      ? 'Word Seek'
      : value === 'SOCIAL_TASK'
        ? 'Social task'
        : value === 'SCRAMBLE'
          ? 'Scramble'
          : 'Manual'
}

function gameLabel(value: string) {
  return value === 'project_quiz' ? 'Quiz / Race' : value === 'word_seek' ? 'Word Seek' : 'Scramble'
}

function statusTone(value: string): 'success' | 'warning' | 'danger' | 'neutral' {
  return value === 'ACTIVE'
    ? 'success'
    : value === 'PAUSED' || value === 'DRAFT'
      ? 'warning'
      : value === 'ARCHIVED' || value === 'CLOSED'
        ? 'neutral'
        : 'danger'
}
