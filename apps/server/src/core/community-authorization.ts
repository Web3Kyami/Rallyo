import { and, eq } from 'drizzle-orm'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'

export class CommunityAuthorizationError extends Error {
  constructor(message = 'The actor is not authorized for this community.') {
    super(message)
    this.name = 'CommunityAuthorizationError'
  }
}

export async function assertCommunityAdmin(
  database: RallyoDatabase,
  communityId: string,
  telegramUserId: bigint,
): Promise<void> {
  const rows = await database
    .select({ id: schema.communityAdmins.id })
    .from(schema.communityAdmins)
    .where(
      and(
        eq(schema.communityAdmins.communityId, communityId),
        eq(schema.communityAdmins.telegramUserId, telegramUserId),
      ),
    )
    .limit(1)

  if (!rows[0]) throw new CommunityAuthorizationError()
}
