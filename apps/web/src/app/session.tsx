import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { api, ApiError, type AppBootstrap } from '../api/client'
import { ErrorState, LoadingState } from '../components/primitives'

type SessionState =
  | { readonly status: 'loading'; readonly data: null; readonly error: null }
  | { readonly status: 'ready'; readonly data: AppBootstrap; readonly error: null }
  | { readonly status: 'anonymous'; readonly data: null; readonly error: ApiError | null }

type SessionContextValue = SessionState & {
  readonly refresh: () => Promise<void>
  readonly logout: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { readonly children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', data: null, error: null })

  const refresh = async () => {
    try {
      setState((current) =>
        current.status === 'ready' ? current : { status: 'loading', data: null, error: null },
      )
      const data = await api.bootstrap()
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: 'anonymous', data: null, error })
      } else {
        setState({
          status: 'anonymous',
          data: null,
          error: error instanceof ApiError ? error : null,
        })
      }
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const logout = async () => {
    await api.logout().catch(() => undefined)
    setState({ status: 'anonymous', data: null, error: null })
  }

  const value = useMemo(() => ({ ...state, refresh, logout }), [state])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useAppSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useAppSession must be used inside SessionProvider.')
  return context
}

export function SessionLoadingBoundary() {
  const session = useAppSession()
  if (session.status === 'loading') return <LoadingState />
  if (session.status === 'ready') return null
  return (
    <ErrorState
      title="Rallyo needs a session."
      detail={session.error?.message ?? 'Open Rallyo from Telegram to continue.'}
    />
  )
}
