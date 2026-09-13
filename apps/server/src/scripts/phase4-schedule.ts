import { parseEnvironment } from '@rallyo/core'
import { and, eq, gt, lte } from 'drizzle-orm'

import { ScheduledQuizService } from '../core/scheduled-quiz-service'
import { createDatabase } from '../db/client'
import * as schema from '../db/schema'
import { findCommunityByTelegramChatId } from '../telegram/persistence'

const environment = parseEnvironment(process.env)
const chatId = parseBigIntArgument('--chat-id')
const questionIds = parseQuestionIds()
const startsAt = parseDateArgument('--at', new Date())
const perQuestionSeconds = parsePositiveIntegerArgument('--seconds', 30)
const name = parseOptionalArgument('--name') ?? 'Rallyo scheduled quiz'

if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required.')

const databaseResources = createDatabase(environment.DATABASE_URL)

try {
  const community = await findCommunityByTelegramChatId(databaseResources.db, chatId)
  if (!community) throw new Error('Community not found. Run /start in the group first.')

  const now = new Date()
  const [season] = await databaseResources.db
    .select()
    .from(schema.seasons)
    .where(
      and(
        eq(schema.seasons.communityId, community.id),
        eq(schema.seasons.status, 'ACTIVE'),
        lte(schema.seasons.startsAt, startsAt),
        gt(schema.seasons.endsAt, startsAt),
      ),
    )
    .orderBy(schema.seasons.startsAt)
    .limit(1)

  if (!season) throw new Error('An active season covering the scheduled start time is required.')

  const created = await new ScheduledQuizService(databaseResources.db).create({
    communityId: community.id,
    seasonId: season.id,
    name,
    sourcePolicy: 'MANUAL',
    startsAt,
    perQuestionSeconds,
    questionIds,
  })

  console.log(
    JSON.stringify(
      {
        quizId: created.quiz.id,
        scheduleId: created.schedule.id,
        communityId: community.id,
        telegramChatId: community.telegramChatId.toString(),
        questionIds,
        startsAt: startsAt.toISOString(),
        createdAt: now.toISOString(),
      },
      null,
      2,
    ),
  )
} finally {
  await databaseResources.close()
}

function parseQuestionIds(): string[] {
  const value = parseOptionalArgument('--question-ids')
  if (!value)
    throw new Error('--question-ids is required (comma-separated approved question UUIDs).')
  const ids = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (ids.length === 0) throw new Error('--question-ids must contain at least one UUID.')
  return ids
}

function parseDateArgument(name: string, defaultValue: Date): Date {
  const value = parseOptionalArgument(name)
  if (!value) return defaultValue
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be an ISO-8601 timestamp.`)
  return parsed
}

function parseBigIntArgument(name: string): bigint {
  try {
    return BigInt(parseRequiredArgument(name))
  } catch {
    throw new Error(`${name} must be a valid Telegram chat id.`)
  }
}

function parsePositiveIntegerArgument(name: string, defaultValue: number): number {
  const value = parseOptionalArgument(name)
  if (!value) return defaultValue
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 86_400) {
    throw new Error(`${name} must be an integer between 1 and 86400.`)
  }
  return parsed
}

function parseRequiredArgument(name: string): string {
  const value = parseOptionalArgument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function parseOptionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}
