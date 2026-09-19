import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const communityStatus = pgEnum('community_status', ['ACTIVE', 'PAUSED', 'ARCHIVED'])
export const questionScope = pgEnum('question_scope', ['GLOBAL', 'COMMUNITY'])
export const questionSource = pgEnum('question_source', ['DEFAULT', 'PROJECT_AI', 'MANUAL'])
export const questionMode = pgEnum('question_mode', ['QUICK', 'FIRST_CORRECT', 'CLUE'])
export const questionPresentationType = pgEnum('question_presentation_type', [
  'TEXT',
  'MCQ',
  'IMAGE_IDENTIFY',
  'IMAGE_CLUE',
  'MATH',
  'PROGRESSIVE_CLUE',
])
export const questionStatus = pgEnum('question_status', ['DRAFT', 'APPROVED', 'ARCHIVED'])
export const seasonStatus = pgEnum('season_status', ['DRAFT', 'ACTIVE', 'CLOSED'])
export const quizStatus = pgEnum('quiz_status', [
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'COMPLETE',
  'CANCELLED',
])
export const roundStatus = pgEnum('round_status', [
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'LOCKED',
  'SCORED',
  'CLOSED',
  'VOID',
])
export const rewardStatus = pgEnum('reward_status', [
  'ELIGIBLE',
  'CLAIMING',
  'SENT',
  'CONFIRMED',
  'FAILED',
])
export const knowledgeSourceType = pgEnum('knowledge_source_type', [
  'PASTED_TEXT',
  'MARKDOWN',
  'FAQ',
])
export const knowledgeSourceStatus = pgEnum('knowledge_source_status', ['ACTIVE', 'ARCHIVED'])
export const scoreSourceType = pgEnum('score_source_type', [
  'QUIZ',
  'WORD_SEEK',
  'SCRAMBLE',
  'SOCIAL_TASK',
  'MANUAL',
])
export const rallyoXpEventType = pgEnum('rallyo_xp_event_type', ['DAILY_CHECKIN'])
export const scrambleSource = pgEnum('scramble_source', ['GENERAL', 'PROJECT_BRAIN'])
export const scrambleRoundStatus = pgEnum('scramble_round_status', [
  'LIVE',
  'WON',
  'TIMED_OUT',
  'STOPPED',
])
export const socialTaskStatus = pgEnum('social_task_status', ['ACTIVE', 'PAUSED', 'ARCHIVED'])
export const socialTaskType = pgEnum('social_task_type', ['RECURRING', 'CAMPAIGN'])
export const socialTaskPlatform = pgEnum('social_task_platform', [
  'X',
  'INSTAGRAM',
  'TIKTOK',
  'OTHER',
])
export const socialTaskAction = pgEnum('social_task_action', [
  'POST',
  'COMMENT_REPLY',
  'SHARE_REPOST',
  'OTHER',
])
export const socialProofType = pgEnum('social_proof_type', ['URL', 'SCREENSHOT', 'URL_SCREENSHOT'])
export const socialTaskSubmissionStatus = pgEnum('social_task_submission_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
])
export const wordSeekSessionStatus = pgEnum('word_seek_session_status', [
  'LIVE',
  'WON',
  'TIMED_OUT',
  'ENDED',
])
export const wordSeekSourceType = pgEnum('word_seek_source_type', ['GENERAL', 'PROJECT'])
export const wordSeekWordStatus = pgEnum('word_seek_word_status', ['DRAFT', 'APPROVED', 'ARCHIVED'])

export type QuestionOption = {
  readonly label: string
  readonly value: string
}

export type ClueData = {
  readonly clues: readonly string[]
}

export type CapabilityConfig = Record<string, unknown>

