import type { DesignTask, FigmaSession } from '@tempad-dev/shared'

import { describe, expect, it } from 'vitest'

import type { DesignTaskSnapshot } from '../src/design-task-store'
import type { ExtensionConnection } from '../src/types'

import { DesignTasks } from '../src/design-tasks'
import { HISTORY_RETENTION_MS } from '../src/history-retention'

const generation = '00000000-0000-4000-8000-000000000001'
const session: FigmaSession = {
  fileKey: 'unrecorded-file',
  fileName: 'File',
  pageId: 'page',
  sessionId: 'session',
  tabId: 1,
  documentId: 'document',
  busy: false
}

function fixture() {
  let snapshot: DesignTaskSnapshot = {
    revision: 0,
    current: {},
    records: [],
    recoveryGeneration: generation
  }
  let now = 1000
  let id = 0
  const store = {
    load: () => structuredClone(snapshot),
    save: (value: DesignTaskSnapshot) => {
      snapshot = structuredClone(value)
    }
  }
  const restart = () => {
    const tasks = new DesignTasks({ createId: () => `new-${++id}`, now: () => now, store })
    tasks.restore()
    return tasks
  }
  return {
    restart,
    store,
    advance: () => {
      now += HISTORY_RETENTION_MS + 1
    }
  }
}

function begin(tasks: DesignTasks, acknowledged?: string, target = session) {
  return tasks.begin(
    'owner',
    'extension',
    target,
    'New task',
    'fresh-request',
    undefined,
    undefined,
    undefined,
    acknowledged
  )
}

describe('recovered storage generations', () => {
  it('rejects queued old begins and taskless writes, requiring acknowledgment and a fresh read', () => {
    const tasks = fixture().restart()
    expect(() => begin(tasks)).toThrow(generation)
    expect(() => begin(tasks, '00000000-0000-4000-8000-000000000002')).toThrow(generation)
    expect(() => tasks.checkOperation('owner', session, undefined, true)).toThrow('new task')
    expect(() => tasks.checkOperation('owner', session)).not.toThrow()
    expect(() => begin(tasks, generation, { ...session, busy: true })).toThrow('not finished')
    const record = begin(tasks, generation)
    expect(() => begin(tasks)).toThrow(generation)
    expect(() => begin(tasks, '00000000-0000-4000-8000-000000000002')).toThrow(generation)
    expect(begin(tasks, generation)).toBe(record)
    tasks.confirm(record.task.taskId, 'owner')
    expect(() => tasks.checkOperation('owner', session, record.task.taskId, true)).toThrow(
      'The resumed task has not confirmed its bound canvas state.'
    )
    tasks.acknowledgeRead(record.task.taskId, 'owner', 0)
    expect(() => tasks.checkOperation('owner', session, record.task.taskId, true)).not.toThrow()
    tasks.stop(record.task.taskId, 'cancelled')
    expect(record.task.status).toBe('cancelled')
    expect(() => tasks.resume(record.task.taskId, 'owner', 0, session)).toThrow('cannot resume')
  })

  it.each(['active', 'completed', 'cancelled'] as const)(
    'never imports an unknown old %s review after recovery or restart',
    (status) => {
      const f = fixture()
      const old: DesignTask = {
        taskId: 'unknown-old',
        title: 'Old',
        target: session,
        status,
        operation: null,
        expiresAt: 1000,
        revision: 5
      }
      const extension = {
        id: 'extension',
        origin: 'chrome-extension://test',
        sessions: { browserId: 'browser', sessions: [session] }
      } as ExtensionConnection
      for (let restart = 0; restart < 2; restart++) {
        const tasks = f.restart()
        tasks.restoreReview(old, extension, session)
        expect(tasks.find(old.taskId)).toBeUndefined()
        expect(tasks.current(session.fileKey)).toBeUndefined()
        expect(() => tasks.resume(old.taskId, 'owner', 0, session)).toThrow('Unknown')
        expect(() => tasks.checkOperation('owner', session, undefined, true)).toThrow('new task')
      }
    }
  )

  it('keeps the generation after history pruning and honors Stop recovered for a new task', () => {
    const f = fixture()
    const tasks = f.restart()
    const record = begin(tasks, generation)
    const stopped = { ...record.task, status: 'cancelled' as const }
    tasks.disconnectExtension('extension')
    tasks.restoreReview(
      stopped,
      {
        id: 'reconnected',
        origin: 'chrome-extension://test',
        sessions: { browserId: 'browser', sessions: [session] }
      } as ExtensionConnection,
      session
    )
    expect(record.task.status).toBe('cancelled')
    f.advance()
    tasks.sweep()
    expect(tasks.find(record.task.taskId)).toBeUndefined()
    expect(f.store.load().recoveryGeneration).toBe(generation)
    const restarted = f.restart()
    expect(() => begin(restarted)).toThrow(generation)
    expect(() =>
      restarted.checkOperation(
        'owner',
        { ...session, fileKey: 'another-unknown-file' },
        undefined,
        true
      )
    ).toThrow('new task')
  })
})
