import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../db/schema'

type Database = NodePgDatabase<typeof schema>

export class ScheduleService {
  constructor(private readonly database: Database) {}

  async claimDueSchedules(now: Date, limit = 10, leaseSeconds = 60) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Schedule claim limit must be an integer between 1 and 100.')
    }
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 86_400) {
      throw new Error('Schedule lease must be an integer between 1 and 86400 seconds.')
    }

    const lockedUntil = new Date(now.getTime() + leaseSeconds * 1_000)

    return this.database.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(schema.schedules)
        .where(
          and(
            eq(schema.schedules.enabled, true),
            lte(schema.schedules.nextRunAt, now),
            or(isNull(schema.schedules.lockedUntil), lte(schema.schedules.lockedUntil, now)),
          ),
        )
        .orderBy(schema.schedules.nextRunAt)
        .limit(limit)
        .for('update', { skipLocked: true })

      const claimed = []
      for (const schedule of due) {
        const [updated] = await tx
          .update(schema.schedules)
          .set({ lockedUntil, lockVersion: sql`${schema.schedules.lockVersion} + 1` })
          .where(
            and(
              eq(schema.schedules.id, schedule.id),
              eq(schema.schedules.enabled, true),
              eq(schema.schedules.lockVersion, schedule.lockVersion),
              or(isNull(schema.schedules.lockedUntil), lte(schema.schedules.lockedUntil, now)),
            ),
          )
          .returning()

        if (updated) claimed.push(updated)
      }

      return claimed
    })
  }

  async completeSchedule(input: {
    readonly id: string
    readonly lockVersion: number
    readonly nextRunAt?: Date
    readonly enabled?: boolean
    readonly payload?: Record<string, unknown>
    readonly now: Date
  }): Promise<boolean> {
    const disableAfterRun = input.nextRunAt === undefined && input.enabled === undefined
    const rows = await this.database
      .update(schema.schedules)
      .set({
        lockedUntil: null,
        lastRunAt: input.now,
        ...(input.nextRunAt ? { nextRunAt: input.nextRunAt } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
        ...(input.enabled === undefined
          ? disableAfterRun
            ? { enabled: false }
            : {}
          : { enabled: input.enabled }),
      })
      .where(
        and(eq(schema.schedules.id, input.id), eq(schema.schedules.lockVersion, input.lockVersion)),
      )
      .returning({ id: schema.schedules.id })

    return rows.length === 1
  }
}
