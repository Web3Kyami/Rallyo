import {
  createBrowserRouter,
  Link,
  isRouteErrorResponse,
  Outlet,
  useRouteError,
} from 'react-router-dom'

import { AdminGate, OperatorBoundary, PlayerGate, PublicShell } from './shells'
import { AdminEntryPage, AdminOverviewPage, AdminSectionRoute } from './admin-views'
import { DesignShowcasePage } from './design-showcase'
import { OpenSessionPage, PublicHome } from './route-views'
import {
  PlayerAvatarOnboardingPage,
  PlayerCommunitiesPage,
  PlayerCommunityDetailPage,
  PlayerEntryPage,
  PlayerHomePage,
  PlayerLeaguePage,
  PlayerPairPage,
  PlayerProfilePage,
  PlayerRewardsPage,
  PlayerTaskDetailPage,
  PlayerTasksPage,
} from './player-views'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicShell />,
    errorElement: <RouteErrorBoundary />,
    children: [{ index: true, element: <PublicHome /> }],
  },
  {
    path: '/app/open',
    element: <PublicShell />,
    errorElement: <RouteErrorBoundary />,
    children: [{ index: true, element: <OpenSessionPage /> }],
  },
  {
    path: '/app',
    element: <PlayerGate />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <PlayerHomePage /> },
      { path: 'start', element: <PlayerEntryPage /> },
      { path: 'pair', element: <PlayerPairPage /> },
      { path: 'onboarding/avatar', element: <PlayerAvatarOnboardingPage /> },
      { path: 'league', element: <PlayerLeaguePage /> },
      { path: 'tasks', element: <PlayerTasksPage /> },
      { path: 'tasks/:taskId', element: <PlayerTaskDetailPage /> },
      { path: 'communities', element: <PlayerCommunitiesPage /> },
      { path: 'communities/:communityId', element: <PlayerCommunityDetailPage /> },
      { path: 'me', element: <PlayerProfilePage /> },
      { path: 'rewards', element: <PlayerRewardsPage /> },
    ],
  },
  {
    path: '/app/admin',
    element: <AdminGate />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <AdminEntryPage /> },
      { path: ':communityId', element: <AdminOverviewPage /> },
      {
        path: ':communityId/games',
        element: <AdminSectionRoute section="games" />,
      },
      {
        path: ':communityId/season',
        element: <AdminSectionRoute section="season" />,
      },
      {
        path: ':communityId/tasks',
        element: <AdminSectionRoute section="tasks" />,
      },
      {
        path: ':communityId/content',
        element: <AdminSectionRoute section="content" />,
      },
      { path: 'games', element: <AdminSectionRoute section="games" /> },
      { path: 'season', element: <AdminSectionRoute section="season" /> },
      { path: 'tasks', element: <AdminSectionRoute section="tasks" /> },
      { path: 'content', element: <AdminSectionRoute section="content" /> },
    ],
  },
  { path: '/operator/*', element: <OperatorBoundary />, errorElement: <RouteErrorBoundary /> },
  ...(import.meta.env.DEV
    ? [
        {
          path: '/_phase8/showcase',
          element: <DesignShowcasePage />,
          errorElement: <RouteErrorBoundary />,
        },
      ]
    : []),
  { path: '*', element: <NotFound /> },
])

function RouteErrorBoundary() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'The route could not be loaded.'
  return (
    <div className="entry-gate">
      <div className="entry-card">
        <p className="eyebrow">ROUTE ERROR</p>
        <h1>Rallyo hit an unexpected state.</h1>
        <p>{detail}</p>
        <Link className="button button-outline" to="/">
          Return home
        </Link>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="entry-gate">
      <div className="entry-card">
        <p className="eyebrow">404</p>
        <h1>This route is not in the record.</h1>
        <p>Use the app navigation or return to the public Rallyo page.</p>
        <Link className="button button-primary" to="/">
          Return home
        </Link>
      </div>
    </div>
  )
}

export function RouterOutlet() {
  return <Outlet />
}
