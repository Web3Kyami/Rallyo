import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import { parseScrambleConfig } from '../games/scramble/config'

export const GAME_KEYS = ['project_quiz', 'word_seek', 'scramble'] as const
export type GameKey = (typeof GAME_KEYS)[number]

export const OPTIONAL_CAPABILITY_KEYS = ['social_tasks', 'message_activity'] as const
export type OptionalCapabilityKey = (typeof OPTIONAL_CAPABILITY_KEYS)[number]

const capabilityConfigSchema = z.record(z.string(), z.unknown())

export const projectQuizPresentationSchema = z.enum(['typed', 'multiple_choice'])
export const projectQuizContentSourceSchema = z.enum([
  'ANY_APPROVED',
  'PROJECT_BRAIN',
  'CURATED_DEFAULT',
  'MANUAL',
])

export const projectQuizConfigSchema = z
  .object({
    presentation: projectQuizPresentationSchema.default('typed'),
    hintsEnabled: z.boolean().default(false),
    hintTimingSeconds: z.array(z.number().int().min(1).max(3_600)).max(2).default([20, 40]),
    startingPoints: z.number().int().min(1).max(1_000).default(20),
    pointReductions: z.array(z.number().int().min(0).max(1_000)).max(3).default([0, 5, 10]),
    answerTimeoutSeconds: z.number().int().min(1).max(3_600).default(60),
    contentSource: projectQuizContentSourceSchema.default('ANY_APPROVED'),
    automaticRounds: z.boolean().default(true),
  })
  .superRefine((config, context) => {
    if (
      config.hintTimingSeconds.some(
        (timing, index) => index > 0 && timing <= config.hintTimingSeconds[index - 1]!,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hintTimingSeconds'],
        message: 'Hint timings must be in strictly increasing order.',
      })
    }

    if (
      config.hintsEnabled &&
      config.pointReductions.some((reduction) => reduction >= config.startingPoints)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pointReductions'],
        message: 'Point reductions must leave at least one point available.',
      })
    }
  })

export type ProjectQuizConfig = z.infer<typeof projectQuizConfigSchema>

export const DEFAULT_PROJECT_QUIZ_CONFIG: ProjectQuizConfig = projectQuizConfigSchema.parse({})

export function parseProjectQuizConfig(input: unknown): ProjectQuizConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CommunityGameConfigError('Project Quiz configuration must be an object.')
  }

  const value = input as Record<string, unknown>
  const presentation = value.presentation ?? value.answerPresentation
  const hints = value.hints
  const hintTimingSeconds =
    value.hintTimingSeconds ??
    value.hintTimingsSeconds ??
    (typeof hints === 'object' && hints !== null && !Array.isArray(hints)
      ? (hints as Record<string, unknown>).timingSeconds
      : typeof hints === 'number'
        ? [hints]
        : undefined)
  const contentSource = value.contentSource ?? value.sourcePolicy
  const normalizedContentSource =
    contentSource === 'APPROVED' || contentSource === 'ANY'
      ? 'ANY_APPROVED'
      : contentSource === 'PROJECT'
        ? 'PROJECT_BRAIN'
        : contentSource === 'DEFAULT' || contentSource === 'CURATED'
          ? 'CURATED_DEFAULT'
          : contentSource

  const parsed = projectQuizConfigSchema.safeParse({
    ...value,
    ...(typeof hints === 'object' && hints !== null && !Array.isArray(hints)
      ? { hintsEnabled: (hints as Record<string, unknown>).enabled }
      : typeof hints === 'boolean'
        ? { hintsEnabled: hints }
        : {}),
    ...(value.startingPoints === undefined && value.points !== undefined
      ? { startingPoints: value.points }
      : {}),
    ...(value.answerTimeoutSeconds === undefined && value.timeoutSeconds !== undefined
      ? { answerTimeoutSeconds: value.timeoutSeconds }
      : {}),
    ...(value.automaticRounds === undefined && value.automatic !== undefined
      ? { automaticRounds: value.automatic }
      : {}),
    ...(presentation === 'MULTIPLE_CHOICE' || presentation === 'multiple-choice'
      ? { presentation: 'multiple_choice' }
      : presentation === 'TYPED'
        ? { presentation: 'typed' }
        : presentation === undefined
          ? {}
          : { presentation }),
    ...(hintTimingSeconds === undefined ? {} : { hintTimingSeconds }),
    ...(normalizedContentSource === undefined ? {} : { contentSource: normalizedContentSource }),
  })

  if (!parsed.success) {
    throw new CommunityGameConfigError(parsed.error.issues.map((issue) => issue.message).join(' '))
  }

  return parsed.data
}

export class CommunityGameConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommunityGameConfigError'
  }
}

export class CommunityGameConfigService {
  constructor(private readonly database: RallyoDatabase) {}

  async get(communityId: string, gameKey: string) {
    const rows = await this.database
      .select()
      .from(schema.communityGameConfigs)
      .where(
        and(
          eq(schema.communityGameConfigs.communityId, communityId),
          eq(schema.communityGameConfigs.gameKey, gameKey),
        ),
      )
      .limit(1)

    return rows[0] ?? null
  }

  async getProjectQuizConfig(communityId: string) {
    const row = await this.get(communityId, 'project_quiz')
    return {
      row,
      configured: row !== null,
      config: parseProjectQuizConfig(row?.config ?? {}),
    }
  }

  async getScrambleConfig(communityId: string) {
    const row = await this.get(communityId, 'scramble')
    return {
      row,
      configured: row !== null,
      config: parseScrambleConfig(row?.config ?? {}),
    }
  }

  async isEnabled(communityId: string, gameKey: string): Promise<boolean> {
    const config = await this.get(communityId, gameKey)

    if (!config) {
      return gameKey === 'project_quiz'
    }

    return config.enabled
  }

  async requireEnabled(communityId: string, gameKey: string): Promise<void> {
    if (!(await this.isEnabled(communityId, gameKey))) {
      throw new CommunityGameConfigError(`Game capability '${gameKey}' is disabled.`)
    }
  }

  async set(input: {
    readonly communityId: string
    readonly gameKey: string
    readonly enabled: boolean
    readonly config?: schema.CapabilityConfig
  }) {
    const config =
      input.gameKey === 'project_quiz'
        ? parseProjectQuizConfig(input.config ?? {})
        : input.gameKey === 'scramble'
          ? parseScrambleConfig(input.config ?? {})
          : capabilityConfigSchema.parse(input.config ?? {})
    const [row] = await this.database
      .insert(schema.communityGameConfigs)
      .values({
        communityId: input.communityId,
        gameKey: input.gameKey,
        enabled: input.enabled,
        config,
      })
      .onConflictDoUpdate({
        target: [schema.communityGameConfigs.communityId, schema.communityGameConfigs.gameKey],
        set: {
          enabled: input.enabled,
          config,
          updatedAt: new Date(),
        },
      })
      .returning()

    if (!row) throw new CommunityGameConfigError('Community game configuration was not saved.')
    return row
  }
}
