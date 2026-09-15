import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { api, ApiError, type AppGameCapability, type AppTask } from '../api/client'
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LeaderboardRow,
  LoadingState,
  PageFrame,
  SectionLabel,
  StatusBanner,
  ToneBadge,
  type IconName,
} from '../components/design-system'
import { formatDateTime, gameLabel } from './player-data'
import { useAppSession } from './session'

type ResourceState<T> =
  | { readonly status: 'loading'; readonly data: null; readonly error: null }
  | { readonly status: 'ready'; readonly data: T; readonly error: null }
  | { readonly status: 'error'; readonly data: null; readonly error: Error }

type AdminSection = 'games' | 'season' | 'tasks' | 'content'

function useResource<T>(load: () => Promise<T>): ResourceState<T> & { readonly retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ResourceState<T>>({
    status: 'loading',
    data: null,
    error: null,
  })

  useEffect(() => {
    let current = true
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
  }, [attempt, load])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

function useAdminOverview(communityId: string) {
  const load = useCallback(() => api.adminOverview(communityId), [communityId])
  return useResource(load)
}

function adminPath(communityId: string, section?: AdminSection): string {
  return section ? `/app/admin/${communityId}/${section}` : `/app/admin/${communityId}`
}

export function AdminEntryPage() {
  const session = useAppSession()
  if (session.status !== 'ready') return null
  const communities = session.data.adminCommunities
  if (communities.length === 1 && communities[0]) {
    return <Navigate replace to={adminPath(communities[0].id)} />
  }
  return <AdminCommunityPicker section={undefined} />
}

export function AdminSectionRoute({ section }: { readonly section: AdminSection }) {
  const { communityId } = useParams()
  const session = useAppSession()

  if (session.status !== 'ready') return null
  if (!communityId) {
    if (session.data.adminCommunities.length === 1 && session.data.adminCommunities[0]) {
      return <Navigate replace to={adminPath(session.data.adminCommunities[0].id, section)} />
    }
    return <AdminCommunityPicker section={section} />
  }

  if (section === 'games') return <AdminGamesPage communityId={communityId} />
  if (section === 'season') return <AdminSeasonPage communityId={communityId} />
  if (section === 'tasks') return <AdminTasksPage communityId={communityId} />
  return <AdminContentPage communityId={communityId} />
}

export function AdminOverviewPage() {
  const { communityId } = useParams()
  if (!communityId) return <AdminEntryPage />
  return <AdminOverviewForCommunity communityId={communityId} />
}

function AdminOverviewForCommunity({ communityId }: { readonly communityId: string }) {
  const resource = useAdminOverview(communityId)
  if (resource.status === 'loading') return <AdminLoading label="Loading community control" />
  if (resource.status === 'error')
    return <AdminResourceError error={resource.error} retry={resource.retry} />
  const overview = resource.data
  const active = overview.community.status === 'ACTIVE'

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL"
      title={overview.community.title}
      detail="A calm operating view for the community arena. Live gameplay stays in Telegram."
      action={
        <Link className="button button-primary" to={adminPath(communityId, 'games')}>
          Manage games <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      <AdminScopeBar communityName={overview.community.title} status={overview.community.status} />

      {!active ? (
        <StatusBanner
          detail="This community is not active. New game and task activity should remain unavailable until the server changes its community state."
          icon="warning"
          title={`Community status: ${overview.community.status}`}
          tone="warning"
        />
      ) : null}

      {!overview.activeSeason ? (
        <StatusBanner
          detail="Games and point-awarding paths need an active season. The web app will not create one until a community-scoped season endpoint exists."
          icon="trophy"
          title="No active season"
          tone="warning"
        />
      ) : null}

      <div className="admin-overview-primary">
        <section className="admin-season-card">
          <div className="admin-card-topline">
            <SectionLabel>SEASON CONTEXT</SectionLabel>
            <ToneBadge tone={overview.activeSeason ? 'success' : 'warning'}>
              {overview.activeSeason ? 'Active' : 'Not running'}
            </ToneBadge>
          </div>
          <h2>{overview.activeSeason ?? 'No active season'}</h2>
          <p>
            {overview.activeSeason
              ? 'Games, approved tasks, and positive awards contribute to this community season ledger.'
              : 'Choose Season to inspect the current leaderboard and the unavailable lifecycle controls.'}
          </p>
          <Link className="button button-outline" to={adminPath(communityId, 'season')}>
            Open season <Icon name="arrow-right" size={17} />
          </Link>
        </section>

        <section className="admin-stat-panel" aria-label="Community statistics">
          <div className="admin-card-topline">
            <SectionLabel>REAL RECORDS</SectionLabel>
            <span className="admin-scope-note">Community scope</span>
          </div>
          <div className="admin-stat-list">
            <AdminStat label="Players with score events" value={overview.participantCount} />
            <AdminStat label="Active tasks" value={overview.activeTaskCount} />
            <AdminStat label="Pending task reviews" value={overview.pendingReviewCount} />
            <AdminStat label="Approved questions ready" value={overview.readyQuestionCount} />
          </div>
        </section>
      </div>

      <section className="admin-section-block">
        <div className="admin-section-heading">
          <div>
            <SectionLabel>CAPABILITIES</SectionLabel>
            <h2>What is enabled here</h2>
          </div>
          <Link className="text-button" to={adminPath(communityId, 'games')}>
            View game state <Icon name="arrow-right" size={16} />
          </Link>
        </div>
        <div className="admin-capability-strip">
          {overview.games.map((game) => (
            <AdminCapability key={game.gameKey} game={game} />
          ))}
        </div>
      </section>

      <div className="admin-overview-secondary">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <SectionLabel>ATTENTION</SectionLabel>
              <h2>What needs a look</h2>
            </div>
            <span className="panel-count">{overview.pendingReviewCount}</span>
          </div>
          {overview.pendingReviewCount > 0 ? (
            <div className="admin-attention-row admin-attention-row-warning">
              <span className="admin-attention-mark" aria-hidden="true">
                <Icon name="warning" size={18} />
              </span>
              <div>
                <strong>Task submissions are waiting</strong>
                <p>
                  {overview.pendingReviewCount.toLocaleString()} pending review
                  {overview.pendingReviewCount === 1 ? '' : 's'} from this community.
                </p>
              </div>
              <Link className="text-button" to={adminPath(communityId, 'tasks')}>
                Open tasks
              </Link>
            </div>
          ) : (
            <p className="panel-empty">No pending task reviews were returned.</p>
          )}
          {!overview.activeSeason ? (
            <div className="admin-attention-row">
              <span className="admin-attention-mark" aria-hidden="true">
                <Icon name="trophy" size={18} />
              </span>
              <div>
                <strong>Season setup is incomplete</strong>
                <p>No active season was returned for this community.</p>
              </div>
              <Link className="text-button" to={adminPath(communityId, 'season')}>
                Inspect
              </Link>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <SectionLabel>SCHEDULE</SectionLabel>
              <h2>Next recorded round</h2>
            </div>
            <Icon name="telegram" size={20} />
          </div>
          <div className="admin-schedule-value">
            {overview.nextRoundAt ? formatDateTime(overview.nextRoundAt) : 'No scheduled round'}
          </div>
          <p className="admin-muted-copy">
            The scheduler record is read from the community backend. Starting a round remains a
            Telegram action.
          </p>
        </section>
      </div>
    </PageFrame>
  )
}

export function AdminGamesPage({ communityId }: { readonly communityId: string }) {
  const resource = useAdminOverview(communityId)
  if (resource.status === 'loading') return <AdminLoading label="Loading game capabilities" />
  if (resource.status === 'error')
    return <AdminResourceError error={resource.error} retry={resource.retry} />
  const overview = resource.data

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL / GAMES"
      title="Games"
      detail="Configure what players can start in this community. Every game remains a Telegram experience."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      <StatusBanner
        detail="This page reflects the server capability state. Web enablement controls are intentionally unavailable until a community-scoped mutation route is exposed."
        icon="telegram"
        title="Play stays in Telegram"
        tone="info"
      />
      <div className="admin-page-context">
        <span>{overview.community.title}</span>
        <span>Approved questions ready: {overview.readyQuestionCount.toLocaleString()}</span>
      </div>
      <section className="admin-game-list" aria-label="Community game capabilities">
        {overview.games.length > 0 ? (
          overview.games.map((game) => (
            <AdminGameRow
              game={game}
              key={game.gameKey}
              readyQuestionCount={overview.readyQuestionCount}
            />
          ))
        ) : (
          <EmptyState
            detail="The server returned no game capability rows for this community."
            title="No game capabilities"
          />
        )}
      </section>
    </PageFrame>
  )
}

export function AdminSeasonPage({ communityId }: { readonly communityId: string }) {
  const overview = useAdminOverview(communityId)
  const leaderboardLoad = useCallback(() => api.leaderboard(communityId), [communityId])
  const leaderboard = useResource(leaderboardLoad)

  if (overview.status === 'loading') return <AdminLoading label="Loading season state" />
  if (overview.status === 'error')
    return <AdminResourceError error={overview.error} retry={overview.retry} />
  const data = overview.data

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL / SEASON"
      title="Season"
      detail="Inspect the active community season and its shared leaderboard. Season mutations stay server-owned."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      <section className="admin-season-hero">
        <div>
          <SectionLabel>ACTIVE SEASON</SectionLabel>
          <h2>{data.activeSeason ?? 'No active season'}</h2>
          <p>
            {data.activeSeason
              ? 'The leaderboard below combines eligible game and task score events for this community.'
              : 'An active season is required before games or approved social work can award points.'}
          </p>
        </div>
        <ToneBadge tone={data.activeSeason ? 'success' : 'warning'}>
          {data.activeSeason ? 'Running' : 'Not running'}
        </ToneBadge>
      </section>

      <section className="admin-action-panel">
        <div>
          <SectionLabel>SEASON LIFECYCLE</SectionLabel>
          <h2>Web controls are not connected</h2>
          <p>
            The current app API has no community-scoped create, start, or end route. These controls
            stay disabled so the web app cannot bypass season rules or reward finalization.
          </p>
        </div>
        <div className="admin-action-stack">
          <AdminUnavailableAction explanation="No web route exists for starting a community season.">
            Start a season
          </AdminUnavailableAction>
          <AdminUnavailableAction explanation="Ending a season can finalize rewards and needs an explicit server action.">
            End current season
          </AdminUnavailableAction>
        </div>
      </section>

      <section className="panel admin-leaderboard-panel">
        <div className="panel-heading">
          <div>
            <SectionLabel>LEADERBOARD PREVIEW</SectionLabel>
            <h2>Community standings</h2>
          </div>
          <span className="panel-count">
            {leaderboard.status === 'ready' ? leaderboard.data.leaderboard.length : '...'}
          </span>
        </div>
        {leaderboard.status === 'loading' ? <LoadingState label="Loading standings" /> : null}
        {leaderboard.status === 'error' ? (
          <ErrorState
            detail={leaderboard.error.message}
            onRetry={leaderboard.retry}
            title="Standings could not be loaded."
          />
        ) : null}
        {leaderboard.status === 'ready' && leaderboard.data.leaderboard.length === 0 ? (
          <EmptyState
            detail={
              data.activeSeason
                ? 'No score events were returned for the active season.'
                : 'No active season means there is no current leaderboard to display.'
            }
            title="No standings yet"
          />
        ) : null}
        {leaderboard.status === 'ready' && leaderboard.data.leaderboard.length > 0 ? (
          <div className="leaderboard-list">
            {leaderboard.data.leaderboard.slice(0, 10).map((entry) => (
              <LeaderboardRow
                current={entry.isCurrentPlayer}
                key={entry.playerId}
                name={entry.displayName}
                rank={entry.rank}
                score={entry.points}
              />
            ))}
          </div>
        ) : null}
      </section>
    </PageFrame>
  )
}

export function AdminTasksPage({ communityId }: { readonly communityId: string }) {
  const overview = useAdminOverview(communityId)
  const tasksLoad = useCallback(() => api.tasks(communityId), [communityId])
  const tasks = useResource(tasksLoad)

  if (overview.status === 'loading') return <AdminLoading label="Loading task control" />
  if (overview.status === 'error')
    return <AdminResourceError error={overview.error} retry={overview.retry} />
  const data = overview.data

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL / SOCIAL TASKS"
      title="Social tasks"
      detail="Review the active task state returned for this community. Task creation and review actions remain server-authorized."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      {data.pendingReviewCount > 0 ? (
        <StatusBanner
          action={
            <AdminUnavailableAction explanation="The task-review route is not exposed to the web app yet.">
              Review submissions
            </AdminUnavailableAction>
          }
          detail={`${data.pendingReviewCount.toLocaleString()} pending submission${data.pendingReviewCount === 1 ? '' : 's'} are recorded for this community.`}
          icon="warning"
          title="Review queue needs attention"
          tone="warning"
        />
      ) : (
        <StatusBanner
          detail="The server returned no pending task submissions for this community."
          icon="check"
          title="No pending reviews"
          tone="success"
        />
      )}

      <section className="admin-action-panel admin-task-actions">
        <div>
          <SectionLabel>TASK LIFECYCLE</SectionLabel>
          <h2>Campaign setup is waiting on the web seam</h2>
          <p>
            The Telegram service supports reviewable social tasks. The app API does not yet expose
            create, archive, approve, or reject routes for this community.
          </p>
        </div>
        <AdminUnavailableAction explanation="No web task-creation route exists, so no form is shown.">
          Create a task
        </AdminUnavailableAction>
      </section>

      <section className="admin-section-block">
        <div className="admin-section-heading">
          <div>
            <SectionLabel>ACTIVE TASKS</SectionLabel>
            <h2>What players can see now</h2>
          </div>
          <span className="admin-section-count">
            {data.activeTaskCount.toLocaleString()} reported active
          </span>
        </div>
        {tasks.status === 'loading' ? <LoadingState label="Loading active tasks" /> : null}
        {tasks.status === 'error' ? (
          <ErrorState
            detail={tasks.error.message}
            onRetry={tasks.retry}
            title="Active tasks could not be loaded."
          />
        ) : null}
        {tasks.status === 'ready' && tasks.data.tasks.length === 0 ? (
          <EmptyState
            detail="The server returned no active task rows for this community."
            title="No active tasks"
          />
        ) : null}
        {tasks.status === 'ready' && tasks.data.tasks.length > 0 ? (
          <div className="admin-task-list">
            {tasks.data.tasks.map((task) => (
              <AdminTaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : null}
      </section>

      <StatusBanner
        detail="Recurring versus campaign labels, proof-type metadata, caps, and historical task rows are not part of the current web response."
        icon="lock"
        title="Limited task read model"
        tone="info"
      />
    </PageFrame>
  )
}

export function AdminContentPage({ communityId }: { readonly communityId: string }) {
  const resource = useAdminOverview(communityId)
  if (resource.status === 'loading') return <AdminLoading label="Loading project content state" />
  if (resource.status === 'error')
    return <AdminResourceError error={resource.error} retry={resource.retry} />
  const overview = resource.data

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL / PROJECT CONTENT"
      title="Project content"
      detail="See the content readiness that the current app API can verify. Live games only use approved server content."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      <StatusBanner
        detail="The web app will not create, approve, or edit content without the same scoped content service and authorization checks used by Telegram."
        icon="lock"
        title="Approval remains server-owned"
        tone="info"
      />

      <div className="admin-content-grid">
        <ContentReadinessCard
          detail="Global and community-approved questions available to this community."
          label="Questions ready"
          value={overview.readyQuestionCount.toLocaleString()}
          tone={overview.readyQuestionCount > 0 ? 'success' : 'warning'}
        />
        <ContentReadinessCard
          detail="Approved project vocabulary is not returned by the current app API."
          label="Vocabulary"
          value="Not exposed"
          tone="neutral"
        />
        <ContentReadinessCard
          detail="Prepared image and media readiness is not returned by the current app API."
          label="Prepared media"
          value="Not exposed"
          tone="neutral"
        />
      </div>

      <section className="admin-action-panel">
        <div>
          <SectionLabel>PROJECT BRAIN</SectionLabel>
          <h2>Content actions are not connected</h2>
          <p>
            The existing Telegram flow can guide authorized content work. The web app has no
            community-scoped draft, approval, or source endpoint yet.
          </p>
        </div>
        <div className="admin-action-stack">
          <AdminUnavailableAction explanation="No web route exists for creating a question draft.">
            Add a question
          </AdminUnavailableAction>
          <AdminUnavailableAction explanation="No web route exists for adding or approving project vocabulary.">
            Add project words
          </AdminUnavailableAction>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <SectionLabel>GAME READINESS</SectionLabel>
            <h2>What the server can verify</h2>
          </div>
          <Icon name="search" size={20} />
        </div>
        <div className="admin-readiness-list">
          <div>
            <span>Project Quiz / Race</span>
            <strong>
              {overview.readyQuestionCount > 0
                ? 'Approved questions available'
                : 'No approved questions returned'}
            </strong>
          </div>
          <div>
            <span>Word Seek and Scramble sources</span>
            <strong>Readiness not exposed in this response</strong>
          </div>
        </div>
      </section>
    </PageFrame>
  )
}

function AdminCommunityPicker({ section }: { readonly section: AdminSection | undefined }) {
  const session = useAppSession()
  if (session.status !== 'ready') return null
  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL"
      title="Choose a community"
      detail="Admin access is scoped per community. Select the server-authorized community you want to manage."
    >
      <section className="admin-community-picker">
        {session.data.adminCommunities.map((community) => (
          <Link
            className="admin-community-option"
            key={community.id}
            to={adminPath(community.id, section)}
          >
            <span className="admin-community-option-mark" aria-hidden="true">
              {community.title.slice(0, 1).toUpperCase()}
            </span>
            <span className="admin-community-option-copy">
              <strong>{community.title}</strong>
              <span>Server-authorized admin scope</span>
            </span>
            <Icon name="arrow-right" size={18} />
          </Link>
        ))}
      </section>
      <StatusBanner
        detail="Season state and community records load after selection. No client-side admin flag is used."
        icon="shield"
        title="Permission comes from the server"
        tone="info"
      />
    </PageFrame>
  )
}

function AdminScopeBar({
  communityName,
  status,
}: {
  readonly communityName: string
  readonly status: string
}) {
  return (
    <div className="admin-scope-bar">
      <div>
        <SectionLabel>SELECTED COMMUNITY</SectionLabel>
        <strong>{communityName}</strong>
      </div>
      <div className="admin-scope-bar-right">
        <span className="admin-scope-note">Server-derived scope</span>
        <ToneBadge tone={status === 'ACTIVE' ? 'success' : 'warning'}>{status}</ToneBadge>
      </div>
    </div>
  )
}

function AdminStat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="admin-stat">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  )
}