export const players = pgTable('players', {
  id: uuid('id').defaultRandom().primaryKey(),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rallyoXpEvents = pgTable(
  'rallyo_xp_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    amountXp: integer('amount_xp').notNull(),
    eventType: rallyoXpEventType('event_type').notNull(),
    reason: text('reason').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull(),
    claimDate: date('claim_date'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('rallyo_xp_events_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('rallyo_xp_events_player_type_day_unique').on(
      table.playerId,
      table.eventType,
      table.claimDate,
    ),
    index('rallyo_xp_events_player_idx').on(table.playerId, table.occurredAt),
    check('rallyo_xp_events_amount_positive', sql`${table.amountXp} > 0`),
    check(
      'rallyo_xp_events_daily_claim_date_required',
      sql`${table.eventType} <> 'DAILY_CHECKIN' OR ${table.claimDate} IS NOT NULL`,
    ),
  ],
)

export const telegramIdentities = pgTable(
  'telegram_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    username: text('username'),
    displayName: text('display_name').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('telegram_identities_telegram_user_id_unique').on(table.telegramUserId)],
)

export const walletIdentities = pgTable(
  'wallet_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    publicKey: text('public_key').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('wallet_identities_address_unique').on(table.address)],
)

export const walletLinkCodes = pgTable(
  'wallet_link_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramIdentityId: uuid('telegram_identity_id')
      .notNull()
      .references(() => telegramIdentities.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('wallet_link_codes_code_hash_unique').on(table.codeHash)],
)

export const walletChallenges = pgTable(
  'wallet_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    walletLinkCodeId: uuid('wallet_link_code_id')
      .notNull()
      .references(() => walletLinkCodes.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    messageHash: text('message_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('wallet_challenges_nonce_hash_unique').on(table.nonceHash),
    index('wallet_challenges_player_expiry_idx').on(table.playerId, table.expiresAt),
  ],
)

export const communities = pgTable(
  'communities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramChatId: bigint('telegram_chat_id', { mode: 'bigint' }).notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: communityStatus('status').notNull().default('ACTIVE'),
    timezone: text('timezone').notNull().default('UTC'),
    automaticRoundsEnabled: boolean('automatic_rounds_enabled').notNull().default(true),
    quietHours: jsonb('quiet_hours').$type<{ readonly start: string; readonly end: string }>(),
    questionCooldownDays: integer('question_cooldown_days').notNull().default(30),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('communities_telegram_chat_id_unique').on(table.telegramChatId),
    uniqueIndex('communities_slug_unique').on(table.slug),
    check('communities_question_cooldown_nonnegative', sql`${table.questionCooldownDays} >= 0`),
  ],
)

export const communityAdmins = pgTable(
  'community_admins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('community_admins_community_telegram_user_unique').on(
      table.communityId,
      table.telegramUserId,
    ),
  ],
)

export const appSessionCodes = pgTable(
  'app_session_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    telegramIdentityId: uuid('telegram_identity_id')
      .notNull()
      .references(() => telegramIdentities.id, { onDelete: 'cascade' }),
    targetCommunityId: uuid('target_community_id').references(() => communities.id, {
      onDelete: 'set null',
    }),
    targetMode: text('target_mode').notNull().default('player'),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('app_session_codes_code_hash_unique').on(table.codeHash),
    index('app_session_codes_expiry_idx').on(table.expiresAt),
  ],
)

export const telegramPairingCodes = pgTable(
  'telegram_pairing_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramIdentityId: uuid('telegram_identity_id')
      .notNull()
      .references(() => telegramIdentities.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('telegram_pairing_codes_code_hash_unique').on(table.codeHash),
    index('telegram_pairing_codes_expiry_idx').on(table.expiresAt),
  ],
)

export const appWalletChallenges = pgTable(
  'app_wallet_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    address: text('address').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    messageHash: text('message_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('app_wallet_challenges_nonce_hash_unique').on(table.nonceHash),
    index('app_wallet_challenges_address_expiry_idx').on(table.address, table.expiresAt),
  ],
)

export const appSessions = pgTable(
  'app_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    telegramIdentityId: uuid('telegram_identity_id').references(() => telegramIdentities.id, {
      onDelete: 'cascade',
    }),
    targetCommunityId: uuid('target_community_id').references(() => communities.id, {
      onDelete: 'set null',
    }),
    targetMode: text('target_mode').notNull().default('player'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('app_sessions_token_hash_unique').on(table.tokenHash),
    index('app_sessions_player_idx').on(table.playerId, table.expiresAt),
  ],
)

