import { sql, type SQL, type AnyColumn } from 'drizzle-orm'

export const FALLBACK_PLAYER_NAME = 'Rallyo player'

export function resolvePlayerDisplayName(telegramName: string | null, nickname: string | null) {
  return telegramName ?? nickname ?? FALLBACK_PLAYER_NAME
}

export function playerDisplayNameSql(
  telegramName: SQL | AnyColumn,
  nickname: SQL | AnyColumn,
): SQL<string> {
  return sql<string>`coalesce(${telegramName}, ${nickname}, ${FALLBACK_PLAYER_NAME})`
}

export function validatePlayerNickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a nickname between 2 and 32 characters.')
  const nickname = value.trim()
  if (
    [...nickname].length < 2 ||
    [...nickname].length > 32 ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}<>]/u.test(nickname)
  ) {
    throw new Error('Use 2 to 32 plain-text characters for your nickname.')
  }
  return nickname
}