function AdminCapability({ game }: { readonly game: AppGameCapability }) {
  return (
    <div className="admin-capability">
      <span
        className={`admin-capability-dot ${game.enabled ? 'is-enabled' : ''}`}
        aria-hidden="true"
      />
      <div>
        <strong>{gameLabel(game.gameKey)}</strong>
        <span>{game.enabled ? 'Enabled for this community' : 'Disabled for this community'}</span>
      </div>
    </div>
  )
}

function AdminGameRow({
  game,
  readyQuestionCount,
}: {
  readonly game: AppGameCapability
  readonly readyQuestionCount: number
}) {
  const details: Record<string, { readonly icon: IconName; readonly detail: string }> = {
    project_quiz: {
      icon: 'list',
      detail:
        readyQuestionCount > 0
          ? `${readyQuestionCount.toLocaleString()} approved questions are ready for the shared quiz source.`
          : 'No approved questions were returned for the shared quiz source.',
    },
    word_seek: {
      icon: 'search',
      detail: 'First-solver word play runs in the community Telegram when enabled.',
    },
    scramble: {
      icon: 'game',
      detail: 'First-correct scramble play runs in the community Telegram when enabled.',
    },
  }
  const detail = details[game.gameKey] ?? {
    icon: 'game' as const,
    detail: 'Game state returned by the server.',
  }

  return (
    <article
      className={`admin-game-row admin-game-row-${game.gameKey} ${game.enabled ? 'is-enabled' : 'is-disabled'}`}
    >
      <span className="admin-game-icon" aria-hidden="true">
        <Icon name={detail.icon} size={22} />
      </span>
      <div className="admin-game-copy">
        <div className="admin-game-heading">
          <div>
            <SectionLabel>{game.gameKey.replaceAll('_', ' ')}</SectionLabel>
            <h2>{gameLabel(game.gameKey)}</h2>
          </div>
          <ToneBadge tone={game.enabled ? 'success' : 'neutral'}>
            {game.enabled ? 'Enabled' : 'Disabled'}
          </ToneBadge>
        </div>
        <p>{detail.detail}</p>
        <div className="admin-game-footer">
          <span>Play surface: Telegram</span>
          <AdminUnavailableAction explanation="The app API exposes no game capability mutation route yet.">
            Change in web
          </AdminUnavailableAction>
        </div>
      </div>
    </article>
  )
}

