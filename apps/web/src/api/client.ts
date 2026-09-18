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
  progression: () => request<RallyoProgression>('/api/app/progression'),
  claimDailyCheckin: () =>
    request<DailyCheckinClaimResult>('/api/app/progression/daily-checkin', { method: 'POST' }),
  globalLeague: () => request<GlobalLeague>('/api/app/league'),
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
  operatorLogin: (accessKey: string) =>
    request<{ readonly ok: true; readonly expiresAt: string }>('/api/operator/session', {
      method: 'POST',
      body: JSON.stringify({ accessKey }),
    }),
  operatorMe: () => request<OperatorBootstrap>('/api/operator/me'),
  operatorOverview: () => request<OperatorOverview>('/api/operator/overview'),
  operatorCommunities: (query?: string) =>
    request<{ readonly communities: readonly OperatorCommunity[] }>(
      query
        ? `/api/operator/communities?query=${encodeURIComponent(query)}`
        : '/api/operator/communities',
    ),
  operatorCommunity: (communityId: string) =>
    request<OperatorCommunityDetail>(
      `/api/operator/communities/${encodeURIComponent(communityId)}`,
    ),
  operatorPlayers: (query: string) =>
    request<{ readonly players: readonly OperatorPlayerSearchResult[] }>(
      `/api/operator/players?query=${encodeURIComponent(query)}`,
    ),
  operatorPlayer: (playerId: string) =>
    request<OperatorPlayerDetail>(`/api/operator/players/${encodeURIComponent(playerId)}`),
  operatorRevokeWallet: (playerId: string, walletIdentityId: string) =>
    request<OperatorWalletRevocation>(
      `/api/operator/players/${encodeURIComponent(playerId)}/wallet/revoke`,
      { method: 'POST', body: JSON.stringify({ walletIdentityId }) },
    ),
  operatorRevokePairingCodes: (playerId: string) =>
    request<{ readonly revokedCount: number }>(
      `/api/operator/players/${encodeURIComponent(playerId)}/telegram/revoke-pairing`,
      { method: 'POST' },
    ),
  operatorPrepareRecovery: (playerId: string) =>
    request<{ readonly code: string; readonly expiresAt: string; readonly id: string }>(
      `/api/operator/players/${encodeURIComponent(playerId)}/telegram/prepare-recovery`,
      { method: 'POST' },
    ),
  operatorLogout: () =>
    request<{ readonly ok: true }>('/api/operator/session/logout', { method: 'POST' }),
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
  readonly progression: RallyoProgression
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

export type RallyoProgression = {
  readonly totalXp: number
  readonly todayClaimed: boolean
  readonly nextEligibleAt: string
  readonly globalRank: number | null
}

export type DailyCheckinClaimResult = {
  readonly claimed: boolean
  readonly xpAwarded: number
  readonly progression: RallyoProgression
}

export type GlobalLeagueEntry = {
  readonly playerId: string
  readonly displayName: string
  readonly totalXp: number
  readonly rank: number
  readonly isCurrentPlayer: boolean
}

