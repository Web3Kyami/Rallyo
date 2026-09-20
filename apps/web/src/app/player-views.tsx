import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  api,
  ApiError,
  type AppCommunity,
  type AppCommunityDetail,
  type AppLeaderboardEntry,
  type AppRewards,
  type AppTask,
  type AppTaskDetail,
  type GlobalLeague,
  type RallyoProgression,
} from '../api/client'
import {
  Avatar,
  Button,
  CommunityCard,
  EmptyState,
  ErrorState,
  GameCard,
  Icon,
  LeaderboardRow,
  PageFrame,
  RankBlock,
  RallyoBrand,
  SectionLabel,
  StatusBanner,
  Tabs,
  ToneBadge,
} from '../components/design-system'
import { authenticateWithNimiq } from '../platform/wallet'
import { useAppSession } from './session'
import {
  avatarOptions,
  avatarStyles,
  filterPlayerTasks,
  formatDate,
  formatDateTime,
  formatDeadline,
  getLeagueAvatarId,
  hasStoredAvatarId,
  getStoredAvatarId,
  shortAddress,
  storeAvatarId,
  taskState,
  type PlayerTaskFilter,
} from './player-data'

type ResourceState<T> =
  | { readonly status: 'idle' | 'loading'; readonly data: null; readonly error: null }
  | { readonly status: 'ready'; readonly data: T; readonly error: null }
  | { readonly status: 'error'; readonly data: null; readonly error: Error }

