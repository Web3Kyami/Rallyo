export type ApiErrorShape = {
  readonly code: string
  readonly message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, error: ApiErrorShape) {
    super(error.message)
    this.name = 'ApiError'
    this.status = status
    this.code = error.code
  }
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? window.location.origin

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const payload = (await response.json().catch(() => null)) as
    T | { readonly error?: ApiErrorShape } | null
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined
    throw new ApiError(
      response.status,
      error ?? { code: 'HTTP_ERROR', message: 'Rallyo could not complete that request.' },
    )
  }
  if (payload === null) {
    throw new ApiError(502, {
      code: 'INVALID_API_RESPONSE',
      message: 'Rallyo received an invalid response from the app service.',
    })
  }
  return payload as T
}

export const api = {
  bootstrap: () => request<AppBootstrap>('/api/app/me'),
  listCommunities: () =>
    request<{ readonly communities: readonly AppCommunity[] }>('/api/app/communities'),
  community: (communityId: string) =>
    request<AppCommunityDetail>(`/api/app/communities/${encodeURIComponent(communityId)}`),
  leaderboard: (communityId: string) =>
    request<{ readonly leaderboard: readonly AppLeaderboardEntry[] }>(
      `/api/app/communities/${encodeURIComponent(communityId)}/leaderboard`,
    ),
  tasks: (communityId?: string) =>
    request<{ readonly tasks: readonly AppTask[] }>(
      communityId
        ? `/api/app/tasks?communityId=${encodeURIComponent(communityId)}`
        : '/api/app/tasks',
    ),
  task: (taskId: string) => request<AppTaskDetail>(`/api/app/tasks/${encodeURIComponent(taskId)}`),
  rewards: () => request<AppRewards>('/api/app/rewards'),
  exchangeSession: (code: string) =>
    request<{ readonly redirectPath: string }>('/api/app/session/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  walletChallenge: (address: string) =>
    request<WalletAuthChallenge>('/api/app/wallet/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    }),
  walletComplete: (input: WalletAuthCompletion) =>
    request<{ readonly redirectPath: string }>('/api/app/wallet/complete', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  pairTelegram: (code: string) =>
    request<{ readonly playerId: string; readonly redirectPath: string }>(
      '/api/app/telegram/pair',
      {
        method: 'POST',
        body: JSON.stringify({ code }),
      },
    ),
  logout: () => request<{ readonly ok: true }>('/api/app/session/logout', { method: 'POST' }),
}

export type WalletAuthChallenge = {
  readonly challengeId: string
  readonly message: string
  readonly expiresAt: string
}

export type WalletAuthCompletion = {
  readonly challengeId: string
  readonly message: string
  readonly publicKey: string
  readonly signature: string
}

export type AppCommunity = {
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly status: string
  readonly activeSeason: {
    readonly id: string
    readonly name: string
    readonly endsAt: string
  } | null
  readonly points: number
  readonly rank: number | null
  readonly isAdmin: boolean
}

export type AppGameCapability = {
  readonly gameKey: string
  readonly enabled: boolean
}

export type AppLeaderboardEntry = {
  readonly playerId: string
  readonly displayName: string
  readonly points: number
  readonly rank: number
  readonly isCurrentPlayer: boolean
}

export type AppTaskSubmission = {
  readonly id?: string
  readonly taskId?: string
  readonly playerId?: string
  readonly reference?: string
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED'
  readonly createdAt: string
  readonly reviewedAt?: string | null
  readonly rejectionReason?: string | null
}

export type AppTask = {
  readonly id: string
  readonly communityId: string
  readonly communityTitle: string
  readonly title: string
  readonly instructions: string
  readonly points: number
  readonly startsAt: string
  readonly endsAt: string
  readonly submission: Pick<AppTaskSubmission, 'taskId' | 'status' | 'createdAt'> | null
}

export type AppTaskDetail = {
  readonly id: string
  readonly communityId: string
  readonly communityTitle: string
  readonly title: string
  readonly instructions: string
  readonly points: number
  readonly startsAt: string
  readonly endsAt: string
  readonly maxSubmissionsPerPlayer: number | null
  readonly cooldownDays: number
  readonly status: string
  readonly isOpen: boolean
  readonly submission: AppTaskSubmission | null
}

export type AppCommunityDetail = {
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly status: string
  readonly timezone: string
  readonly activeSeason: {
    readonly id: string
    readonly name: string
    readonly startsAt: string
    readonly endsAt: string
  } | null
  readonly player: {
    readonly points: number
    readonly rank: number | null
  }
  readonly leaderboard: readonly AppLeaderboardEntry[]
  readonly games: readonly AppGameCapability[]
  readonly tasks: readonly AppTask[]
}

export type AppRewardEntitlement = {
  readonly id: string
  readonly seasonId: string
  readonly communityTitle: string
  readonly seasonName: string
  readonly rank: number
  readonly amountLuna: string
  readonly status: string
  readonly transactionHash: string | null
  readonly createdAt: string
}

export type AppRewards = {
  readonly wallet: { readonly linked: true; readonly address: string } | { readonly linked: false }
  readonly entitlements: readonly AppRewardEntitlement[]
}

export type AppBootstrap = {
  readonly session: {
    readonly targetMode: 'player' | 'admin'
    readonly targetCommunityId: string | null
    readonly expiresAt: string
  }
  readonly player: {
    readonly id: string
    readonly displayName: string
    readonly username: string | null
  }
  readonly wallet: { readonly linked: true; readonly address: string } | { readonly linked: false }
  readonly communities: readonly AppCommunity[]
  readonly adminCommunities: readonly {
    readonly id: string
    readonly title: string
    readonly telegramChatId: string
  }[]
  readonly featureFlags: {
    readonly walletLinking: boolean
    readonly globalLeague: boolean
  }
}
