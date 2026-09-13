import type { GameModule, GameStartCheck } from './game-contract'
import {
  CommunityGameConfigError,
  type CommunityGameConfigService,
  parseProjectQuizConfig,
} from './community-game-config-service'

export class GameRegistry {
  private readonly modules = new Map<string, GameModule>()

  constructor(private readonly configurations: CommunityGameConfigService) {}

  register(module: GameModule): this {
    if (this.modules.has(module.key)) {
      throw new Error(`Game module '${module.key}' is already registered.`)
    }

    this.modules.set(module.key, module)
    return this
  }

  async canStart(input: GameStartCheck & { readonly gameKey: string }): Promise<void> {
    const module = this.modules.get(input.gameKey)
    if (!module)
      throw new CommunityGameConfigError(`Game module '${input.gameKey}' is not registered.`)

    const configuration = await this.configurations.get(input.communityId, input.gameKey)
    if (!(configuration?.enabled ?? input.gameKey === 'project_quiz')) {
      throw new CommunityGameConfigError(`Game capability '${input.gameKey}' is disabled.`)
    }

    const config =
      input.gameKey === 'project_quiz'
        ? parseProjectQuizConfig(configuration?.config ?? input.config)
        : (configuration?.config ?? input.config)

    await module.validateStart({
      communityId: input.communityId,
      now: input.now,
      config,
    })
  }
}

export function projectQuizCompatibilityModule(): GameModule {
  return {
    key: 'project_quiz',
    validateStart(input) {
      // RoundService remains the compatibility implementation during 7.5A.
      parseProjectQuizConfig(input.config)
      return Promise.resolve()
    },
  }
}

export function scrambleGameModule(): GameModule {
  return {
    key: 'scramble',
    async validateStart() {
      // Scramble validates its approved source and active season in ScrambleService.
    },
  }
}

export function wordSeekGameModule(): GameModule {
  return {
    key: 'word_seek',
    async validateStart() {
      // Word Seek validates its word source and season in WordSeekService.
    },
  }
}