export type GlobalLeague = {
  readonly leaderboard: readonly GlobalLeagueEntry[]
  readonly currentPlayer: GlobalLeagueEntry
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

export type OperatorScoreActivity = {
  readonly id: string
  readonly playerId: string
  readonly playerName: string
  readonly communityId: string
  readonly communityTitle: string
  readonly sourceType: 'QUIZ' | 'WORD_SEEK' | 'SCRAMBLE' | 'SOCIAL_TASK' | 'MANUAL'
  readonly delta: number
  readonly reason: string
  readonly createdAt: string
}

export type OperatorSocialTaskMetrics = {
  readonly total: number
  readonly active: number
  readonly paused: number
  readonly archived: number
  readonly submissions: number
  readonly pending: number
  readonly approved: number
  readonly rejected: number
}

export type OperatorRewardMetrics = {
  readonly total: number
  readonly totalAmountLuna: string
  readonly byStatus: Readonly<
    Record<'ELIGIBLE' | 'CLAIMING' | 'SENT' | 'CONFIRMED' | 'FAILED', number>
  >
}

export type OperatorOverview = {
  readonly generatedAt: string
  readonly metrics: {
    readonly players: number
    readonly communities: number
    readonly activeSeasonCommunities: number
    readonly totalScoreEvents: number
    readonly recentScoreEvents: number
    readonly telegramLinkedPlayers: number
    readonly walletLinkedPlayers: number
    readonly games: {
      readonly projectQuiz: {
        readonly rounds: number
        readonly scoreEvents: number
        readonly activeRounds: number
      }
      readonly scramble: {
        readonly rounds: number
        readonly scoreEvents: number
        readonly activeRounds: number
      }
      readonly wordSeek: {
        readonly sessions: number
        readonly scoreEvents: number
        readonly activeSessions: number
      }
    }
    readonly socialTasks: OperatorSocialTaskMetrics
    readonly rewards: OperatorRewardMetrics
  }
  readonly recentScoringActivity: readonly OperatorScoreActivity[]
}

export type OperatorBootstrap = {
  readonly session: { readonly sessionId: string; readonly expiresAt: string }
  readonly generatedAt: string
  readonly overview: OperatorOverview
}

export type OperatorGameCapability = { readonly gameKey: string; readonly enabled: boolean }

export type OperatorCommunity = {
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly telegramChatId: string
  readonly status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
  readonly timezone: string
  readonly createdAt: string
  readonly activeSeason: {
    readonly id: string
    readonly name: string
    readonly startsAt: string
    readonly endsAt: string
  } | null
  readonly playersWithScores: number
  readonly scoreEventCount: number
  readonly activeTaskCount: number
  readonly pendingReviewCount: number
  readonly lastMeaningfulActivity: string | null
  readonly games: readonly OperatorGameCapability[]
}

export type OperatorCommunityDetail = {
  readonly community: {
    readonly id: string
    readonly title: string
    readonly slug: string
    readonly telegramChatId: string
    readonly status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
    readonly timezone: string
    readonly automaticRoundsEnabled: boolean
    readonly createdAt: string
  }
  readonly activeSeason: {
    readonly id: string
    readonly name: string
    readonly startsAt: string
    readonly endsAt: string
    readonly status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
    readonly rewardPoolLuna: string | null
  } | null
  readonly stats: {
    readonly playersWithScores: number
    readonly scoreEventCount: number
    readonly activeTaskCount: number
    readonly pendingReviewCount: number
    readonly lastMeaningfulActivity: string | null
  }
  readonly games: readonly OperatorGameCapability[]
  readonly tasks: OperatorSocialTaskMetrics
  readonly rewards: OperatorRewardMetrics
  readonly topPlayers: readonly {
    readonly playerId: string
    readonly displayName: string
    readonly rank: number
    readonly scoreEventCount: number
    readonly points: number
  }[]
  readonly recentScoringActivity: readonly OperatorScoreActivity[]
}

export type OperatorPlayerSearchResult = {
  readonly id: string
  readonly displayName: string
  readonly username: string | null
  readonly telegramUserId: string | null
  readonly walletAddress: string | null
  readonly createdAt: string
  readonly lastSeenAt: string
  readonly scoreEventCount: number
  readonly totalPoints: number
}

export type OperatorPlayerDetail = {
  readonly player: { readonly id: string; readonly createdAt: string; readonly lastSeenAt: string }
  readonly telegramIdentities: readonly {
    readonly id: string
    readonly telegramUserId: string
    readonly username: string | null
    readonly displayName: string
    readonly firstSeenAt: string
    readonly lastSeenAt: string
  }[]
  readonly walletIdentities: readonly {
    readonly id: string
    readonly address: string
    readonly linkedAt: string
    readonly revokedAt: string | null
  }[]
  readonly adminRoles: readonly {
    readonly communityId: string
    readonly communityTitle: string
    readonly telegramUserId: string
    readonly lastVerifiedAt: string
  }[]
  readonly communities: readonly {
    readonly communityId: string
    readonly communityTitle: string
    readonly communityStatus: string
    readonly scoreEventCount: number
    readonly points: number
    readonly lastScoreAt: string | null
  }[]
  readonly scoreSummary: {
    readonly totalScoreEvents: number
    readonly totalPoints: number
    readonly bySource: readonly {
      readonly sourceType: string
      readonly scoreEventCount: number
      readonly points: number
    }[]
  }
  readonly rewards: readonly {
    readonly id: string
    readonly communityTitle: string
    readonly seasonName: string
    readonly rank: number
    readonly amountLuna: string
    readonly status: string
    readonly transactionHash: string | null
    readonly createdAt: string
  }[]
  readonly recovery: { readonly unusedPairingCodes: number }
  readonly audit: readonly {
    readonly id: string
    readonly action: string
    readonly metadata: Record<string, unknown>
    readonly createdAt: string
  }[]
}

export type OperatorWalletRevocation = {
  readonly id: string
  readonly address: string
  readonly revokedAt: string
  readonly pendingRewardCount: number
}