export const operatorSessions = pgTable(
  'operator_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('operator_sessions_token_hash_unique').on(table.tokenHash),
    index('operator_sessions_expiry_idx').on(table.expiresAt),
  ],
)

export const operatorAuditEvents = pgTable(
  'operator_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operatorSessionId: uuid('operator_session_id').references(() => operatorSessions.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetPlayerId: uuid('target_player_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    targetTelegramIdentityId: uuid('target_telegram_identity_id').references(
      () => telegramIdentities.id,
      { onDelete: 'set null' },
    ),
    targetWalletIdentityId: uuid('target_wallet_identity_id').references(
      () => walletIdentities.id,
      {
        onDelete: 'set null',
      },
    ),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index('operator_audit_events_created_idx').on(table.createdAt),
    index('operator_audit_events_player_idx').on(table.targetPlayerId, table.createdAt),
  ],
)

export const communityGameConfigs = pgTable(
  'community_game_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    gameKey: text('game_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<CapabilityConfig>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('community_game_configs_community_game_unique').on(
      table.communityId,
      table.gameKey,
    ),
    index('community_game_configs_community_enabled_idx').on(table.communityId, table.enabled),
  ],
)

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    type: knowledgeSourceType('type').notNull(),
    title: text('title').notNull(),
    rawText: text('raw_text').notNull(),
    checksum: text('checksum').notNull(),
    status: knowledgeSourceStatus('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('knowledge_sources_community_checksum_unique').on(
      table.communityId,
      table.checksum,
    ),
  ],
)

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: questionScope('scope').notNull(),
    communityId: uuid('community_id').references(() => communities.id, { onDelete: 'cascade' }),
    source: questionSource('source').notNull(),
    mode: questionMode('mode').notNull(),
    presentationType: questionPresentationType('presentation_type').notNull().default('TEXT'),
    category: text('category').notNull(),
    difficulty: text('difficulty').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<readonly QuestionOption[]>(),
    correctAnswer: text('correct_answer').notNull(),
    acceptedAnswers: jsonb('accepted_answers').$type<readonly string[]>().notNull(),
    clueData: jsonb('clue_data').$type<ClueData>(),
    hints: jsonb('hints').$type<readonly string[]>(),
    mediaType: text('media_type'),
    mediaFileId: text('media_file_id'),
    mediaAssetRef: text('media_asset_ref'),
    mediaSource: text('media_source'),
    mediaCredit: text('media_credit'),
    mediaAlt: text('media_alt'),
    mediaSpoiler: boolean('media_spoiler').notNull().default(false),
    explanation: text('explanation'),
    sourceRefs: jsonb('source_refs').$type<readonly string[]>(),
    basePoints: integer('base_points').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: questionStatus('status').notNull().default('DRAFT'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('questions_fingerprint_unique').on(table.fingerprint),
    index('questions_scheduler_selection_idx').on(
      table.status,
      table.scope,
      table.communityId,
      table.mode,
    ),
    check('questions_base_points_positive', sql`${table.basePoints} > 0`),
    check(
      'questions_difficulty_valid',
      sql`${table.difficulty} IN ('AUTO', 'EASY', 'MEDIUM', 'HARD', 'easy', 'medium', 'hard')`,
    ),
    check(
      'questions_scope_community_consistency',
      sql`(${table.scope} = 'GLOBAL' AND ${table.communityId} IS NULL) OR (${table.scope} = 'COMMUNITY' AND ${table.communityId} IS NOT NULL)`,
    ),
  ],
)

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: seasonStatus('status').notNull().default('DRAFT'),
    winnerCount: integer('winner_count').notNull().default(3),
    rewardPoolLuna: bigint('reward_pool_luna', { mode: 'bigint' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('seasons_community_status_idx').on(table.communityId, table.status),
    check('seasons_end_after_start', sql`${table.endsAt} > ${table.startsAt}`),
    check('seasons_winner_count_positive', sql`${table.winnerCount} > 0`),
  ],
)

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    sourcePolicy: text('source_policy').notNull(),
    questionCount: integer('question_count').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    perQuestionSeconds: integer('per_question_seconds').notNull(),
    status: quizStatus('status').notNull().default('DRAFT'),
    createdAt: createdAt(),
  },
  (table) => [
    check('quizzes_question_count_positive', sql`${table.questionCount} > 0`),
    check('quizzes_question_seconds_positive', sql`${table.perQuestionSeconds} > 0`),
  ],
)

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    pointsOverride: integer('points_override'),
  },
  (table) => [
    uniqueIndex('quiz_questions_quiz_sequence_unique').on(table.quizId, table.sequence),
    uniqueIndex('quiz_questions_quiz_question_unique').on(table.quizId, table.questionId),
    check('quiz_questions_sequence_positive', sql`${table.sequence} > 0`),
    check(
      'quiz_questions_points_override_positive',
      sql`${table.pointsOverride} IS NULL OR ${table.pointsOverride} > 0`,
    ),
  ],
)

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'set null' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    state: roundStatus('state').notNull().default('DRAFT'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    locksAt: timestamp('locks_at', { withTimezone: true }).notNull(),
    clueNumberPresented: integer('clue_number_presented').notNull().default(1),
    presentation: text('presentation'),
    projectQuizConfig: jsonb('project_quiz_config').$type<CapabilityConfig>(),
    difficulty: text('difficulty').notNull().default('MEDIUM'),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    telegramMessageId: bigint('telegram_message_id', { mode: 'bigint' }),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('rounds_community_state_idx').on(table.communityId, table.state),
    index('rounds_live_lookup_idx').on(table.state, table.locksAt),
    check('rounds_lock_after_start', sql`${table.locksAt} > ${table.startsAt}`),
    check(
      'rounds_clue_number_presented_valid',
      sql`${table.clueNumberPresented} >= 1 AND ${table.clueNumberPresented} <= 3`,
    ),
    check(
      'rounds_project_quiz_presentation_valid',
      sql`${table.presentation} IS NULL OR ${table.presentation} IN ('typed', 'multiple_choice')`,
    ),
    check('rounds_version_nonnegative', sql`${table.version} >= 0`),
    check('rounds_difficulty_valid', sql`${table.difficulty} IN ('EASY', 'MEDIUM', 'HARD')`),
  ],
)

