import type { GameKey } from './community-game-config-service'

export type GameStartCheck = {
  readonly communityId: string
  readonly now: Date
  readonly config: Record<string, unknown>
}

export interface GameModule {
  readonly key: GameKey
  validateStart(input: GameStartCheck): Promise<void>
}
