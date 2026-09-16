import { and, eq, gt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>

export type AdminWizardState =
  | 'SOURCE'
  | 'QUESTION_COUNT'
  | 'QUESTION_SELECT'
  | 'QUESTION_IDS'
  | 'DURATION'
  | 'POINTS'
  | 'CONFIRM'
  | 'MANUAL_QUESTION'
  | 'SEASON_NAME'
  | 'SEASON_DURATION'
  | 'SEASON_END_DATE'
  | 'SEASON_WINNERS'
  | 'SEASON_CONFIRM'
  | 'TASK_TYPE'
  | 'TASK_PLATFORM'
  | 'TASK_ACTION'
  | 'TASK_TITLE'
  | 'TASK_TARGET'
  | 'TASK_INSTRUCTIONS'
  | 'TASK_POINTS'
  | 'TASK_PROOF'
  | 'TASK_CAP'
  | 'TASK_DURATION'
  | 'TASK_CONFIRM'
  | 'WORD_VALUE'
  | 'WORD_CLUE'
  | 'WORD_CONFIRM'
  | 'QUESTION_MODE'
  | 'QUESTION_PROMPT'
  | 'QUESTION_ANSWER'
  | 'QUESTION_OPTIONS'
  | 'QUESTION_CONFIRM'

export async function saveAdminWizardSession(
  database: Database,
  input: {
    readonly telegramUserId: bigint
    readonly communityId: string
    readonly state: AdminWizardState
    readonly data?: Record<string, unknown>
    readonly now: Date
  },
) {
  const expiresAt = new Date(input.now.getTime() + 15 * 60_000)
  const [session] = await database
    .insert(schema.adminWizardSessions)
    .values({
      telegramUserId: input.telegramUserId,
      communityId: input.communityId,
      state: input.state,
      data: input.data ?? {},
      expiresAt,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [schema.adminWizardSessions.telegramUserId, schema.adminWizardSessions.communityId],
      set: {
        state: input.state,
        data: input.data ?? {},
        expiresAt,
        updatedAt: input.now,
      },
    })
    .returning()
  return session ?? null
}

export async function getAdminWizardSession(
  database: Database,
  telegramUserId: bigint,
  communityId: string,
  now: Date,
) {
  const [session] = await database
    .select()
    .from(schema.adminWizardSessions)
    .where(
      and(
        eq(schema.adminWizardSessions.telegramUserId, telegramUserId),
        eq(schema.adminWizardSessions.communityId, communityId),
        gt(schema.adminWizardSessions.expiresAt, now),
      ),
    )
  return session ?? null
}

export async function getActiveAdminWizardSession(
  database: Database,
  telegramUserId: bigint,
  now: Date,
) {
  const [session] = await database
    .select()
    .from(schema.adminWizardSessions)
    .where(
      and(
        eq(schema.adminWizardSessions.telegramUserId, telegramUserId),
        gt(schema.adminWizardSessions.expiresAt, now),
      ),
    )
    .limit(1)
  return session ?? null
}

export async function clearAdminWizardSession(
  database: Database,
  telegramUserId: bigint,
  communityId: string,
) {
  await database
    .delete(schema.adminWizardSessions)
    .where(
      and(
        eq(schema.adminWizardSessions.telegramUserId, telegramUserId),
        eq(schema.adminWizardSessions.communityId, communityId),
      ),
    )
}

export async function recordAdminWizardPrompt(
  database: Database,
  input: {
    readonly telegramUserId: bigint
    readonly communityId: string
    readonly chatId: number
    readonly messageId: number
    readonly now: Date
  },
): Promise<void> {
  const session = await getAdminWizardSession(
    database,
    input.telegramUserId,
    input.communityId,
    input.now,
  )
  if (!session) return

  await database
    .update(schema.adminWizardSessions)
    .set({
      data: {
        ...session.data,
        _wizardChatId: input.chatId,
        _wizardPromptMessageId: input.messageId,
      },
      updatedAt: input.now,
    })
    .where(eq(schema.adminWizardSessions.id, session.id))
}