export const questionUsages = pgTable(
  'question_usages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('question_usages_question_round_unique').on(table.questionId, table.roundId),
    index('question_usages_cooldown_idx').on(table.communityId, table.questionId, table.usedAt),
  ],
)

export const answers = pgTable(
  'answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    telegramInputId: text('telegram_input_id').notNull(),
    rawAnswer: text('raw_answer'),
    normalizedAnswer: text('normalized_answer').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (table) => [
    uniqueIndex('answers_round_player_unique').on(table.roundId, table.playerId),
    uniqueIndex('answers_telegram_input_unique').on(table.telegramInputId),
  ],
)

export type ScrambleHintProgress = {
  readonly hintTimingSeconds: readonly number[]
  readonly pointReductions: readonly number[]
}

export const scrambleRounds = pgTable(
  'scramble_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    source: scrambleSource('source').notNull(),
    sourceTermId: text('source_term_id'),
    term: text('term').notNull(),
    normalizedAnswer: text('normalized_answer').notNull(),
    scrambledTerm: text('scrambled_term').notNull(),
    category: text('category').notNull(),
    difficulty: text('difficulty').notNull().default('MEDIUM'),
    status: scrambleRoundStatus('status').notNull().default('LIVE'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    locksAt: timestamp('locks_at', { withTimezone: true }).notNull(),
    points: integer('points').notNull(),
    pointsRemaining: integer('points_remaining').notNull(),
    hintsEnabled: boolean('hints_enabled').notNull().default(true),
    maxHints: integer('max_hints').notNull().default(2),
    hintCount: integer('hint_count').notNull().default(0),
    hintTimingSeconds: jsonb('hint_timing_seconds').$type<readonly number[]>().notNull(),
    pointReductions: jsonb('point_reductions').$type<readonly number[]>().notNull(),
    revealedPositions: jsonb('revealed_positions').$type<readonly number[]>().notNull().default([]),
    winnerPlayerId: uuid('winner_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    telegramMessageId: bigint('telegram_message_id', { mode: 'bigint' }),
    outcomeNotifiedAt: timestamp('outcome_notified_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('scramble_rounds_community_status_idx').on(table.communityId, table.status),
    index('scramble_rounds_due_idx').on(table.status, table.locksAt),
    index('scramble_rounds_community_created_idx').on(table.communityId, table.createdAt),
    uniqueIndex('scramble_rounds_one_live_per_community_unique')
      .on(table.communityId)
      .where(sql`${table.status} = 'LIVE'`),
    check('scramble_rounds_points_positive', sql`${table.points} > 0`),
    check('scramble_rounds_points_remaining_positive', sql`${table.pointsRemaining} > 0`),
    check('scramble_rounds_max_hints_nonnegative', sql`${table.maxHints} >= 0`),
    check('scramble_rounds_hint_count_nonnegative', sql`${table.hintCount} >= 0`),
    check('scramble_rounds_hint_count_bounded', sql`${table.hintCount} <= ${table.maxHints}`),
    check('scramble_rounds_lock_after_start', sql`${table.locksAt} > ${table.startsAt}`),
    check(
      'scramble_rounds_difficulty_valid',
      sql`${table.difficulty} IN ('EASY', 'MEDIUM', 'HARD')`,
    ),
  ],
)

export const scrambleGuesses = pgTable(
  'scramble_guesses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => scrambleRounds.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    telegramInputId: text('telegram_input_id').notNull(),
    rawAnswer: text('raw_answer').notNull(),
    normalizedAnswer: text('normalized_answer').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (table) => [
    uniqueIndex('scramble_guesses_telegram_input_unique').on(table.telegramInputId),
    uniqueIndex('scramble_guesses_round_player_answer_unique').on(
      table.roundId,
      table.playerId,
      table.normalizedAnswer,
    ),
  ],
)

export const socialTasks = pgTable(
  'social_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    points: integer('points').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    taskType: socialTaskType('task_type').notNull().default('RECURRING'),
    platform: socialTaskPlatform('platform').notNull().default('OTHER'),
    action: socialTaskAction('action').notNull().default('OTHER'),
    targetUrl: text('target_url'),
    announcementMediaFileId: text('announcement_media_file_id'),
    proofType: socialProofType('proof_type').notNull().default('URL'),
    requiresHandle: boolean('requires_handle').notNull().default(false),
    maxSubmissionsPerPlayer: integer('max_submissions_per_player'),
    maxApprovedSubmissionsPerPlayerPerDay: integer('max_approved_submissions_per_player_per_day'),
    completionCapPerPlayer: integer('completion_cap_per_player'),
    cooldownDays: integer('cooldown_days').notNull().default(0),
    status: socialTaskStatus('status').notNull().default('ACTIVE'),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('social_tasks_community_status_window_idx').on(
      table.communityId,
      table.status,
      table.startsAt,
      table.endsAt,
    ),
    check('social_tasks_points_positive', sql`${table.points} > 0`),
    check('social_tasks_end_after_start', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'social_tasks_submission_cap_positive',
      sql`${table.maxSubmissionsPerPlayer} IS NULL OR ${table.maxSubmissionsPerPlayer} > 0`,
    ),
    check(
      'social_tasks_daily_approved_cap_positive',
      sql`${table.maxApprovedSubmissionsPerPlayerPerDay} IS NULL OR ${table.maxApprovedSubmissionsPerPlayerPerDay} > 0`,
    ),
    check(
      'social_tasks_completion_cap_positive',
      sql`${table.completionCapPerPlayer} IS NULL OR ${table.completionCapPerPlayer} > 0`,
    ),
    check('social_tasks_cooldown_nonnegative', sql`${table.cooldownDays} >= 0`),
  ],
)

export const socialTaskSubmissions = pgTable(
  'social_task_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => socialTasks.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    url: text('url'),
    proofType: socialProofType('proof_type').notNull().default('URL'),
    screenshotFileId: text('screenshot_file_id'),
    screenshotFileUniqueId: text('screenshot_file_unique_id'),
    screenshotFileName: text('screenshot_file_name'),
    screenshotMimeType: text('screenshot_mime_type'),
    screenshotFileSize: integer('screenshot_file_size'),
    screenshotWidth: integer('screenshot_width'),
    screenshotHeight: integer('screenshot_height'),
    claimedHandle: text('claimed_handle'),
    status: socialTaskSubmissionStatus('status').notNull().default('PENDING'),
    reviewedByTelegramUserId: bigint('reviewed_by_telegram_user_id', { mode: 'bigint' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('social_task_submissions_task_player_reference_unique').on(
      table.taskId,
      table.playerId,
      table.reference,
    ),
    index('social_task_submissions_task_status_idx').on(table.taskId, table.status),
  ],
)

export const socialTaskSubmissionSessions = pgTable(
  'social_task_submission_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => socialTasks.id, { onDelete: 'cascade' }),
    pendingUrl: text('pending_url'),
    pendingHandle: text('pending_handle'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('social_task_submission_sessions_user_community_unique').on(
      table.telegramUserId,
      table.communityId,
    ),
    index('social_task_submission_sessions_expiry_idx').on(table.expiresAt),
  ],
)

export const scoreEvents = pgTable(
  'score_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    sourceType: scoreSourceType('source_type').notNull().default('QUIZ'),
    sourceId: text('source_id'),
    roundId: uuid('round_id').references(() => rounds.id, { onDelete: 'restrict' }),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'restrict' }),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('score_events_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('score_events_round_player_unique').on(table.roundId, table.playerId),
    uniqueIndex('score_events_source_instance_player_unique').on(
      table.sourceType,
      table.sourceId,
      table.playerId,
    ),
    index('score_events_season_leaderboard_idx').on(table.communityId, table.seasonId, table.delta),
    index('score_events_player_xp_idx').on(table.playerId, table.createdAt),
    check('score_events_delta_positive', sql`${table.delta} > 0`),
  ],
)

