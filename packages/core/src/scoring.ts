export type ScoreEvent = {
  readonly id: string
  readonly playerId: string
  readonly communityId: string
  readonly seasonId: string
  readonly roundId: string
  readonly questionId: string
  readonly delta: number
  readonly idempotencyKey: string
  readonly createdAt: Date
}

export type LeaderboardRow = {
  readonly playerId: string
  readonly points: number
  readonly rank: number
}

export function leaderboardForSeason(
  scoreEvents: readonly ScoreEvent[],
  communityId: string,
  seasonId: string,
): LeaderboardRow[] {
  const totals = new Map<string, number>()

  for (const event of scoreEvents) {
    if (event.communityId !== communityId || event.seasonId !== seasonId) {
      continue
    }

    totals.set(event.playerId, (totals.get(event.playerId) ?? 0) + event.delta)
  }

  return [...totals.entries()]
    .sort(([leftPlayerId, leftPoints], [rightPlayerId, rightPoints]) => {
      return rightPoints - leftPoints || leftPlayerId.localeCompare(rightPlayerId)
    })
    .map(([playerId, points], index) => ({ playerId, points, rank: index + 1 }))
}

export function lifetimeXpForPlayer(scoreEvents: readonly ScoreEvent[], playerId: string): number {
  return scoreEvents
    .filter((event) => event.playerId === playerId)
    .reduce((total, event) => total + event.delta, 0)
}

export function scoreEventKey(roundId: string, playerId: string): string {
  return `round:${roundId}:player:${playerId}`
}
