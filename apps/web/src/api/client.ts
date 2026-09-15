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
  adminOverview: (communityId: string) =>
    request<AppAdminOverview>(`/api/app/admin/communities/${encodeURIComponent(communityId)}`),
  updateAdminGame: (
    communityId: string,
    gameKey: string,
    input: { readonly enabled: boolean; readonly config?: Record<string, unknown> },
  ) =>
    request<{ readonly capability: AppGameCapability }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/games/${encodeURIComponent(gameKey)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  adminTasks: (communityId: string) =>
    request<AppAdminTasks>(`/api/app/admin/communities/${encodeURIComponent(communityId)}/tasks`),
  createAdminTask: (
    communityId: string,
    input: {
      readonly title: string
      readonly instructions: string
      readonly points: number
      readonly startsAt: string
      readonly endsAt: string
      readonly maxSubmissionsPerPlayer?: number
      readonly cooldownDays?: number
    },
  ) =>
    request<{ readonly task: AppAdminTask }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/tasks`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  archiveExpiredAdminTasks: (communityId: string) =>
    request<{ readonly archivedCount: number }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/tasks/archive-expired`,
      { method: 'POST' },
    ),
  approveAdminSubmission: (communityId: string, submissionId: string) =>
    request<{ readonly result: unknown }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/tasks/submissions/${encodeURIComponent(submissionId)}/approve`,
      { method: 'POST' },
    ),
  rejectAdminSubmission: (communityId: string, submissionId: string, reason?: string) =>
    request<{ readonly result: unknown }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/tasks/submissions/${encodeURIComponent(submissionId)}/reject`,
      { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
    ),
  adminContent: (communityId: string) =>
    request<AppAdminContent>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/content`,
    ),
  createAdminQuestionDraft: (
    communityId: string,
    input: {
      readonly sourceTitle: string
      readonly sourceText: string
      readonly prompt: string
      readonly correctAnswer: string
      readonly category: string
      readonly difficulty: 'easy' | 'medium' | 'hard'
    },
  ) =>
    request<{ readonly question: AppAdminQuestion }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/content/questions/drafts`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  approveAdminQuestion: (communityId: string, questionId: string) =>
    request<{ readonly question: AppAdminQuestion }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/content/questions/${encodeURIComponent(questionId)}/approve`,
      { method: 'POST' },
    ),
  createAdminWordDraft: (
    communityId: string,
    input: { readonly word: string; readonly clue?: string; readonly sourceRef?: string },
  ) =>
    request<{ readonly word: AppAdminWord }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/content/words/drafts`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  approveAdminWord: (communityId: string, wordId: string) =>
    request<{ readonly word: AppAdminWord }>(
      `/api/app/admin/communities/${encodeURIComponent(communityId)}/content/words/${encodeURIComponent(wordId)}/approve`,
      { method: 'POST' },
    ),
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

export type AppAdminOverview = {
  readonly community: {
    readonly id: string
    readonly title: string
    readonly slug: string
    readonly status: string
  }
  readonly activeSeason: string | null
  readonly readyQuestionCount: number
  readonly nextRoundAt: string | null
  readonly participantCount: number
  readonly activeTaskCount: number
  readonly pendingReviewCount: number
  readonly activity: {
    readonly messageCount: number
    readonly replyCount: number
    readonly activePlayers: number
    readonly lastBucketAt: string | null
  }
  readonly rewards: {
    readonly entitlementCount: number
    readonly totalAmountLuna: string
    readonly eligibleCount: number
    readonly sentCount: number
    readonly confirmedCount: number
    readonly failedCount: number
  }
  readonly games: readonly AppGameCapability[]
}

export type AppAdminTask = {
  readonly id: string
  readonly communityId: string
  readonly title: string
  readonly instructions: string
  readonly points: number
  readonly startsAt: string
  readonly endsAt: string
  readonly maxSubmissionsPerPlayer: number | null
  readonly cooldownDays: number
  readonly status: string
}

export type AppAdminPendingSubmission = {
  readonly id: string
  readonly taskId: string
  readonly taskTitle: string
  readonly player: { readonly displayName: string; readonly username: string | null }
  readonly reference: string
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED'
  readonly createdAt: string
}

export type AppAdminTasks = {
  readonly tasks: readonly AppAdminTask[]
  readonly pendingSubmissions: readonly AppAdminPendingSubmission[]
}

export type AppAdminQuestion = {
  readonly id: string
  readonly mode: string
  readonly category: string
  readonly difficulty: string
  readonly prompt: string
  readonly basePoints: number
  readonly status: 'DRAFT' | 'APPROVED' | 'ARCHIVED'
  readonly source: string
  readonly createdAt: string
}

export type AppAdminWord = {
  readonly id: string
  readonly word: string
  readonly wordLength: number
  readonly clue: string | null
  readonly sourceRef: string | null
  readonly status: 'DRAFT' | 'APPROVED' | 'ARCHIVED'
  readonly createdAt: string
  readonly updatedAt: string
}

export type AppAdminContent = {
  readonly questions: readonly AppAdminQuestion[]
  readonly words: readonly AppAdminWord[]
}