export const manualScoreAwards = pgTable(
  'manual_score_awards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(),
    reason: text('reason').notNull(),
    awardedByTelegramUserId: bigint('awarded_by_telegram_user_id', { mode: 'bigint' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    scoreEventId: uuid('score_event_id').references(() => scoreEvents.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('manual_score_awards_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('manual_score_awards_score_event_unique').on(table.scoreEventId),
    check('manual_score_awards_points_positive', sql`${table.points} > 0`),
  ],
)

export const rewardEntitlements = pgTable(
  'reward_entitlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    rank: integer('rank').notNull(),
    amountLuna: bigint('amount_luna', { mode: 'bigint' }).notNull(),
    status: rewardStatus('status').notNull().default('ELIGIBLE'),
    transactionHash: text('transaction_hash'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reward_entitlements_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('reward_entitlements_season_player_unique').on(table.seasonId, table.playerId),
    check('reward_entitlements_rank_positive', sql`${table.rank} > 0`),
    check('reward_entitlements_amount_positive', sql`${table.amountLuna} > 0`),
  ],
)

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lockVersion: integer('lock_version').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('schedules_due_idx').on(table.enabled, table.nextRunAt),
    check('schedules_lock_version_nonnegative', sql`${table.lockVersion} >= 0`),
  ],
)

export const adminWizardSessions = pgTable(
  'admin_wizard_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_wizard_sessions_user_community_unique').on(
      table.telegramUserId,
      table.communityId,
    ),
    index('admin_wizard_sessions_expiry_idx').on(table.expiresAt),
  ],
)

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type').notNull(),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    communityId: uuid('community_id').references(() => communities.id, { onDelete: 'set null' }),
    roundId: uuid('round_id').references(() => rounds.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('analytics_events_type_created_idx').on(table.type, table.createdAt)],
)