function useResource<T>(
  load: () => Promise<T>,
  enabled = true,
): ResourceState<T> & { readonly retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ResourceState<T>>({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
  })

  useEffect(() => {
    let current = true
    if (!enabled) {
      setState({ status: 'idle', data: null, error: null })
      return () => {
        current = false
      }
    }

    setState({ status: 'loading', data: null, error: null })
    void load()
      .then((data) => {
        if (current) setState({ status: 'ready', data, error: null })
      })
      .catch((reason: unknown) => {
        if (!current) return
        setState({
          status: 'error',
          data: null,
          error: reason instanceof Error ? reason : new Error('Rallyo could not load this state.'),
        })
      })

    return () => {
      current = false
    }
  }, [attempt, enabled, load])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

function resourceError(
  state: { readonly status: string; readonly error: Error | null },
  fallback: string,
) {
  return state.error instanceof ApiError ? state.error.message : (state.error?.message ?? fallback)
}

function BackLink({
  to,
  children = 'Back',
}: {
  readonly to: string
  readonly children?: ReactNode
}) {
  return (
    <Link className="player-back-link" to={to}>
      <Icon name="arrow-right" size={17} />
      {children}
    </Link>
  )
}

export function PlayerEntryPage() {
  const session = useAppSession()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [telegramStage, setTelegramStage] = useState<'choice' | 'username' | 'code'>('choice')
  const [state, setState] = useState<'idle' | 'requesting' | 'exchanging' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null)
  const [botUrl, setBotUrl] = useState<string | null>(null)

  if (session.status === 'ready') return <Navigate replace to="/app" />

  const exchange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setState('exchanging')
    setError(null)
    try {
      const result = await api.exchangeTelegramPairing(code.trim())
      await session.refresh()
      void navigate(result.redirectPath, { replace: true })
    } catch (reason: unknown) {
      setState('error')
      setError(
        reason instanceof ApiError
          ? reason.message
          : 'The Telegram pairing code could not be used.',
      )
    }
  }

  const requestPairing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setState('requesting')
    setError(null)
    try {
      const result = await api.requestTelegramPairing(username.trim())
      setBotUrl(result.botUrl)
      setTelegramMessage(
        'If Rallyo knows this account, a pairing code was sent in Telegram. If no code arrives, start Rallyo Bot first, then try again.',
      )
      setTelegramStage('code')
      setState('idle')
    } catch (reason: unknown) {
      setState('error')
      setError(
        reason instanceof ApiError ? reason.message : 'Telegram pairing could not be started.',
      )
    }
  }

  const openTelegram = () => {
    setTelegramStage('username')
    setState('idle')
    setError(null)
  }

  const enterCode = () => {
    setTelegramStage('code')
    setState('idle')
    setError(null)
    setTelegramMessage('Enter the one-time code from Rallyo Bot.')
  }

  const onWalletAuthenticated = async (redirectPath: string) => {
    await session.refresh()
    void navigate(
      redirectPath === '/app' && !hasStoredAvatarId() ? '/app/onboarding/avatar' : redirectPath,
      { replace: true },
    )
  }

  return (
    <div className="entry-gate player-entry-gate">
      <div className="entry-card player-entry-card">
        <RallyoBrand />
        <h1>Play. Compete. Contribute.</h1>
        <p className="entry-intro">Games, tasks, seasons, and rewards in one Rallyo record.</p>

        {telegramStage === 'choice' ? (
          <>
            <div className="entry-primary-method is-wallet">
              <SectionLabel>CONNECT NIMIQ</SectionLabel>
              <WalletSignInButton enabled onAuthenticated={onWalletAuthenticated} />
            </div>
            <div className="entry-secondary-method">
              <SectionLabel>CONNECT TELEGRAM</SectionLabel>
              <Button type="button" variant="secondary" icon="telegram" onClick={openTelegram}>
                Connect Telegram
              </Button>
            </div>
          </>
        ) : null}

        {telegramStage === 'username' ? (
          <div className="entry-primary-method entry-telegram-step">
            <SectionLabel>CONNECT TELEGRAM</SectionLabel>
            <h2>Find your Telegram account</h2>
            <p className="entry-step-copy">Use the username you use with Rallyo Bot.</p>
            <form className="entry-code-form" onSubmit={(event) => void requestPairing(event)}>
              <label htmlFor="entry-telegram-username">Telegram username</label>
              <input
                id="entry-telegram-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                inputMode="text"
                maxLength={64}
                placeholder="@username"
                required
              />
              <Button type="submit" loading={state === 'requesting'} icon="telegram">
                Send me a code
              </Button>
            </form>
            <button className="text-button entry-step-link" type="button" onClick={enterCode}>
              I already have a pairing code
            </button>
            {state === 'error' ? (
              <p className="entry-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="text-button entry-step-link"
              type="button"
              onClick={() => setTelegramStage('choice')}
            >
              Back
            </button>
          </div>
        ) : null}

        {telegramStage === 'code' ? (
          <div className="entry-primary-method entry-telegram-step">
            <SectionLabel>CONNECT TELEGRAM</SectionLabel>
            <h2>Enter your pairing code</h2>
            <p className="entry-step-copy">
              {telegramMessage ?? 'Enter the one-time code from Rallyo Bot.'}
            </p>
            <form className="entry-code-form" onSubmit={(event) => void exchange(event)}>
              <label htmlFor="entry-pairing-code">Telegram pairing code</label>
              <input
                id="entry-pairing-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={100}
                placeholder="6 to 8 characters"
                required
              />
              <Button type="submit" loading={state === 'exchanging'} icon="arrow-right">
                Connect Telegram
              </Button>
            </form>
            {botUrl ? (
              <a className="button button-outline" href={botUrl} target="_blank" rel="noreferrer">
                Open Rallyo Bot
              </a>
            ) : null}
            {state === 'error' ? (
              <p className="entry-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="text-button entry-step-link" type="button" onClick={openTelegram}>
              Try another username
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function WalletSignInButton({
  disabledReason,
  enabled,
  label = 'Connect Nimiq',
  onAuthenticated,
  variant = 'primary',
}: {
  readonly disabledReason?: string
  readonly enabled: boolean
  readonly label?: string
  readonly onAuthenticated: (redirectPath: string) => Promise<void>
  readonly variant?: 'primary' | 'secondary'
}) {
  const [state, setState] = useState<'idle' | 'signing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (!enabled) {
    return (
      <p className="entry-note wallet-entry-unavailable">
        {disabledReason ?? 'Connect Nimiq to continue.'}
      </p>
    )
  }

  const signIn = async () => {
    setState('signing')
    setError(null)
    try {
      const result = await authenticateWithNimiq()
      await onAuthenticated(result.redirectPath)
    } catch (reason: unknown) {
      setState('error')
      setError(reason instanceof Error ? reason.message : 'Nimiq sign-in could not be completed.')
    }
  }

  return (
    <div className="wallet-entry-control">
      <Button
        type="button"
        variant={variant}
        icon="wallet"
        loading={state === 'signing'}
        onClick={() => void signIn()}
      >
        {state === 'signing' ? 'Signing in' : label}
      </Button>
      {state === 'error' ? (
        <p className="entry-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function PlayerAvatarOnboardingPage() {
  const session = useAppSession()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(getStoredAvatarId())

  if (session.status !== 'ready') return null

  const save = () => {
    storeAvatarId(selected)
    void navigate('/app', { replace: true })
  }

  return (
    <PageFrame
      eyebrow="FIRST RUN"
      title="Choose your Rallyo avatar"
      detail="Pick a style that will identify you in your Player surfaces. You can change it later."
      action={<BackLink to="/app">Skip for now</BackLink>}
    >
      <AvatarPicker selected={selected} onSelect={setSelected} />
      <div className="avatar-onboarding-actions">
        <Button type="button" icon="check" onClick={save}>
          Use this avatar
        </Button>
        <p className="page-note">
          This choice is saved on this device while profile avatar storage is being added.
        </p>
      </div>
    </PageFrame>
  )
}

function AvatarPicker({
  selected,
  onSelect,
}: {
  readonly selected: string
  readonly onSelect: (id: string) => void
}) {
  const selectedOption = avatarOptions.find((option) => option.id === selected) ?? avatarOptions[0]
  const [style, setStyle] = useState<(typeof avatarStyles)[number]['id']>(
    selectedOption?.style ?? 'neutral',
  )
  const options = avatarOptions.filter((option) => option.style === style)

  return (
    <section className="avatar-picker">
      <div className="avatar-picker-preview">
        <Avatar avatarId={selected} name={selectedOption?.label ?? 'Selected avatar'} size="hero" />
        <div>
          <SectionLabel>SELECTED</SectionLabel>
          <strong>{selectedOption?.label ?? 'Neutral 1'}</strong>
          <p>Recognizable at a glance across ranks and communities.</p>
        </div>
      </div>
      <Tabs
        items={avatarStyles.map((avatarStyle) => ({
          value: avatarStyle.id,
          label: avatarStyle.label,
        }))}
        value={style}
        onChange={(value) => setStyle(value as (typeof avatarStyles)[number]['id'])}
      />
      <div className="avatar-option-grid">
        {options.map((option) => (
          <button
            className={`avatar-option${option.id === selected ? ' is-selected' : ''}`}
            key={option.id}
            type="button"
            aria-pressed={option.id === selected}
            onClick={() => onSelect(option.id)}
          >
            <Avatar avatarId={option.id} name={option.label} size="lg" />
            <span>{option.label}</span>
            {option.id === selected ? <Icon name="check" size={17} /> : null}
          </button>
        ))}
      </div>
    </section>
  )
}

export function PlayerHomePage() {
  const session = useAppSession()
  const data = session.status === 'ready' ? session.data : null
  const communities = data?.communities ?? []
  const tasksLoad = useCallback(() => api.tasks(), [])
  const tasks = useResource(tasksLoad, communities.length > 0)
  const taskCounts = useMemo(() => {
    if (tasks.status !== 'ready') return new Map<string, number>()
    return tasks.data.tasks.reduce((counts, task) => {
      counts.set(task.communityId, (counts.get(task.communityId) ?? 0) + 1)
      return counts
    }, new Map<string, number>())
  }, [tasks])
  const [progression, setProgression] = useState<RallyoProgression | null>(
    data?.progression ?? null,
  )
  const [checkinOpen, setCheckinOpen] = useState(() =>
    Boolean(data && !data.progression.todayClaimed),
  )
  const [checkinState, setCheckinState] = useState<
    'idle' | 'claiming' | 'success' | 'already' | 'error'
  >('idle')
  const [checkinError, setCheckinError] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setProgression(data.progression)
    if (!data.progression.todayClaimed && checkinState === 'idle') setCheckinOpen(true)
  }, [checkinState, data])

  if (!data) return null
  const { player } = data
  const currentProgression = progression ?? data.progression

  const visibleCommunities = communities.slice(0, 3)
  const hasMoreCommunities = communities.length > visibleCommunities.length

  return (
    <PageFrame
      eyebrow="PLAYER HOME"
      title={`Welcome back, ${player.displayName}.`}
      detail="Your communities, seasons, and next tasks."
    >
      <RallyoProgressionSummary progression={currentProgression} />

      {checkinOpen ? (
        <DailyCheckinDialog
          error={checkinError}
          state={checkinState}
          onClaim={async () => {
            setCheckinState('claiming')
            setCheckinError(null)
            try {
              const result = await api.claimDailyCheckin()
              setCheckinState(result.claimed ? 'success' : 'already')
              await session.refresh()
              setProgression(result.progression)
              window.setTimeout(() => setCheckinOpen(false), result.claimed ? 900 : 0)
            } catch (reason: unknown) {
              setCheckinState('error')
              setCheckinError(
                reason instanceof ApiError
                  ? reason.message
                  : 'Daily check-in could not be claimed.',
              )
            }
          }}
          onClose={() => setCheckinOpen(false)}
        />
      ) : null}
      {!player.username ? (
        <StatusBanner
          icon="telegram"
          title="Connect Telegram to restore your communities"
          detail="Your seasons, tasks, and admin access will appear here."
          action={
            <Link className="button button-primary" to="/app/pair">
              Connect Telegram
            </Link>
          }
        />
      ) : null}

      <section className="home-section home-communities-section">
        <div className="home-section-heading">
          <div>
            <SectionLabel>YOUR COMMUNITIES</SectionLabel>
            <h2>{communities.length ? 'Where you compete' : 'No communities yet'}</h2>
          </div>
          {hasMoreCommunities ? (
            <Link className="text-button" to="/app/communities">
              View all
            </Link>
          ) : null}
        </div>
        {tasks.status === 'error' ? (
          <ErrorState
            title="Task status is unavailable"
            detail={resourceError(tasks, 'Active task counts could not be loaded.')}
            onRetry={tasks.retry}
          />
        ) : null}
        {communities.length > 0 ? (
          <div className="community-list-grid">
            {visibleCommunities.map((community) => (
              <CommunityListItem
                community={community}
                key={community.id}
                taskCount={taskCounts.get(community.id) ?? 0}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Your first community record is waiting."
            detail={
              player.username
                ? 'Join a Rallyo community in Telegram to start building a real score.'
                : 'Connect Telegram to bring in your Rallyo communities and season history.'
            }
            action={
              <Link
                className="button button-primary"
                to={player.username ? '/app/communities' : '/app/pair'}
              >
                {player.username ? 'View communities' : 'Connect Telegram'}
              </Link>
            }
          />
        )}
      </section>

      {tasks.status === 'ready' && tasks.data.tasks.length > 0 ? (
        <section className="home-section home-task-summary">
          <div className="home-section-heading compact">
            <div>
              <SectionLabel>ACTIVE TASKS</SectionLabel>
              <h2>Keep moving</h2>
            </div>
            <Link className="text-button" to="/app/tasks">
              View tasks
            </Link>
          </div>
          <p>
            {tasks.data.tasks.length} active task{tasks.data.tasks.length === 1 ? '' : 's'} across
            your communities.
          </p>
        </section>
      ) : null}
    </PageFrame>
  )
}

function LoadingLines({ label }: { readonly label: string }) {
  return (
    <div className="loading-lines" role="status">
      <span className="loading-lines-mark" />
      <strong>{label}</strong>
    </div>
  )
}

export function PlayerCommunitiesPage() {
  const session = useAppSession()
  const load = useCallback(() => api.listCommunities(), [])
  const result = useResource(load)
  if (session.status !== 'ready') return null

  return (
    <PageFrame
      eyebrow="COMMUNITIES"
      title="Your communities"
      detail="One Rallyo Player, separate records for every community where you compete."
    >
      {result.status === 'loading' ? <LoadingLines label="Loading communities" /> : null}
      {result.status === 'error' ? (
        <ErrorState
          title="Communities are unavailable"
          detail={resourceError(result, 'The community list could not be loaded.')}
          onRetry={result.retry}
        />
      ) : null}
      {result.status === 'ready' && result.data.communities.length === 0 ? (
        <EmptyState
          title="No community record yet"
          detail="Connect Telegram to restore your communities and season history."
          action={
            <Link className="button button-primary" to="/app/pair">
              Connect Telegram
            </Link>
          }
        />
      ) : null}
      {result.status === 'ready' && result.data.communities.length > 0 ? (
        <div className="community-list-grid">
          {result.data.communities.map((community) => (
            <CommunityListItem community={community} key={community.id} />
          ))}
        </div>
      ) : null}
    </PageFrame>
  )
}

function CommunityListItem({
  community,
  taskCount = 0,
}: {
  readonly community: AppCommunity
  readonly taskCount?: number
}) {
  return (
    <CommunityCard
      name={community.title}
      titleAction={
        <Link className="community-card-title-link" to={`/app/communities/${community.id}`}>
          {community.title}
        </Link>
      }
      season={community.activeSeason?.name ?? 'No active season'}
      points={community.points}
      rank={community.rank}
      admin={community.isAdmin}
      status={community.status === 'ACTIVE' ? 'Active' : 'Unavailable'}
      taskCue={
        taskCount > 0 ? `${taskCount} active task${taskCount === 1 ? '' : 's'}` : 'No active tasks'
      }
      action={
        <div className="inline-actions">
          <Link className="button button-outline" to={`/app/communities/${community.id}`}>
            View
          </Link>
          {community.isAdmin ? (
            <Link className="button button-outline" to={`/app/admin/${community.id}`}>
              Manage
            </Link>
          ) : null}
        </div>
      }
    />
  )
}

type CommunityTab = 'leaderboard' | 'games' | 'tasks'

export function PlayerCommunityDetailPage() {
  const session = useAppSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const { communityId = '' } = useParams()
  const requestedTab = searchParams.get('tab') as CommunityTab | null
  const [tab, setTab] = useState<CommunityTab>(
    requestedTab === 'games' || requestedTab === 'tasks' ? requestedTab : 'leaderboard',
  )
  const load = useCallback(() => api.community(communityId), [communityId])
  const result = useResource(load, Boolean(communityId))
  const leaderboardLoad = useCallback(() => api.leaderboard(communityId), [communityId])
  const leaderboard = useResource(leaderboardLoad, Boolean(communityId) && tab === 'leaderboard')

  useEffect(() => {
    if (requestedTab === 'games' || requestedTab === 'tasks' || requestedTab === 'leaderboard')
      setTab(requestedTab)
  }, [requestedTab])

  const changeTab = (value: string) => {
    const next = value as CommunityTab
    setTab(next)
    setSearchParams(next === 'leaderboard' ? {} : { tab: next })
  }

  if (session.status !== 'ready') return null

  return (
    <PageFrame
      eyebrow="COMMUNITY RECORD"
      title={result.status === 'ready' ? result.data.title : 'Community detail'}
      detail="Rank and points stay scoped to this community season."
    >
      <BackLink to="/app/communities">All communities</BackLink>
      {result.status === 'loading' ? <LoadingLines label="Loading community" /> : null}
      {result.status === 'error' ? (
        <ErrorState
          title="Community data needs attention"
          detail={resourceError(result, 'This community could not be loaded.')}
          onRetry={result.retry}
        />
      ) : null}
      {result.status === 'ready' ? (
        <CommunityDetailContent
          detail={result.data}
          leaderboard={leaderboard}
          tab={tab}
          onTabChange={changeTab}
        />
      ) : null}
    </PageFrame>
  )
}

function CommunityDetailContent({
  detail,
  leaderboard,
  onTabChange,
  tab,
}: {
  readonly detail: AppCommunityDetail
  readonly leaderboard: ResourceState<{ readonly leaderboard: readonly AppLeaderboardEntry[] }> & {
    readonly retry: () => void
  }
  readonly onTabChange: (value: string) => void
  readonly tab: CommunityTab
}) {
  return (
    <>
      <section className="community-detail-header">
        <div className="community-detail-heading">
          <span className="community-mark">{detail.title.slice(0, 1).toUpperCase()}</span>
          <div>
            <SectionLabel>{detail.status}</SectionLabel>
            <h2>{detail.title}</h2>
            <p>{detail.activeSeason?.name ?? 'No active season right now.'}</p>
          </div>
        </div>
        {detail.activeSeason ? (
          <ToneBadge tone="success">Ends {formatDate(detail.activeSeason.endsAt)}</ToneBadge>
        ) : (
          <ToneBadge tone="neutral">No active season</ToneBadge>
        )}
      </section>
      <RankBlock
        context={detail.title}
        points={detail.player.points}
        rank={detail.player.rank}
        {...(detail.activeSeason ? { season: detail.activeSeason.name } : {})}
      />
      <Tabs
        items={[
          { value: 'leaderboard', label: 'Leaderboard' },
          { value: 'games', label: 'Games' },
          { value: 'tasks', label: 'Tasks' },
        ]}
        value={tab}
        onChange={onTabChange}
      />
      <section className="community-tab-panel">
        {tab === 'leaderboard' ? (
          <CommunityLeaderboard detail={detail} result={leaderboard} />
        ) : null}
        {tab === 'games' ? <CommunityGames detail={detail} /> : null}
        {tab === 'tasks' ? <CommunityTasks tasks={detail.tasks} /> : null}
      </section>
    </>
  )
}

function CommunityLeaderboard({
  detail,
  result,
}: {
  readonly detail: AppCommunityDetail
  readonly result: ResourceState<{ readonly leaderboard: readonly AppLeaderboardEntry[] }> & {
    readonly retry: () => void
  }
}) {
  if (!detail.activeSeason)
    return (
      <EmptyState
        title="No active season right now"
        detail="This community stays visible while its next season is prepared."
      />
    )
  if (result.status === 'loading' || result.status === 'idle')
    return <LoadingLines label="Loading leaderboard" />
  if (result.status === 'error')
    return (
      <ErrorState
        title="Leaderboard needs attention"
        detail={resourceError(result, 'The season leaderboard could not be loaded.')}
        onRetry={result.retry}
      />
    )
  const rows = result.status === 'ready' ? result.data.leaderboard : []
  if (rows.length === 0)
    return (
      <EmptyState
        title="No ranked players yet"
        detail="Points will appear here when the season has scored participation."
      />
    )
  return (
    <div className="leaderboard-list">
      {rows.map((row) => (
        <LeaderboardRow
          key={row.playerId}
          current={row.isCurrentPlayer}
          name={row.displayName}
          rank={row.rank}
          score={row.points}
        />
      ))}
    </div>
  )
}

function CommunityGames({ detail }: { readonly detail: AppCommunityDetail }) {
  return (
    <div className="detail-game-list">
      {detail.games.map((game) => (
        <GameCard
          key={game.gameKey}
          family={
            game.gameKey === 'project_quiz'
              ? 'quiz'
              : game.gameKey === 'word_seek'
                ? 'word-seek'
                : 'scramble'
          }
          enabled={game.enabled}
          detail={
            game.enabled
              ? 'Play this game in the community Telegram.'
              : 'This game is not enabled in this community.'
          }
        />
      ))}
    </div>
  )
}

function CommunityTasks({ tasks }: { readonly tasks: readonly AppTask[] }) {
  if (tasks.length === 0)
    return (
      <EmptyState
        title="No active tasks here"
        detail="Check back when this community publishes a contribution task."
      />
    )
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <PlayerTaskCard key={task.id} task={task} />
      ))}
    </div>
  )
}

export function PlayerLeaguePage() {
  const session = useAppSession()
  const load = useCallback(() => api.globalLeague(), [])
  const league = useResource(load)

  if (session.status !== 'ready') return null

  return (
    <PageFrame
      eyebrow="GLOBAL LEAGUE"
      title="Rallyo Global League"
      detail="Global standing is based only on Rallyo XP. Community season points stay in their own league."
      action={
        <ToneBadge tone="accent" icon="trophy">
          Rallyo XP
        </ToneBadge>
      }
    >
      {league.status === 'loading' ? <LoadingLines label="Loading global league" /> : null}
      {league.status === 'error' ? (
        <ErrorState
          title="Leagues are unavailable"
          detail={resourceError(league, 'The Rallyo Global League could not be loaded.')}
          onRetry={league.retry}
        />
      ) : null}
      {league.status === 'ready' ? <GlobalLeagueContent data={league.data} /> : null}
    </PageFrame>
  )
}

function GlobalLeagueContent({ data }: { readonly data: GlobalLeague }) {
  const visiblePlayerIds = new Set(data.leaderboard.map((entry) => entry.playerId))
  const currentIsPinned = !visiblePlayerIds.has(data.currentPlayer.playerId)
  return (
    <section className="global-league-panel">
      <div className="league-focus-heading">
        <div>
          <SectionLabel>RALLYO XP STANDINGS</SectionLabel>
          <h2>Top Players</h2>
          <p>One global ranking across every Rallyo community.</p>
        </div>
        <div className="global-league-current-summary">
          <span>Your rank</span>
          <strong>#{data.currentPlayer.rank}</strong>
        </div>
      </div>
      <div className="leaderboard-list global-league-list">
        {data.leaderboard.map((row) => (
          <LeaderboardRow
            key={row.playerId}
            avatarId={row.isCurrentPlayer ? getStoredAvatarId() : getLeagueAvatarId(row.playerId)}
            current={row.isCurrentPlayer}
            name={row.displayName}
            rank={row.rank}
            score={row.totalXp}
            scoreLabel="XP"
          />
        ))}
      </div>
      {currentIsPinned ? (
        <div className="global-league-pinned">
          <SectionLabel>YOUR POSITION</SectionLabel>
          <LeaderboardRow
            avatarId={getStoredAvatarId()}
            current
            name={data.currentPlayer.displayName}
            rank={data.currentPlayer.rank}
            score={data.currentPlayer.totalXp}
            scoreLabel="XP"
          />
        </div>
      ) : null}
    </section>
  )
}

export function PlayerTasksPage() {
  const session = useAppSession()
  const load = useCallback(() => api.tasks(), [])
  const result = useResource(load)
  const [filter, setFilter] = useState<PlayerTaskFilter>('available')
  if (session.status !== 'ready') return null

  const tasks = result.status === 'ready' ? filterPlayerTasks(result.data.tasks, filter) : []
  const activeTasks = result.status === 'ready' ? result.data.tasks : []

  return (
    <PageFrame
      eyebrow="TASKS"
      title="Contribution tasks"
      detail="Complete real community tasks, then track the review state of each submission."
    >
      <Tabs
        className="player-task-tabs"
        items={[
          { value: 'available', label: 'Available' },
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'history', label: 'History' },
        ]}
        value={filter}
        onChange={(value) => setFilter(value as PlayerTaskFilter)}
      />
      {result.status === 'loading' ? <LoadingLines label="Loading tasks" /> : null}
      {result.status === 'error' ? (
        <ErrorState
          title="Tasks are unavailable"
          detail={resourceError(result, 'The task feed could not be loaded.')}
          onRetry={result.retry}
        />
      ) : null}
      {result.status === 'ready' && filter === 'history' && tasks.length === 0 ? (
        <EmptyState
          title="Task history is not in this feed yet"
          detail="The current app service returns active tasks and their latest submission state. Rejected active tasks appear here, while expired history needs a broader feed."
        />
      ) : null}
      {result.status === 'ready' &&
      filter !== 'history' &&
      activeTasks.length > 0 &&
      tasks.length === 0 ? (
        <EmptyState
          title={`No ${filter} tasks`}
          detail="Choose another task state to see the active community feed."
        />
      ) : null}
      {result.status === 'ready' && tasks.length > 0 ? (
        <div className="task-list">
          {tasks.map((task) => (
            <PlayerTaskCard key={task.id} task={task} />
          ))}
        </div>
      ) : null}
      {result.status === 'ready' && activeTasks.length === 0 && filter !== 'history' ? (
        <EmptyState
          title="No active tasks from your communities"
          detail="New contribution tasks will appear here when a community publishes them."
        />
      ) : null}
    </PageFrame>
  )
}

function PlayerTaskCard({ task }: { readonly task: AppTask }) {
  const state = taskState(task)
  return (
    <article className="player-task-card">
      <div className="task-card-topline">
        <span>{task.communityTitle}</span>
        <ToneBadge
          tone={state === 'Approved' ? 'success' : state === 'Pending' ? 'warning' : 'neutral'}
        >
          {state}
        </ToneBadge>
      </div>
      <div className="task-card-body">
        <div>
          <h3>{task.title}</h3>
          <p>Community task · Telegram</p>
        </div>
        <strong className="task-points">
          +{task.points} <span>pts</span>
        </strong>
      </div>
      <p className="player-task-instructions">{task.instructions}</p>
      <div className="task-card-meta">
        <span>Proof: URL or reference</span>
        <span>{formatDeadline(task.endsAt)}</span>
      </div>
      <div className="task-card-action">
        <Link className="button button-outline" to={`/app/tasks/${task.id}`}>
          {state === 'Pending'
            ? 'View pending'
            : state === 'Approved'
              ? 'View approved'
              : state === 'Rejected'
                ? 'View rejected'
                : 'Open task'}
        </Link>
      </div>
    </article>
  )
}

export function PlayerTaskDetailPage() {
  const session = useAppSession()
  const { taskId = '' } = useParams()
  const load = useCallback(() => api.task(taskId), [taskId])
  const result = useResource(load, Boolean(taskId))
  if (session.status !== 'ready') return null

  return (
    <PageFrame
      eyebrow="TASK DETAIL"
      title={result.status === 'ready' ? result.data.title : 'Task detail'}
      detail="Review the instructions and submit through the community Telegram flow supported by Rallyo."
    >
      <BackLink to="/app/tasks">All tasks</BackLink>
      {result.status === 'loading' ? <LoadingLines label="Loading task" /> : null}
      {result.status === 'error' ? (
        <ErrorState
          title="Task detail needs attention"
          detail={resourceError(result, 'This task could not be loaded.')}
          onRetry={result.retry}
        />
      ) : null}
      {result.status === 'ready' ? <TaskDetailContent task={result.data} /> : null}
    </PageFrame>
  )
}

function TaskDetailContent({ task }: { readonly task: AppTaskDetail }) {
  const state = taskState(task)
  return (
    <div className="task-detail-layout">
      <section className="task-detail-main">
        <div className="task-detail-title-row">
          <ToneBadge
            tone={
              state === 'Approved'
                ? 'success'
                : state === 'Pending'
                  ? 'warning'
                  : task.isOpen
                    ? 'accent'
                    : 'neutral'
            }
          >
            {task.isOpen ? state : 'Closed'}
          </ToneBadge>
          <strong className="task-detail-points">+{task.points} pts</strong>
        </div>
        <div className="task-detail-copy">
          <SectionLabel>INSTRUCTIONS</SectionLabel>
          <p>{task.instructions}</p>
        </div>
        <StatusBanner
          tone="info"
          icon="telegram"
          title="Submit proof in Telegram"
          detail="Web proof submission is not exposed by the current app API. Open this community in Telegram, use /tasks, choose this task, then send the URL or reference there."
        />
        {task.submission ? <SubmissionState submission={task.submission} /> : null}
      </section>
      <aside className="task-detail-aside">
        <SectionLabel>SPONSORING COMMUNITY</SectionLabel>
        <h2>{task.communityTitle}</h2>
        <Link className="button button-outline" to={`/app/communities/${task.communityId}`}>
          View community
        </Link>
        <dl className="detail-facts">
          <div>
            <dt>Proof</dt>
            <dd>URL or reference</dd>
          </div>
          <div>
            <dt>Available from</dt>
            <dd>{formatDateTime(task.startsAt)}</dd>
          </div>
          <div>
            <dt>Ends</dt>
            <dd>{formatDateTime(task.endsAt)}</dd>
          </div>
          <div>
            <dt>Submission cap</dt>
            <dd>
              {task.maxSubmissionsPerPlayer
                ? `${task.maxSubmissionsPerPlayer} per player`
                : 'No cap listed'}
            </dd>
          </div>
          <div>
            <dt>Cooldown</dt>
            <dd>
              {task.cooldownDays
                ? `${task.cooldownDays} day${task.cooldownDays === 1 ? '' : 's'}`
                : 'None listed'}
            </dd>
          </div>
        </dl>
        {!task.isOpen ? (
          <ToneBadge tone="neutral">This task is not accepting submissions</ToneBadge>
        ) : null}
      </aside>
    </div>
  )
}

function SubmissionState({
  submission,
}: {
  readonly submission: NonNullable<AppTaskDetail['submission']>
}) {
  const tone =
    submission.status === 'APPROVED'
      ? 'success'
      : submission.status === 'REJECTED'
        ? 'danger'
        : 'warning'
  return (
    <section className="submission-state">
      <SectionLabel>YOUR LATEST SUBMISSION</SectionLabel>
      <ToneBadge tone={tone}>{submission.status}</ToneBadge>
      <p>Submitted {formatDateTime(submission.createdAt)}.</p>
      {submission.reference ? (
        <p className="submission-reference">Reference: {submission.reference}</p>
      ) : null}
      {submission.rejectionReason ? <p role="alert">Reason: {submission.rejectionReason}</p> : null}
    </section>
  )
}

export function PlayerPairPage() {
  const session = useAppSession()
  const [searchParams] = useSearchParams()
  const [code, setCode] = useState('')
  const [state, setState] = useState<'idle' | 'pairing' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  const walletHandoff = searchParams.get('from') === 'wallet'
  if (session.status !== 'ready') return null

  const pair = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setState('pairing')
    setError(null)
    try {
      await api.pairTelegram(code.trim())
      setCode('')
      await session.refresh()
      setState('success')
    } catch (reason: unknown) {
      setState('error')
      setError(
        reason instanceof ApiError ? reason.message : 'Telegram pairing could not be completed.',
      )
    }
  }

  return (
    <PageFrame
      eyebrow="CONNECT TELEGRAM"
      title="Bring your communities into Rallyo"
      detail={
        walletHandoff
          ? 'Your wallet session is ready. Finish the link with a code from your Telegram identity.'
          : 'Use a one-time code from RallyoBot to connect Telegram to this Player.'
      }
    >
      <BackLink to="/app/me">Back to You</BackLink>
      <div className="pair-layout">
        <section className="pair-explainer">
          <SectionLabel>THREE STEPS</SectionLabel>
          <ol className="pair-steps">
            <li>
              <span>01</span>
              <div>
                <strong>Ask RallyoBot</strong>
                <p>Use /pair in Telegram to request a one-time code.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Paste the code</strong>
                <p>The code is short-lived and can be used once.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Keep your record</strong>
                <p>
                  Communities, season history, tasks, and admin access stay with the canonical
                  Player.
                </p>
              </div>
            </li>
          </ol>
          <StatusBanner
            tone="info"
            icon="shield"
            title="Your current session stays safe"
            detail="Cancelling or entering an invalid code does not disconnect the Player you are using now."
          />
        </section>
        <form className="pair-form" onSubmit={(event) => void pair(event)}>
          <SectionLabel>ONE-TIME CODE</SectionLabel>
          <label htmlFor="telegram-pair-code">Telegram pairing code</label>
          <input
            id="telegram-pair-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={100}
            placeholder="6 to 8 characters"
            required
            aria-invalid={state === 'error' ? true : undefined}
          />
          <p className="field-message">
            Codes expire after a short period and are consumed after a successful link.
          </p>
          <Button type="submit" icon="link" loading={state === 'pairing'}>
            Connect Telegram
          </Button>
          {state === 'success' ? (
            <p className="pair-success" role="status">
              Telegram is connected to this Player. Your available community records have been
              refreshed.
            </p>
          ) : null}
          {state === 'error' ? (
            <p className="entry-form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </PageFrame>
  )
}

export function PlayerProfilePage() {
  const session = useAppSession()
  const [copied, setCopied] = useState(false)
  if (session.status !== 'ready') return null
  const { player, wallet, communities, progression } = session.data
  const avatarId = getStoredAvatarId()
  const copyAddress = async () => {
    if (!wallet.linked) return
    try {
      await navigator.clipboard.writeText(wallet.address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <PageFrame
      eyebrow="YOU"
      title="Your Rallyo identity"
      detail="Telegram and Nimiq are connected methods for the same Player. Nimiq is required before a reward can be claimed."
      action={
        <Button type="button" variant="secondary" onClick={() => void session.logout()}>
          Sign out
        </Button>
      }
    >
      <section className="profile-hero">
        <Avatar avatarId={avatarId} name={player.displayName} size="hero" />
        <div>
          <SectionLabel>CANONICAL PLAYER</SectionLabel>
          <h2>{player.displayName}</h2>
          <p>{player.username ? `Telegram @${player.username}` : 'Telegram not connected'}</p>
        </div>
        <Link className="button button-outline" to="/app/onboarding/avatar">
          Change avatar
        </Link>
      </section>

      <RallyoProgressionSummary progression={progression} showCheckinState />

      {!player.username ? (
        <StatusBanner
          tone="accent"
          icon="telegram"
          title="Connect Telegram"
          detail="Restore communities, season history, tasks, and admin access to this Player."
          action={
            <Link className="button button-primary" to="/app/pair">
              Enter pairing code
            </Link>
          }
        />
      ) : (
        <section className="profile-method">
          <div className="profile-method-icon">
            <Icon name="telegram" size={23} />
          </div>
          <div>
            <SectionLabel>TELEGRAM</SectionLabel>
            <h2>Connected</h2>
            <p>{player.username ? `@${player.username}` : 'Connected identity'}</p>
          </div>
          <ToneBadge tone="success">Active</ToneBadge>
        </section>
      )}

      <section className="profile-method">
        <div className="profile-method-icon profile-wallet-icon">
          <Icon name="wallet" size={23} />
        </div>
        <div>
          <SectionLabel>NIMIQ WALLET</SectionLabel>
          <h2>{wallet.linked ? 'Connected' : 'Not connected'}</h2>
          <p>
            {wallet.linked
              ? '✅ Nimiq connected'
              : 'Nimiq not connected. Connect Nimiq in Rallyo before claiming rewards.'}
          </p>
        </div>
        {wallet.linked ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => void copyAddress()}>
            {copied ? 'Copied' : 'Copy address'}
          </Button>
        ) : (
          <Link className="button button-outline" to="/app/rewards">
            Wallet and rewards
          </Link>
        )}
      </section>

      <section className="profile-community-summary">
        <div className="home-section-heading compact">
          <div>
            <SectionLabel>COMMUNITIES</SectionLabel>
            <h2>
              {communities.length
                ? `${communities.length} record${communities.length === 1 ? '' : 's'}`
                : 'No records yet'}
            </h2>
          </div>
          <Link className="text-button" to="/app/communities">
            View all
          </Link>
        </div>
        {communities.length ? (
          <div className="profile-community-list">
            {communities.slice(0, 3).map((community) => (
              <Link
                className="profile-community-row"
                key={community.id}
                to={`/app/communities/${community.id}`}
              >
                <span className="community-mark">{community.title.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{community.title}</strong>
                  <small>{community.activeSeason?.name ?? 'No active season'}</small>
                </span>
                <b>{community.rank ? `#${community.rank}` : 'Unranked'}</b>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No community records yet"
            detail="Connect Telegram or join a community to see your record here."
          />
        )}
      </section>
    </PageFrame>
  )
}

function RallyoProgressionSummary({
  progression,
  showCheckinState = false,
}: {
  readonly progression: RallyoProgression
  readonly showCheckinState?: boolean
}) {
  return (
    <section className="rallyo-progression-card">
      <div>
        <SectionLabel>RALLYO PROGRESSION</SectionLabel>
        <h2>Rallyo XP</h2>
        <p>Global across communities. Community points stay separate.</p>
      </div>
      <div className="rallyo-progression-stats">
        <div>
          <span>Rallyo XP</span>
          <strong>{progression.totalXp.toLocaleString()}</strong>
        </div>
        <div>
          <span>Global rank</span>
          <strong>{progression.globalRank ? `#${progression.globalRank}` : 'Unranked'}</strong>
        </div>
      </div>
      {showCheckinState ? (
        <div className="rallyo-checkin-state">
          <span>Daily check-in</span>
          <strong>{progression.todayClaimed ? 'Claimed today' : 'Available today'}</strong>
          <small>
            {progression.todayClaimed
              ? `Next claim ${formatDateTime(progression.nextEligibleAt)}`
              : 'Claim +10 Rallyo XP from Home.'}
          </small>
        </div>
      ) : null}
    </section>
  )
}

function DailyCheckinDialog({
  error,
  onClaim,
  onClose,
  state,
}: {
  readonly error: string | null
  readonly onClaim: () => Promise<void>
  readonly onClose: () => void
  readonly state: 'idle' | 'claiming' | 'success' | 'already' | 'error'
}) {
  const success = state === 'success'
  return (
    <div className="daily-checkin-backdrop">
      <section
        aria-label="Daily check-in"
        aria-modal="true"
        className={`daily-checkin-dialog${success ? ' is-success' : ''}`}
        role="dialog"
      >
        <div className="daily-checkin-mark" aria-hidden="true">
          {success ? <Icon name="check" size={26} /> : <Icon name="spark" size={25} />}
        </div>
        {success ? (
          <div>
            <SectionLabel>CHECK-IN COMPLETE</SectionLabel>
            <h2>+10 Rallyo XP</h2>
            <p>Your global position is updated.</p>
          </div>
        ) : (
          <div>
            <SectionLabel>DAILY CHECK-IN</SectionLabel>
            <h2>Claim +10 Rallyo XP</h2>
            <p>One claim per UTC day.</p>
          </div>
        )}
        {error ? (
          <p className="entry-form-error" role="alert">
            {error}
          </p>
        ) : null}
        {!success ? (
          <div className="daily-checkin-actions">
            <Button
              icon="spark"
              loading={state === 'claiming'}
              type="button"
              onClick={() => void onClaim()}
            >
              Claim XP
            </Button>
            <button className="text-button" type="button" onClick={onClose}>
              Maybe later
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export function PlayerRewardsPage() {
  const session = useAppSession()
  const navigate = useNavigate()
  const load = useCallback(() => api.rewards(), [])
  const result = useResource(load)
  if (session.status !== 'ready') return null

  const startWalletLink = async (redirectPath: string) => {
    await session.refresh()
    void navigate('/app/pair?from=wallet', { replace: true })
    if (redirectPath !== '/app') void navigate(redirectPath, { replace: true })
  }

  return (
    <PageFrame
      eyebrow="WALLET AND REWARDS"
      title="Wallet and rewards"
      detail="Community rewards and their claim status."
    >
      <BackLink to="/app/me">Back to You</BackLink>
      {result.status === 'loading' ? <LoadingLines label="Loading rewards" /> : null}
      {result.status === 'error' ? (
        <ErrorState
          title="Rewards are unavailable"
          detail={resourceError(result, 'The reward feed could not be loaded.')}
          onRetry={result.retry}
        />
      ) : null}
      {result.status === 'ready' ? (
        <RewardsContent
          rewards={result.data}
          walletSignIn={
            <WalletSignInButton
              enabled
              onAuthenticated={startWalletLink}
              label="Connect Nimiq"
              disabledReason="Connect Nimiq before claiming rewards."
            />
          }
        />
      ) : null}
    </PageFrame>
  )
}

function RewardsContent({
  rewards,
  walletSignIn,
}: {
  readonly rewards: AppRewards
  readonly walletSignIn: ReactNode
}) {
  return (
    <>
      {!rewards.wallet.linked ? (
        <StatusBanner
          tone="info"
          icon="wallet"
          title="Nimiq connection required"
          detail="This reward remains visible, but you must connect Nimiq before claiming it."
          action={walletSignIn}
        />
      ) : (
        <section className="wallet-summary">
          <div className="profile-method-icon profile-wallet-icon">
            <Icon name="wallet" size={23} />
          </div>
          <div>
            <SectionLabel>CONNECTED WALLET</SectionLabel>
            <h2>{shortAddress(rewards.wallet.address)}</h2>
            <p>Verified wallet identity for this Player.</p>
          </div>
          <ToneBadge tone="success">Linked</ToneBadge>
        </section>
      )}
      <section className="rewards-section">
        <div className="home-section-heading compact">
          <div>
            <SectionLabel>REWARDS</SectionLabel>
            <h2>
              {rewards.entitlements.length
                ? `${rewards.entitlements.length} reward${rewards.entitlements.length === 1 ? '' : 's'}`
                : 'No rewards yet'}
            </h2>
          </div>
        </div>
        {rewards.entitlements.length === 0 ? (
          <EmptyState
            title="No rewards yet"
            detail="Available rewards appear after a community season is finalized."
          />
        ) : (
          <div className="reward-list">
            {rewards.entitlements.map((reward) => (
              <RewardRow key={reward.id} reward={reward} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function RewardRow({ reward }: { readonly reward: AppRewards['entitlements'][number] }) {
  const tone =
    reward.status === 'CONFIRMED' || reward.status === 'SENT'
      ? 'success'
      : reward.status === 'FAILED'
        ? 'danger'
        : reward.status === 'CLAIMING'
          ? 'warning'
          : 'accent'
  return (
    <article className="reward-row">
      <div className="reward-rank">#{reward.rank}</div>
      <div className="reward-copy">
        <strong>{reward.communityTitle}</strong>
        <span>
          {reward.seasonName} · {formatDate(reward.createdAt)}
        </span>
      </div>
      <strong className="reward-amount">
        {reward.amountLuna} <small>LUNA</small>
      </strong>
      <div className="reward-status">
        <ToneBadge tone={tone}>{rewardStatusLabel(reward.status)}</ToneBadge>
        {reward.transactionHash ? <code>{shortAddress(reward.transactionHash)}</code> : null}
      </div>
      {reward.status === 'ELIGIBLE' ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled
          title="Reward claiming is not exposed by the current app API"
        >
          Claim not available yet
        </Button>
      ) : null}
    </article>
  )
}

function rewardStatusLabel(status: string) {
  switch (status) {
    case 'ELIGIBLE':
      return 'Available'
    case 'CLAIMING':
      return 'Processing'
    case 'SENT':
      return 'Sent'
    case 'CONFIRMED':
      return 'Confirmed'
    case 'FAILED':
      return 'Needs attention'
    default:
      return 'Recorded'
  }
}
