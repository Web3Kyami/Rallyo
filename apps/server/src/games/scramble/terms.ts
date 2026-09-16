export type GeneralScrambleTerm = {
  readonly term: string
  readonly category: string
  readonly difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
}

// The general pool is intentionally small, safe, and versioned in source control.
export const GENERAL_SCRAMBLE_TERMS: readonly GeneralScrambleTerm[] = [
  { term: 'community', category: 'General' },
  { term: 'challenge', category: 'General' },
  { term: 'telegram', category: 'General' },
  { term: 'leaderboard', category: 'General' },
  { term: 'season', category: 'General' },
  { term: 'celebrate', category: 'General' },
  { term: 'progress', category: 'General' },
  { term: 'puzzle', category: 'General' },
  { term: 'strategy', category: 'General' },
  { term: 'curiosity', category: 'General' },
  { term: 'momentum', category: 'General' },
  { term: 'welcome', category: 'General' },
  { term: 'together', category: 'General' },
  { term: 'festival', category: 'General' },
  { term: 'creative', category: 'General' },
  { term: 'network', category: 'General' },
  { term: 'signal', category: 'General' },
  { term: 'journey', category: 'General' },
  { term: 'discovery', category: 'General' },
  { term: 'friendly', category: 'General' },
  { term: 'nimble', category: 'General' },
  { term: 'reward', category: 'General' },
  { term: 'answer', category: 'General' },
  { term: 'brainstorm', category: 'General' },
]