export const communityActivityRollups = pgTable(
  'community_activity_rollups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('community_activity_rollups_community_player_bucket_unique').on(
      table.communityId,
      table.playerId,
      table.bucketStart,
    ),
    index('community_activity_rollups_community_bucket_idx').on(
      table.communityId,
      table.bucketStart,
    ),
    check('community_activity_rollups_message_count_nonnegative', sql`${table.messageCount} >= 0`),
    check('community_activity_rollups_reply_count_nonnegative', sql`${table.replyCount} >= 0`),
  ],
)

export const wordSeekWords = pgTable(
  'word_seek_words',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    wordLength: integer('word_length').notNull(),
    clue: text('clue'),
    category: text('category').notNull().default('Vocabulary'),
    difficulty: text('difficulty').notNull().default('AUTO'),
    aliases: jsonb('aliases').$type<readonly string[]>().notNull().default([]),
    sourceRef: text('source_ref'),
    status: wordSeekWordStatus('status').notNull().default('DRAFT'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('word_seek_words_community_word_unique').on(table.communityId, table.word),
    index('word_seek_words_community_status_length_idx').on(
      table.communityId,
      table.status,
      table.wordLength,
    ),
    check(
      'word_seek_words_length_valid',
      sql`${table.wordLength} >= 4 AND ${table.wordLength} <= 6`,
    ),
    check(
      'word_seek_words_difficulty_valid',
      sql`${table.difficulty} IN ('AUTO', 'EASY', 'MEDIUM', 'HARD')`,
    ),
  ],
)

