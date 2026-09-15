import {
  createBrowserRouter,
  Link,
  isRouteErrorResponse,
  Outlet,
  useRouteError,
} from 'react-router-dom'

import { AdminGate, OperatorBoundary, PlayerGate, PublicShell } from './shells'
import { DesignShowcasePage } from './design-showcase'
import {
  AdminRoutePlaceholder,
  OpenSessionPage,
  PlayerHome,
  PlayerProfile,
  PlayerRoutePlaceholder,
  PublicHome,
} from './route-views'

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
      { index: true, element: <PlayerHome /> },
      {
        path: 'league',
        element: (
          <PlayerRoutePlaceholder
            title="League"
            detail="The real community competition surfaces will land here without inventing global Rallyo XP."
          />
        ),
      },
      {
        path: 'tasks',
        element: (
          <PlayerRoutePlaceholder
            title="Tasks"
            detail="Contribution tasks will show the real community proof and review state."
          />
        ),
      },
      {
        path: 'tasks/:taskId',
        element: (
          <PlayerRoutePlaceholder
            eyebrow="TASK DETAIL"
            title="Task detail"
            detail="This deep link is reserved for the real task submission flow."
          />
        ),
      },
      {
        path: 'communities',
        element: (
          <PlayerRoutePlaceholder
            title="Communities"
            detail="Your separate community records will be collected here."
          />
        ),
      },
      {
        path: 'communities/:communityId',
        element: (
          <PlayerRoutePlaceholder
            eyebrow="COMMUNITY RECORD"
            title="Community detail"
            detail="Leaderboard, games, tasks, and rewards will share this community boundary."
          />
        ),
      },
      {
        path: 'me',
        element: <PlayerProfile />,
      },
      {
        path: 'rewards',
        element: (
          <PlayerRoutePlaceholder
            title="Wallet and rewards"
            detail="Wallet linking remains optional. Claims will use the existing verified Nimiq path."
          />
        ),
      },
    ],
  },
  {
    path: '/app/admin',
    element: <AdminGate />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: (
          <AdminRoutePlaceholder
            title="Community overview"
            detail="The control surface will show active season state, games, tasks, and attention items."
          />
        ),
      },
      {
        path: ':communityId',
        element: (
          <AdminRoutePlaceholder
            title="Community overview"
            detail="The server derives access from the authenticated Telegram identity and target community."
          />
        ),
      },
      {
        path: ':communityId/games',
        element: (
          <AdminRoutePlaceholder
            title="Games"
            detail="Game capability controls will call the existing shared configuration service."
          />
        ),
      },
      {
        path: ':communityId/season',
        element: (
          <AdminRoutePlaceholder
            title="Season"
            detail="Season lifecycle controls will use the existing community-scoped service."
          />
        ),
      },
      {
        path: ':communityId/tasks',
        element: (
          <AdminRoutePlaceholder
            title="Social tasks"
            detail="Task creation and review will reuse the Telegram task service."
          />
        ),
      },
      {
        path: ':communityId/content',
        element: (
          <AdminRoutePlaceholder
            title="Project content"
            detail="Content readiness will respect the existing draft and approval rules."
          />
        ),
      },
      {
        path: 'games',
        element: (
          <AdminRoutePlaceholder
            title="Games"
            detail="Choose a community before managing game capability."
          />
        ),
      },
      {
        path: 'season',
        element: (
          <AdminRoutePlaceholder
            title="Season"
            detail="Choose a community before managing a season."
          />
        ),
      },
      {
        path: 'tasks',
        element: (
          <AdminRoutePlaceholder
            title="Social tasks"
            detail="Choose a community before managing tasks."
          />
        ),
      },
      {
        path: 'content',
        element: (
          <AdminRoutePlaceholder
            title="Project content"
            detail="Choose a community before reviewing content."
          />
        ),
      },
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
