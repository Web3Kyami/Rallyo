import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import {
  api,
  ApiError,
  type AppAdminPendingSubmission,
  type AppAdminQuestion,
  type AppAdminTask,
  type AppAdminWord,
  type AppGameCapability,
} from '../api/client'
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
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
      detail="Community status, games, season, tasks, and content."
      action={
        <Link className="button button-primary" to={adminPath(communityId, 'games')}>
          Manage games <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      <AdminScopeBar communityName={overview.community.title} status={overview.community.status} />

      {!active ? (
        <StatusBanner
          detail="New game and task activity is unavailable until the community is active."
          icon="warning"
          title={`Community status: ${overview.community.status}`}
          tone="warning"
        />
      ) : null}

      {!overview.activeSeason ? (
        <StatusBanner
          detail="No season is active. Season creation is not available here yet."
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
              ? 'Games and approved tasks contribute to this community season.'
              : 'Open Season to view the last available standings.'}
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
            <AdminStat label="Messages recorded" value={overview.activity.messageCount} />
            <AdminStat label="Active chatters" value={overview.activity.activePlayers} />
            <AdminStat label="Rewards issued" value={overview.rewards.entitlementCount} />
            <AdminStat label="Reward pool (Luna)" value={overview.rewards.totalAmountLuna} />
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
          <p className="admin-muted-copy">Starting a round remains a Telegram action.</p>
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
      detail="Choose which Telegram games are available here."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
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
              communityId={communityId}
              onChanged={resource.retry}
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
      detail="Active season and community standings."
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
              ? 'The leaderboard combines game and task score events.'
              : 'An active season is required before points can be awarded.'}
          </p>
        </div>
        <ToneBadge tone={data.activeSeason ? 'success' : 'warning'}>
          {data.activeSeason ? 'Running' : 'Not running'}
        </ToneBadge>
      </section>

      <section className="admin-action-panel">
        <div>
          <SectionLabel>SEASON LIFECYCLE</SectionLabel>
          <h2>Season actions are not available here yet</h2>
          <p>These actions stay disabled until the server exposes the matching season routes.</p>
        </div>
        <div className="admin-action-stack">
          <AdminUnavailableAction explanation="No server route is available yet.">
            Start a season
          </AdminUnavailableAction>
          <AdminUnavailableAction explanation="Requires an explicit server action.">
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
  const tasksLoad = useCallback(() => api.adminTasks(communityId), [communityId])
  const tasks = useResource(tasksLoad)

  if (overview.status === 'loading') return <AdminLoading label="Loading task control" />
  if (overview.status === 'error')
    return <AdminResourceError error={overview.error} retry={overview.retry} />
  const data = overview.data

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL / SOCIAL TASKS"
      title="Social tasks"
      detail="Create tasks and review player submissions."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      {data.pendingReviewCount > 0 ? (
        <StatusBanner
          detail={`${data.pendingReviewCount.toLocaleString()} pending submission${data.pendingReviewCount === 1 ? '' : 's'}.`}
          icon="warning"
          title="Review queue needs attention"
          tone="warning"
        />
      ) : (
        <StatusBanner
          detail="The review queue is clear."
          icon="check"
          title="No pending reviews"
          tone="success"
        />
      )}

      <section className="admin-action-panel admin-task-actions">
        <div>
          <SectionLabel>TASK LIFECYCLE</SectionLabel>
          <h2>Create a campaign</h2>
          <p>Create a task or archive expired tasks.</p>
        </div>
        <div className="admin-action-stack">
          <AdminCreateTaskForm
            communityId={communityId}
            onChanged={() => {
              tasks.retry()
              overview.retry()
            }}
          />
          <AdminArchiveExpiredTasks
            communityId={communityId}
            onChanged={() => {
              tasks.retry()
              overview.retry()
            }}
          />
        </div>
      </section>

      {tasks.status === 'ready' ? (
        <AdminReviewQueue
          communityId={communityId}
          submissions={tasks.data.pendingSubmissions}
          onChanged={() => {
            tasks.retry()
            overview.retry()
          }}
        />
      ) : null}

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
        detail="This view shows active tasks and pending submissions."
        icon="lock"
        title="Scoped active-task view"
        tone="info"
      />
    </PageFrame>
  )
}

