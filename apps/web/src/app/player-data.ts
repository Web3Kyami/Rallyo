import type { AppTask, AppTaskDetail } from '../api/client'

export type PlayerTaskFilter = 'available' | 'pending' | 'approved' | 'history'

export type PlayerTaskState = 'Available' | 'Pending' | 'Approved' | 'Rejected'

export const avatarStyles = [
  { id: 'masculine', label: 'Masculine' },
  { id: 'feminine', label: 'Feminine' },
  { id: 'neutral', label: 'Neutral' },
] as const

export const avatarOptions = avatarStyles.flatMap((style) =>
  Array.from({ length: 4 }, (_, index) => ({
    id: `${style.id}-${String(index + 1).padStart(2, '0')}`,
    style: style.id,
    label: `${style.label} ${index + 1}`,
  })),
)

const AVATAR_STORAGE_KEY = 'rallyo.player.avatar'

export function hasStoredAvatarId(): boolean {
  try {
    return window.localStorage.getItem(AVATAR_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export function getStoredAvatarId(): string {
  try {
    return window.localStorage.getItem(AVATAR_STORAGE_KEY) ?? 'neutral-01'
  } catch {
    return 'neutral-01'
  }
}

export function storeAvatarId(avatarId: string): void {
  try {
    window.localStorage.setItem(AVATAR_STORAGE_KEY, avatarId)
  } catch {
    // Local storage is a convenience until the Player profile service exposes avatar persistence.
  }
}

export function taskState(
  task: Pick<AppTask, 'submission'> | Pick<AppTaskDetail, 'submission'>,
): PlayerTaskState {
  switch (task.submission?.status) {
    case 'PENDING':
      return 'Pending'
    case 'APPROVED':
      return 'Approved'
    case 'REJECTED':
      return 'Rejected'
    default:
      return 'Available'
  }
}

export function filterPlayerTasks(
  tasks: readonly AppTask[],
  filter: PlayerTaskFilter,
): readonly AppTask[] {
  if (filter === 'history') return tasks.filter((task) => taskState(task) === 'Rejected')
  const wanted: PlayerTaskState =
    filter === 'available' ? 'Available' : filter === 'pending' ? 'Pending' : 'Approved'
  return tasks.filter((task) => taskState(task) === wanted)
}

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, options ?? { month: 'short', day: 'numeric' }).format(
    date,
  )
}

export function formatDateTime(value: string | Date): string {
  return formatDate(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatDeadline(value: string | Date, now = new Date()): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Deadline unavailable'
  const hours = Math.round((date.getTime() - now.getTime()) / 3_600_000)
  if (hours >= 0 && hours < 48) return `Ends in ${hours <= 1 ? 'under 2 hours' : `${hours} hours`}`
  return `Ends ${formatDate(date)}`
}

export function shortAddress(address: string): string {
  if (address.length <= 18) return address
  return `${address.slice(0, 9)}…${address.slice(-7)}`
}

export function gameLabel(gameKey: string): string {
  if (gameKey === 'project_quiz') return 'Quiz / Race'
  if (gameKey === 'word_seek') return 'Word Seek'
  if (gameKey === 'scramble') return 'Scramble'
  return gameKey
}
