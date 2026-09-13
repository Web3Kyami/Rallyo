import { z } from 'zod'

import { CommunityGameConfigError } from '../../core/community-game-config-service'

const sourceSchema = z.enum(['GENERAL', 'PROJECT_BRAIN'])

const scrambleConfigSchema = z
  .object({
    source: sourceSchema.default('GENERAL'),
    points: z.number().int().min(1).max(1_000).default(10),
    timeoutSeconds: z.number().int().min(5).max(3_600).default(60),
    hintsEnabled: z.boolean().default(true),
    maxHints: z.number().int().min(0).max(5).default(2),
    hintTimingSeconds: z.array(z.number().int().min(1).max(3_600)).max(5).default([20, 40]),
    pointReductions: z.array(z.number().int().min(0).max(1_000)).max(5).default([2, 4]),
    minLength: z.number().int().min(2).max(64).default(3),
    maxLength: z.number().int().min(2).max(64).default(15),
    noRepeatRounds: z.number().int().min(0).max(100).default(5),
  })
  .superRefine((config, context) => {
    if (config.minLength > config.maxLength) {
      context.addIssue({
        code: 'custom',
        path: ['minLength'],
        message: 'Minimum term length must not exceed maximum term length.',
      })
    }

    if (
      config.hintTimingSeconds.some(
        (timing, index) =>
          timing >= config.timeoutSeconds ||
          (index > 0 && timing <= config.hintTimingSeconds[index - 1]!),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hintTimingSeconds'],
        message: 'Hint timings must be increasing and before the timeout.',
      })
    }

    if (config.hintTimingSeconds.length > config.maxHints) {
      context.addIssue({
        code: 'custom',
        path: ['hintTimingSeconds'],
        message: 'Hint timings cannot exceed the configured hint count.',
      })
    }

    if (config.pointReductions.length > config.maxHints) {
      context.addIssue({
        code: 'custom',
        path: ['pointReductions'],
        message: 'Point reductions cannot exceed the configured hint count.',
      })
    }

    if (config.pointReductions.some((reduction) => reduction >= config.points)) {
      context.addIssue({
        code: 'custom',
        path: ['pointReductions'],
        message: 'Point reductions must leave at least one point available.',
      })
    }
  })

export type ScrambleConfig = z.infer<typeof scrambleConfigSchema>

export const DEFAULT_SCRAMBLE_CONFIG: ScrambleConfig = scrambleConfigSchema.parse({})

export function parseScrambleConfig(input: unknown): ScrambleConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CommunityGameConfigError('Scramble configuration must be an object.')
  }

  const value = input as Record<string, unknown>
  const rawSource = value.source ?? value.contentSource
  const source =
    typeof rawSource === 'string' ? rawSource.toUpperCase().replaceAll('-', '_') : rawSource
  const maxHints = value.maxHints ?? value.hintCount
  const normalizedSource =
    source === 'PROJECT' || source === 'PROJECT_TERMS'
      ? 'PROJECT_BRAIN'
      : source === 'CURATED' || source === 'DEFAULT'
        ? 'GENERAL'
        : source
  const configuredMaxHints =
    typeof maxHints === 'number' ? maxHints : DEFAULT_SCRAMBLE_CONFIG.maxHints

  try {
    return scrambleConfigSchema.parse({
      ...value,
      ...(normalizedSource === undefined ? {} : { source: normalizedSource }),
      ...(maxHints === undefined ? {} : { maxHints }),
      ...(value.hintTimingSeconds === undefined
        ? {
            hintTimingSeconds: DEFAULT_SCRAMBLE_CONFIG.hintTimingSeconds.slice(
              0,
              configuredMaxHints,
            ),
          }
        : {}),
      ...(value.pointReductions === undefined
        ? { pointReductions: DEFAULT_SCRAMBLE_CONFIG.pointReductions.slice(0, configuredMaxHints) }
        : {}),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CommunityGameConfigError(error.issues.map((issue) => issue.message).join(' '))
    }
    throw error
  }
}