function AdminTaskRow({ task }: { readonly task: AppTask }) {
  return (
    <article className="admin-task-row">
      <div>
        <div className="admin-task-row-heading">
          <h3>{task.title}</h3>
          <ToneBadge tone="success">Active</ToneBadge>
        </div>
        <p>{task.instructions}</p>
        <div className="admin-task-row-meta">
          <span>+{task.points.toLocaleString()} community points</span>
          <span>Ends {formatDateTime(task.endsAt)}</span>
        </div>
      </div>
    </article>
  )
}

function ContentReadinessCard({
  detail,
  label,
  tone,
  value,
}: {
  readonly detail: string
  readonly label: string
  readonly tone: 'neutral' | 'success' | 'warning'
  readonly value: string
}) {
  return (
    <article className="admin-content-card">
      <div className="admin-card-topline">
        <SectionLabel>{label}</SectionLabel>
        <ToneBadge tone={tone}>{tone === 'neutral' ? 'Unavailable' : 'Live read'}</ToneBadge>
      </div>
      <strong className="admin-content-value">{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function AdminUnavailableAction({
  children,
  explanation,
}: {
  readonly children: ReactNode
  readonly explanation: string
}) {
  return (
    <div className="admin-unavailable-action">
      <Button disabled title={explanation} type="button" variant="secondary">
        {children}
      </Button>
      <p>{explanation}</p>
    </div>
  )
}

function AdminLoading({ label }: { readonly label: string }) {
  return (
    <div className="page-frame">
      <LoadingState label={label} />
    </div>
  )
}

function AdminResourceError({
  error,
  retry,
}: {
  readonly error: Error
  readonly retry: () => void
}) {
  const forbidden = error instanceof ApiError && error.status === 403
  const notFound = error instanceof ApiError && error.status === 404
  const unauthenticated = error instanceof ApiError && error.status === 401
  return (
    <div className="page-frame">
      <ErrorState
        detail={
          error.message ||
          (forbidden
            ? 'The server did not authorize this community.'
            : 'Rallyo could not load this community.')
        }
        onRetry={retry}
        title={
          forbidden
            ? 'This community is outside your admin scope.'
            : notFound
              ? 'This community was not found.'
              : unauthenticated
                ? 'Your Rallyo session has expired.'
                : 'Community control could not load.'
        }
      />
      <div className="admin-error-actions">
        <Link className="button button-outline" to="/app/admin">
          Choose another community
        </Link>
        <Link className="button button-primary" to="/app">
          Return to player view
        </Link>
      </div>
    </div>
  )
}
