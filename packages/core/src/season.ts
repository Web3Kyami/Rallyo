export type SeasonWindow = {
  readonly startsAt: Date
  readonly endsAt: Date
  readonly status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
}

export function isSeasonActiveAt(season: SeasonWindow, now: Date): boolean {
  return season.status === 'ACTIVE' && season.startsAt <= now && now < season.endsAt
}
