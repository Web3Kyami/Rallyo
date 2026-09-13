import type { ScheduleService } from './schedule-service'

export type ScheduleExecutionResult = {
  readonly nextRunAt?: Date
  readonly enabled?: boolean
  readonly payload?: Record<string, unknown>
}

export type ScheduleExecutionHandler = (input: {
  readonly schedule: Awaited<ReturnType<ScheduleService['claimDueSchedules']>>[number]
  readonly now: Date
}) => Promise<ScheduleExecutionResult>

export class ScheduleWorker {
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly schedules: ScheduleService,
    private readonly handler: ScheduleExecutionHandler,
    private readonly intervalMs = 1_000,
  ) {}

  async tick(now = new Date()): Promise<void> {
    const claimed = await this.schedules.claimDueSchedules(now)

    for (const schedule of claimed) {
      try {
        const result = await this.handler({ schedule, now })
        await this.schedules.completeSchedule({
          id: schedule.id,
          lockVersion: schedule.lockVersion,
          now,
          ...(result.nextRunAt ? { nextRunAt: result.nextRunAt } : {}),
          ...(result.enabled === undefined ? {} : { enabled: result.enabled }),
          ...(result.payload ? { payload: result.payload } : {}),
        })
      } catch {
        // The lease expiry makes failed jobs retryable after a restart or transient error.
      }
    }
  }

  start(): () => void {
    this.stopped = false

    const loop = async () => {
      if (this.stopped) return

      try {
        await this.tick()
      } catch (error) {
        // A polling/scheduler query failure must not terminate the Telegram process.
        // The next loop retries; operators still see the failure in server logs.
        console.error('Schedule worker tick failed; retrying.', error)
      } finally {
        if (!this.stopped) this.timer = setTimeout(() => void loop(), this.intervalMs)
      }
    }

    void loop()
    return () => this.stop()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
  }
}
