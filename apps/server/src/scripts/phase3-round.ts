import { parseEnvironment } from '@rallyo/core'
import { and, eq, gt, lte } from 'drizzle-orm'

import { createDatabase } from '../db/client'
import * as schema from '../db/schema'
import { createTelegramRuntime } from '../telegram/runtime'
import { findCommunityByTelegramChatId } from '../telegram/persistence'

type Mode = (typeof schema.questionMode.enumValues)[number]

const environment = parseEnvironment(process.env)
const chatId = parseBigIntArgument('--chat-id')
const mode = parseModeArgument()
const seconds = parsePositiveIntegerArgument('--seconds', 60)
const questionId = parseOptionalArgument('--question-id')

if (!environment.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}

if (!environment.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required.')
}

const databaseResources = createDatabase(environment.DATABASE_URL)

try {
  const community = await findCommunityByTelegramChatId(databaseResources.db, chatId)

  if (!community) {
    throw new Error(
      'Community not found. Add the bot to the group and send /start there before running this command.',
    )
  }

  const now = new Date()
  const season = await ensureActiveTestSeason(databaseResources.db, community.id, now)
  const question = await selectOrCreateTestQuestion(
    databaseResources.db,
    community.id,
    mode,
    questionId,
  )

  const runtime = createTelegramRuntime({
    database: databaseResources.db,
    token: environment.TELEGRAM_BOT_TOKEN,
  })
  const round = await runtime.roundService.startLiveRound({
    communityId: community.id,
    seasonId: season.id,
    questionId: question.id,
    startsAt: now,
    locksAt: new Date(now.getTime() + seconds * 1000),
    now,
  })
  const sent = await runtime.presentRound({
    communityId: community.id,
    telegramChatId: community.telegramChatId,
    roundId: round.id,
    at: now,
  })

  console.log(
    JSON.stringify(
      {
        mode,
        communityId: community.id,
        telegramChatId: community.telegramChatId.toString(),
        seasonId: season.id,
        questionId: question.id,
        roundId: round.id,
        telegramMessageId: sent.message_id,
        startsAt: now.toISOString(),
        locksAt: round.locksAt.toISOString(),
      },
      null,
      2,
    ),
  )
} finally {
  await databaseResources.close()
}

async function ensureActiveTestSeason(
  database: ReturnType<typeof createDatabase>['db'],
  communityId: string,
  now: Date,
) {
  const [activeSeason] = await database
    .select()
    .from(schema.seasons)
    .where(
      and(
        eq(schema.seasons.communityId, communityId),
        eq(schema.seasons.status, 'ACTIVE'),
        lte(schema.seasons.startsAt, now),
        gt(schema.seasons.endsAt, now),
      ),
    )
    .orderBy(schema.seasons.startsAt)
    .limit(1)

  if (activeSeason) return activeSeason

  const [created] = await database
    .insert(schema.seasons)
    .values({
      communityId,
      name: 'Phase 3 test season',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      status: 'ACTIVE',
    })
    .returning()

  if (!created) {
    throw new Error('Active test season could not be created.')
  }

  return created
}

async function selectOrCreateTestQuestion(
  database: ReturnType<typeof createDatabase>['db'],
  communityId: string,
  mode: Mode,
  requestedQuestionId: string | undefined,
) {
  if (requestedQuestionId) {
    const [requested] = await database
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.id, requestedQuestionId),
          eq(schema.questions.mode, mode),
          eq(schema.questions.status, 'APPROVED'),
        ),
      )
    if (!requested) throw new Error('Requested question is not an approved question for this mode.')
    return requested
  }

  const [existing] = await database
    .select()
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.fingerprint, `phase3-test:${mode.toLowerCase()}`),
        eq(schema.questions.status, 'APPROVED'),
      ),
    )
    .limit(1)
  if (existing) return existing

  const question = testQuestion(mode, communityId)
  const [created] = await database.insert(schema.questions).values(question).returning()
  if (!created) throw new Error('Test question could not be created.')
  return created
}

function testQuestion(mode: Mode, communityId: string) {
  const shared = {
    scope: 'COMMUNITY' as const,
    communityId,
    source: 'MANUAL' as const,
    mode,
    category: 'Phase 3 test',
    difficulty: 'easy',
    status: 'APPROVED' as const,
    basePoints: mode === 'FIRST_CORRECT' ? 15 : mode === 'CLUE' ? 30 : 20,
    fingerprint: `phase3-test:${mode.toLowerCase()}`,
    acceptedAnswers: ['sign a message', 'signMessage'],
    correctAnswer: 'sign a message',
  }

  if (mode === 'QUICK') {
    return {
      ...shared,
      prompt: 'Which phrase proves control of a wallet without moving NIM?',
      options: [
        { label: 'Send NIM', value: 'send NIM' },
        { label: 'Sign a message', value: 'sign a message' },
        { label: 'Stake NIM', value: 'stake NIM' },
        { label: 'Create account', value: 'create account' },
      ],
    }
  }

  if (mode === 'FIRST_CORRECT') {
    return {
      ...shared,
      prompt: 'I prove control of a wallet without moving NIM. What am I?',
    }
  }

  return {
    ...shared,
    prompt: 'Guess the proof method.',
    clueData: {
      clues: [
        'I let you prove something without spending anything.',
        'The wallet asks you to approve text rather than a transfer.',
        'The proof is not a transaction.',
      ],
    },
  }
}

function parseModeArgument(): Mode {
  const value = parseRequiredArgument('--mode').toUpperCase()
  if (!schema.questionMode.enumValues.includes(value as Mode)) {
    throw new Error('--mode must be QUICK, FIRST_CORRECT, or CLUE.')
  }
  return value as Mode
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