export function AdminContentPage({ communityId }: { readonly communityId: string }) {
  const resource = useAdminOverview(communityId)
  const contentLoad = useCallback(() => api.adminContent(communityId), [communityId])
  const content = useResource(contentLoad)
  const [questionFormOpen, setQuestionFormOpen] = useState(false)
  const [wordFormOpen, setWordFormOpen] = useState(false)
  if (resource.status === 'loading') return <AdminLoading label="Loading project content state" />
  if (resource.status === 'error')
    return <AdminResourceError error={resource.error} retry={resource.retry} />
  const overview = resource.data
  const refreshContent = () => {
    content.retry()
    resource.retry()
  }

  return (
    <PageFrame
      eyebrow="COMMUNITY CONTROL / PROJECT CONTENT"
      title="Project content"
      detail="Approved content used by community games."
      action={
        <Link className="button button-outline" to={adminPath(communityId)}>
          Overview <Icon name="arrow-right" size={17} />
        </Link>
      }
    >
      <StatusBanner
        detail="Drafts can be added here. Approval remains server-owned."
        icon="lock"
        title="Approval remains server-owned"
        tone="info"
      />

      <div className="admin-content-grid">
        <ContentReadinessCard
          detail="Approved questions available here."
          label="Questions ready"
          value={overview.readyQuestionCount.toLocaleString()}
          tone={overview.readyQuestionCount > 0 ? 'success' : 'warning'}
        />
        <ContentReadinessCard
          detail={
            content.status === 'ready'
              ? 'Approved words available here.'
              : 'Loading approved words.'
          }
          label="Vocabulary"
          value={
            content.status === 'ready'
              ? content.data.words
                  .filter((word) => word.status === 'APPROVED')
                  .length.toLocaleString()
              : '...'
          }
          tone={content.status === 'ready' ? 'success' : 'neutral'}
        />
        <ContentReadinessCard
          detail="Not available from the current service."
          label="Prepared media"
          value="Not exposed"
          tone="neutral"
        />
      </div>

      <section className="admin-action-panel">
        <div>
          <SectionLabel>PROJECT BRAIN</SectionLabel>
          <h2>Add content drafts</h2>
          <p>Live Telegram games use approved records only.</p>
        </div>
        <div className="admin-action-stack">
          <Button
            onClick={() => setQuestionFormOpen((value) => !value)}
            type="button"
            variant="secondary"
          >
            {questionFormOpen ? 'Close question form' : 'Add a question draft'}
          </Button>
          <Button
            onClick={() => setWordFormOpen((value) => !value)}
            type="button"
            variant="secondary"
          >
            {wordFormOpen ? 'Close word form' : 'Add project word draft'}
          </Button>
        </div>
      </section>

      {questionFormOpen ? (
        <AdminQuestionDraftForm communityId={communityId} onCreated={refreshContent} />
      ) : null}
      {wordFormOpen ? (
        <AdminWordDraftForm communityId={communityId} onCreated={refreshContent} />
      ) : null}

      <section className="admin-section-block">
        <div className="admin-section-heading">
          <div>
            <SectionLabel>QUESTION BANK</SectionLabel>
            <h2>Community questions</h2>
          </div>
          <span className="admin-section-count">
            {content.status === 'ready' ? content.data.questions.length.toLocaleString() : '...'}{' '}
            records
          </span>
        </div>
        {content.status === 'loading' ? <LoadingState label="Loading project content" /> : null}
        {content.status === 'error' ? (
          <ErrorState
            detail={content.error.message}
            onRetry={content.retry}
            title="Project content could not be loaded."
          />
        ) : null}
        {content.status === 'ready' && content.data.questions.length === 0 ? (
          <EmptyState
            detail="No community question drafts or approvals have been returned."
            title="No community questions"
          />
        ) : null}
        {content.status === 'ready' && content.data.questions.length > 0 ? (
          <div className="admin-content-list">
            {content.data.questions.map((question) => (
              <AdminQuestionRow
                key={question.id}
                communityId={communityId}
                question={question}
                onChanged={refreshContent}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-section-block">
        <div className="admin-section-heading">
          <div>
            <SectionLabel>WORD SEEK</SectionLabel>
            <h2>Project vocabulary</h2>
          </div>
          <span className="admin-section-count">
            {content.status === 'ready' ? content.data.words.length.toLocaleString() : '...'}{' '}
            records
          </span>
        </div>
        {content.status === 'ready' && content.data.words.length === 0 ? (
          <EmptyState
            detail="No project word drafts or approvals have been returned."
            title="No project words"
          />
        ) : null}
        {content.status === 'ready' && content.data.words.length > 0 ? (
          <div className="admin-content-list">
            {content.data.words.map((word) => (
              <AdminWordRow
                key={word.id}
                communityId={communityId}
                word={word}
                onChanged={refreshContent}
              />
            ))}
          </div>
        ) : null}
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
            <span>Word Seek project sources</span>
            <strong>
              {content.status === 'ready'
                ? `${content.data.words.filter((word) => word.status === 'APPROVED').length.toLocaleString()} approved project words`
                : 'Project source read is loading'}
            </strong>
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

function AdminStat({ label, value }: { readonly label: string; readonly value: number | string }) {
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
  communityId,
  game,
  onChanged,
  readyQuestionCount,
}: {
  readonly communityId: string
  readonly game: AppGameCapability
  readonly onChanged: () => void
  readonly readyQuestionCount: number
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
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

  const changeCapability = async () => {
    setPending(true)
    setError(null)
    setSaved(false)
    try {
      await api.updateAdminGame(communityId, game.gameKey, { enabled: !game.enabled })
      setSaved(true)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capability could not be saved.')
    } finally {
      setPending(false)
    }
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
          <div className="admin-unavailable-action">
            <Button
              loading={pending}
              onClick={() => void changeCapability()}
              type="button"
              variant="secondary"
            >
              {game.enabled ? 'Disable capability' : 'Enable capability'}
            </Button>
            <p>
              {error ??
                (saved
                  ? 'Saved to this community. Telegram will use the updated capability state.'
                  : 'Only capability state changes here. The game itself stays in Telegram.')}
            </p>
          </div>
        </div>
      </div>
    </article>
  )
}

function AdminTaskRow({ task }: { readonly task: AppAdminTask }) {
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

function AdminCreateTaskForm({
  communityId,
  onChanged,
}: {
  readonly communityId: string
  readonly onChanged: () => void
}) {
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [points, setPoints] = useState('10')
  const [startsAt, setStartsAt] = useState(() => localDateTimeValue(new Date()))
  const [endsAt, setEndsAt] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 7 * 86_400_000)),
  )
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await api.createAdminTask(communityId, {
        title,
        instructions,
        points: Number(points),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      })
      setTitle('')
      setInstructions('')
      setMessage('Task created. It is now available through the server task feed.')
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Task could not be created.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="admin-inline-form" onSubmit={(event) => void submit(event)}>
      <Field
        label="Task title"
        onChange={(event) => setTitle(event.target.value)}
        required
        value={title}
      />
      <label className="admin-form-field">
        Instructions
        <textarea
          onChange={(event) => setInstructions(event.target.value)}
          required
          value={instructions}
        />
      </label>
      <div className="admin-form-grid">
        <Field
          label="Points"
          min="1"
          onChange={(event) => setPoints(event.target.value)}
          required
          type="number"
          value={points}
        />
        <Field
          label="Starts"
          onChange={(event) => setStartsAt(event.target.value)}
          required
          type="datetime-local"
          value={startsAt}
        />
        <Field
          label="Ends"
          onChange={(event) => setEndsAt(event.target.value)}
          required
          type="datetime-local"
          value={endsAt}
        />
      </div>
      {error ? <p className="field-message field-message-error">{error}</p> : null}
      {message ? <p className="field-message">{message}</p> : null}
      <Button loading={pending} type="submit" variant="primary">
        Create task
      </Button>
    </form>
  )
}

function AdminArchiveExpiredTasks({
  communityId,
  onChanged,
}: {
  readonly communityId: string
  readonly onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const archive = async () => {
    setPending(true)
    setMessage(null)
    try {
      const result = await api.archiveExpiredAdminTasks(communityId)
      setMessage(
        result.archivedCount === 0
          ? 'No expired active tasks were found.'
          : `${result.archivedCount} expired task${result.archivedCount === 1 ? '' : 's'} archived.`,
      )
      onChanged()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Expired tasks could not be archived.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="admin-unavailable-action">
      <Button loading={pending} onClick={() => void archive()} type="button" variant="secondary">
        Archive expired tasks
      </Button>
      {message ? <p>{message}</p> : null}
    </div>
  )
}

function AdminReviewQueue({
  communityId,
  submissions,
  onChanged,
}: {
  readonly communityId: string
  readonly submissions: readonly AppAdminPendingSubmission[]
  readonly onChanged: () => void
}) {
  return (
    <section className="admin-section-block">
      <div className="admin-section-heading">
        <div>
          <SectionLabel>REVIEW QUEUE</SectionLabel>
          <h2>Pending submissions</h2>
        </div>
        <span className="admin-section-count">{submissions.length.toLocaleString()} pending</span>
      </div>
      {submissions.length === 0 ? (
        <EmptyState
          detail="Approved and rejected submissions leave this queue."
          title="Queue is clear"
        />
      ) : (
        <div className="admin-content-list">
          {submissions.map((submission) => (
            <AdminReviewRow
              key={submission.id}
              communityId={communityId}
              submission={submission}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AdminReviewRow({
  communityId,
  submission,
  onChanged,
}: {
  readonly communityId: string
  readonly submission: AppAdminPendingSubmission
  readonly onChanged: () => void
}) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const review = async (action: 'approve' | 'reject') => {
    setPending(action)
    setError(null)
    try {
      if (action === 'approve') await api.approveAdminSubmission(communityId, submission.id)
      else await api.rejectAdminSubmission(communityId, submission.id, reason)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission could not be reviewed.')
    } finally {
      setPending(null)
    }
  }
  return (
    <article className="admin-content-row">
      <div className="admin-content-row-copy">
        <div className="admin-task-row-heading">
          <h3>{submission.taskTitle}</h3>
          <ToneBadge tone="warning">Pending</ToneBadge>
        </div>
        <p>
          {submission.player.displayName} · submitted {formatDateTime(submission.createdAt)}
        </p>
        <code className="admin-reference">{submission.reference}</code>
        <input
          aria-label={`Rejection reason for ${submission.taskTitle}`}
          className="admin-compact-input"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Optional rejection reason"
          value={reason}
        />
      </div>
      <div className="admin-row-actions">
        <Button
          loading={pending === 'approve'}
          onClick={() => void review('approve')}
          type="button"
        >
          Approve
        </Button>
        <Button
          loading={pending === 'reject'}
          onClick={() => void review('reject')}
          type="button"
          variant="danger"
        >
          Reject
        </Button>
        {error ? <p className="field-message field-message-error">{error}</p> : null}
      </div>
    </article>
  )
}

function AdminQuestionDraftForm({
  communityId,
  onCreated,
}: {
  readonly communityId: string
  readonly onCreated: () => void
}) {
  const [values, setValues] = useState({
    sourceTitle: '',
    sourceText: '',
    prompt: '',
    correctAnswer: '',
    category: '',
    difficulty: 'medium' as 'easy' | 'medium' | 'hard',
  })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await api.createAdminQuestionDraft(communityId, values)
      setMessage('Question saved as a draft. Approve it below when it is ready.')
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Question draft could not be created.')
    } finally {
      setPending(false)
    }
  }
  return (
    <form className="admin-inline-panel admin-inline-form" onSubmit={(event) => void submit(event)}>
      <div className="admin-section-heading">
        <div>
          <SectionLabel>QUESTION DRAFT</SectionLabel>
          <h2>One server-validated question</h2>
        </div>
      </div>
      <div className="admin-form-grid">
        <Field
          label="Source title"
          onChange={(event) => setValues({ ...values, sourceTitle: event.target.value })}
          required
          value={values.sourceTitle}
        />
        <Field
          label="Category"
          onChange={(event) => setValues({ ...values, category: event.target.value })}
          required
          value={values.category}
        />
        <label className="admin-form-field">
          Difficulty
          <select
            className="admin-select"
            onChange={(event) =>
              setValues({ ...values, difficulty: event.target.value as typeof values.difficulty })
            }
            value={values.difficulty}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>
      <label className="admin-form-field">
        Source text
        <textarea
          minLength={20}
          onChange={(event) => setValues({ ...values, sourceText: event.target.value })}
          required
          value={values.sourceText}
        />
      </label>
      <label className="admin-form-field">
        Prompt
        <textarea
          minLength={12}
          onChange={(event) => setValues({ ...values, prompt: event.target.value })}
          required
          value={values.prompt}
        />
      </label>
      <Field
        label="Correct answer"
        onChange={(event) => setValues({ ...values, correctAnswer: event.target.value })}
        required
        value={values.correctAnswer}
      />
      {error ? <p className="field-message field-message-error">{error}</p> : null}
      {message ? <p className="field-message">{message}</p> : null}
      <Button loading={pending} type="submit">
        Save question draft
      </Button>
    </form>
  )
}

function AdminWordDraftForm({
  communityId,
  onCreated,
}: {
  readonly communityId: string
  readonly onCreated: () => void
}) {
  const [word, setWord] = useState('')
  const [clue, setClue] = useState('')
  const [sourceRef, setSourceRef] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await api.createAdminWordDraft(communityId, {
        word,
        ...(clue ? { clue } : {}),
        ...(sourceRef ? { sourceRef } : {}),
      })
      setMessage('Word saved as a draft. Approve it below before Word Seek can use it.')
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Word draft could not be created.')
    } finally {
      setPending(false)
    }
  }
  return (
    <form className="admin-inline-panel admin-inline-form" onSubmit={(event) => void submit(event)}>
      <div className="admin-section-heading">
        <div>
          <SectionLabel>WORD DRAFT</SectionLabel>
          <h2>Project vocabulary</h2>
        </div>
      </div>
      <div className="admin-form-grid">
        <Field
          label="Word"
          maxLength={6}
          minLength={4}
          onChange={(event) => setWord(event.target.value)}
          required
          value={word}
        />
        <Field
          label="Source reference"
          onChange={(event) => setSourceRef(event.target.value)}
          value={sourceRef}
        />
      </div>
      <label className="admin-form-field">
        Clue (optional)
        <textarea maxLength={500} onChange={(event) => setClue(event.target.value)} value={clue} />
      </label>
      {error ? <p className="field-message field-message-error">{error}</p> : null}
      {message ? <p className="field-message">{message}</p> : null}
      <Button loading={pending} type="submit">
        Save word draft
      </Button>
    </form>
  )
}

function AdminQuestionRow({
  communityId,
  question,
  onChanged,
}: {
  readonly communityId: string
  readonly question: AppAdminQuestion
  readonly onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approve = async () => {
    setPending(true)
    setError(null)
    try {
      await api.approveAdminQuestion(communityId, question.id)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Question could not be approved.')
    } finally {
      setPending(false)
    }
  }
  return (
    <article className="admin-content-row">
      <div className="admin-content-row-copy">
        <div className="admin-task-row-heading">
          <h3>{question.prompt}</h3>
          <ToneBadge tone={question.status === 'APPROVED' ? 'success' : 'warning'}>
            {question.status}
          </ToneBadge>
        </div>
        <p>
          {question.category} · {question.difficulty} · +{question.basePoints} points
        </p>
      </div>
      {question.status === 'DRAFT' ? (
        <div className="admin-row-actions">
          <Button loading={pending} onClick={() => void approve()} type="button">
            Approve
          </Button>
          {error ? <p className="field-message field-message-error">{error}</p> : null}
        </div>
      ) : null}
    </article>
  )
}

function AdminWordRow({
  communityId,
  word,
  onChanged,
}: {
  readonly communityId: string
  readonly word: AppAdminWord
  readonly onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approve = async () => {
    setPending(true)
    setError(null)
    try {
      await api.approveAdminWord(communityId, word.id)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Word could not be approved.')
    } finally {
      setPending(false)
    }
  }
  return (
    <article className="admin-content-row">
      <div className="admin-content-row-copy">
        <div className="admin-task-row-heading">
          <h3>{word.word}</h3>
          <ToneBadge tone={word.status === 'APPROVED' ? 'success' : 'warning'}>
            {word.status}
          </ToneBadge>
        </div>
        <p>
          {word.wordLength} letters{word.clue ? ` · ${word.clue}` : ''}
        </p>
      </div>
      {word.status === 'DRAFT' ? (
        <div className="admin-row-actions">
          <Button loading={pending} onClick={() => void approve()} type="button">
            Approve
          </Button>
          {error ? <p className="field-message field-message-error">{error}</p> : null}
        </div>
      ) : null}
    </article>
  )
}

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