export const wordSeekSessions = pgTable(
  'word_seek_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'restrict' }),
    targetWord: text('target_word').notNull(),
    wordLength: integer('word_length').notNull(),
    difficulty: text('difficulty').notNull().default('MEDIUM'),
    sourceType: wordSeekSourceType('source_type').notNull(),
    sourceId: uuid('source_id').references(() => wordSeekWords.id, { onDelete: 'set null' }),
    clue: text('clue'),
    acceptedAnswers: jsonb('accepted_answers').$type<readonly string[]>().notNull().default([]),
    points: integer('points').notNull(),
    maxGuesses: integer('max_guesses').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: wordSeekSessionStatus('status').notNull().default('LIVE'),
    activeKey: text('active_key'),
    winnerPlayerId: uuid('winner_player_id').references(() => players.id, { onDelete: 'set null' }),
    winnerTelegramInputId: text('winner_telegram_input_id'),
    telegramMessageId: bigint('telegram_message_id', { mode: 'bigint' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('word_seek_sessions_active_key_unique').on(table.activeKey),
    index('word_seek_sessions_community_status_idx').on(table.communityId, table.status),
    index('word_seek_sessions_timeout_idx').on(table.status, table.endsAt),
    check(
      'word_seek_sessions_length_valid',
      sql`${table.wordLength} >= 4 AND ${table.wordLength} <= 6`,
    ),
    check('word_seek_sessions_points_positive', sql`${table.points} > 0`),
    check('word_seek_sessions_max_guesses_positive', sql`${table.maxGuesses} > 0`),
    check('word_seek_sessions_end_after_start', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'word_seek_sessions_difficulty_valid',
      sql`${table.difficulty} IN ('EASY', 'MEDIUM', 'HARD')`,
    ),
  ],
)

export const wordSeekGuesses = pgTable(
  'word_seek_guesses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => wordSeekSessions.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    telegramInputId: text('telegram_input_id').notNull(),
    rawGuess: text('raw_guess').notNull(),
    normalizedGuess: text('normalized_guess').notNull(),
    feedback: text('feedback'),
    isCorrect: boolean('is_correct').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('word_seek_guesses_session_guess_unique').on(
      table.sessionId,
      table.normalizedGuess,
    ),
    uniqueIndex('word_seek_guesses_telegram_input_unique').on(table.telegramInputId),
    index('word_seek_guesses_session_submitted_idx').on(table.sessionId, table.submittedAt),
  ],
)

export const telegramUpdates = pgTable('telegram_updates', {
  telegramUpdateId: bigint('telegram_update_id', { mode: 'bigint' }).primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
})
