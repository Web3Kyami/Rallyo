import { describe, expect, it } from 'vitest'

import type { AppTask } from '../api/client'
import { filterPlayerTasks, formatDeadline, shortAddress, taskState } from './player-data'

const baseTask: AppTask = {
  id: 'task-1',
  communityId: 'community-1',
  communityTitle: 'Northstar Guild',
  title: 'Post about Rallyo',
  instructions: 'Share the latest Rallyo update.',
  points: 5,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-20T00:00:00.000Z',
  submission: null,
}

describe('player data helpers', () => {
  it('maps the server submission state to the player task state', () => {
    expect(taskState(baseTask)).toBe('Available')
    expect(taskState({ submission: { status: 'PENDING', createdAt: baseTask.startsAt } })).toBe(
      'Pending',
    )
    expect(taskState({ submission: { status: 'APPROVED', createdAt: baseTask.startsAt } })).toBe(
      'Approved',
    )
    expect(taskState({ submission: { status: 'REJECTED', createdAt: baseTask.startsAt } })).toBe(
      'Rejected',
    )
  })

  it('filters active tasks without inventing history rows', () => {
    const tasks: AppTask[] = [
      baseTask,
      {
        ...baseTask,
        id: 'task-2',
        submission: { status: 'PENDING', createdAt: baseTask.startsAt },
      },
      {
        ...baseTask,
        id: 'task-3',
        submission: { status: 'APPROVED', createdAt: baseTask.startsAt },
      },
      {
        ...baseTask,
        id: 'task-4',
        submission: { status: 'REJECTED', createdAt: baseTask.startsAt },
      },
    ]
    expect(filterPlayerTasks(tasks, 'available').map((task) => task.id)).toEqual(['task-1'])
    expect(filterPlayerTasks(tasks, 'pending').map((task) => task.id)).toEqual(['task-2'])
    expect(filterPlayerTasks(tasks, 'approved').map((task) => task.id)).toEqual(['task-3'])
    expect(filterPlayerTasks(tasks, 'history').map((task) => task.id)).toEqual(['task-4'])
  })

  it('formats deadlines and wallet references for compact surfaces', () => {
    expect(formatDeadline('2026-09-15T11:00:00.000Z', new Date('2026-09-15T10:00:00.000Z'))).toBe(
      'Ends in under 2 hours',
    )
    expect(shortAddress('NQ42 1234 5678 9012 3456 7890 1234 5678')).toBe('NQ42 1234…34 5678')
  })
})
