export const roundStates = [
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'LOCKED',
  'SCORED',
  'CLOSED',
  'VOID',
] as const

export type RoundState = (typeof roundStates)[number]

const allowedTransitions: Readonly<Record<RoundState, readonly RoundState[]>> = {
  DRAFT: ['SCHEDULED', 'VOID'],
  SCHEDULED: ['LIVE', 'VOID'],
  LIVE: ['LOCKED', 'VOID'],
  LOCKED: ['SCORED', 'VOID'],
  SCORED: ['CLOSED', 'VOID'],
  CLOSED: [],
  VOID: [],
}

export class InvalidRoundTransitionError extends Error {
  constructor(from: RoundState, to: RoundState) {
    super(`Round cannot transition from ${from} to ${to}.`)
    this.name = 'InvalidRoundTransitionError'
  }
}

export function canTransitionRound(from: RoundState, to: RoundState): boolean {
  return allowedTransitions[from].includes(to)
}

export function transitionRound(from: RoundState, to: RoundState): RoundState {
  if (!canTransitionRound(from, to)) {
    throw new InvalidRoundTransitionError(from, to)
  }

  return to
}
