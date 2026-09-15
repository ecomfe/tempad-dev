import type { DesignTask, FigmaSession } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import type { DesignTaskSnapshot } from '../src/design-task-store'
import type { ExtensionConnection } from '../src/types'

import { DesignTasks } from '../src/design-tasks'

const client = { kind: 'codex-app' as const, name: 'Codex', sessionId: 'original-conversation' }
const session: FigmaSession = {
  sessionId: 'original-session',
  fileKey: 'file-a',
  fileName: 'Design',
  pageId: 'page-a',
  tabId: 4,
  documentId: 'original-document',
  busy: false
}
const browser = { browserId: 'browser-a', origin: 'chrome-extension://tempad' }
function extension(target = session): ExtensionConnection {
  return {
    id: 'extension-new',
    origin: browser.origin,
    sessions: { browserId: browser.browserId, sessions: [target] }
  } as ExtensionConnection
}
function fixture() {
  let snapshot: DesignTaskSnapshot | undefined
  let id = 0
  const store = {
    load: () => structuredClone(snapshot),
    save: (value: DesignTaskSnapshot) => {
      snapshot = structuredClone(value)
    }
  }
  const options = { createId: () => `task-${++id}`, now: () => 1000, store }
  const tasks = new DesignTasks(options)
  const begin = () =>
    tasks.begin(
      'original-transport',
      'original-extension',
      session,
      'Review',
      `request-${id}`,
      client,
      undefined,
      browser
    )
  function restart() {
    const restored = new DesignTasks(options)
    restored.restore()
    return restored
  }
  return { tasks, begin, restart, store }
}

describe('durable design reviews', () => {
  it.each(['active', 'completed', 'cancelled'] as const)(
    'restores %s metadata with no transport, operation, capability, or old write lease',
    (status) => {
      const f = fixture()
      const record = f.begin()
      f.tasks.confirm(record.task.taskId, record.ownerId)
      if (status !== 'active') f.tasks.stop(record.task.taskId, status)
      const restored = f.restart()
      const saved = restored.find(record.task.taskId)!
      expect(saved.task).toMatchObject({
        taskId: record.task.taskId,
        client,
        status: status === 'active' ? 'paused' : status,
        epoch: 1,
        operation: null,
        needsRead: true
      })
      expect(saved.ready).toBe(false)
      expect(saved.extensionId).toBe('')
      expect(saved.task.capabilities).toBeUndefined()
      expect(() => restored.owned(saved.task.taskId, 'original-transport', true)).toThrow(
        'another MCP caller'
      )
      restored.attachClient('fresh-transport', client)
      if (status !== 'cancelled') {
        expect(() => restored.assertEpoch(saved.task.taskId, 'fresh-transport', 0)).toThrow(
          'Stale task lease'
        )
        expect(() =>
          restored.checkOperation('fresh-transport', session, saved.task.taskId, true)
        ).toThrow()
      }
    }
  )

  it('keeps ordinary exact-tab refresh recovery and its read fence', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'interrupted')
    const target = { ...session, sessionId: 'new-session', documentId: 'new-document' }
    const connection = extension(target)
    f.tasks.restoreReview(record.task, connection, target)
    const recovered = f.tasks.recoverSessions([connection])
    expect(recovered).toHaveLength(1)
    expect(record.task).toMatchObject({
      status: 'active',
      epoch: 1,
      needsRead: true,
      target: { sessionId: target.sessionId }
    })
    expect(record.ready).toBe(false)
  })

  it('restores an unchanged page and a refreshed page to the same task and conversation', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'completed')
    const tasks = f.restart()
    tasks.restoreReview(record.task, extension(), session)
    expect(tasks.find(record.task.taskId)?.extensionId).toBe('extension-new')
    const refreshed = { ...session, sessionId: 'refreshed-session', documentId: 'new-document' }
    tasks.restoreReview(record.task, extension(refreshed), refreshed)
    expect(tasks.current(session.fileKey)?.task).toMatchObject({
      taskId: record.task.taskId,
      client,
      status: 'completed',
      target: { sessionId: 'refreshed-session' }
    })
    expect(tasks.current(session.fileKey)?.ready).toBe(false)
    tasks.attachClient('fresh-transport', client)
    const epoch = tasks.find(record.task.taskId)!.task.epoch!
    const resumed = tasks.resume(record.task.taskId, 'fresh-transport', epoch, refreshed)
    expect(resumed.task).toMatchObject({
      taskId: record.task.taskId,
      status: 'active',
      epoch: epoch + 1,
      needsRead: true,
      client
    })
    expect(() => tasks.assertEpoch(record.task.taskId, 'fresh-transport', epoch)).toThrow(
      'Stale task lease'
    )
    tasks.confirm(record.task.taskId, 'fresh-transport')
    expect(() =>
      tasks.checkOperation('fresh-transport', refreshed, record.task.taskId, true)
    ).toThrow('Read the bound canvas')
    tasks.checkOperation('fresh-transport', refreshed, record.task.taskId, false)
    tasks.acknowledgeRead(record.task.taskId, 'fresh-transport', epoch + 1)
    expect(() =>
      tasks.checkOperation('fresh-transport', refreshed, record.task.taskId, true)
    ).not.toThrow()
  })

  it('migrates a legacy page review without creating a write lease or replacing a newer task', () => {
    const f = fixture()
    const legacy = { ...f.begin().task, taskId: 'legacy-task' }
    const tasks = new DesignTasks({ createId: () => 'new-task', now: () => 1000, store: f.store })
    tasks.restoreReview(legacy, extension(), session)
    expect(tasks.current(session.fileKey)?.task).toMatchObject({
      taskId: 'legacy-task',
      status: 'paused',
      client
    })
    const newTask = tasks.begin(
      'new-owner',
      'extension-new',
      session,
      'New design',
      'new-request',
      client
    )
    tasks.restoreReview(legacy, extension(), session)
    expect(tasks.current(session.fileKey)).toBe(newTask)
    tasks.restoreReview({ ...legacy, taskId: 'unknown-old-task' }, extension(), session)
    expect(tasks.find('unknown-old-task')).toBeUndefined()
  })

  it('rejects a different file, conversation, browser, or live competing session', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'completed')
    const tasks = f.restart()
    const target = { ...session, sessionId: 'other-session', documentId: 'new-document' }
    tasks.restoreReview(record.task, extension(target), { ...target, fileKey: 'other-file' })
    tasks.restoreReview(
      { ...record.task, client: { ...client, sessionId: 'wrong' } },
      extension(target),
      target
    )
    const other = extension(target)
    other.sessions!.browserId = 'another-browser'
    tasks.restoreReview(record.task, other, target)
    const competing = extension(target)
    competing.sessions!.sessions.push(session)
    tasks.restoreReview(record.task, competing, target)
    expect(tasks.find(record.task.taskId)?.task.target.sessionId).toBe(session.sessionId)
  })

  it('persists Done and Stop across repeated restarts and stale page recovery', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'completed')
    const stale = structuredClone(record.task)
    f.tasks.closeReview(record.task.taskId)
    const restarted = f.restart()
    restarted.restoreReview(stale, extension(), session)
    expect(restarted.current(session.fileKey)?.task.reviewClosed).toBe(true)
    restarted.attachClient('new-transport', client)
    expect(() => restarted.resume(record.task.taskId, 'new-transport', 1, session)).toThrow(
      'closed'
    )
    const f2 = fixture()
    const stopped = f2.begin()
    f2.tasks.restoreReview({ ...stopped.task, status: 'cancelled' }, extension(), session)
    expect(f2.restart().find(stopped.task.taskId)?.task.status).toBe('cancelled')
  })

  it('persists a legacy offline Done before the first Hub restart', () => {
    const f = fixture()
    const closed: DesignTask = {
      ...f.begin().task,
      taskId: 'legacy-closed',
      status: 'completed',
      reviewClosed: true
    }
    const tasks = new DesignTasks({ createId: () => 'unused', now: () => 1000, store: f.store })
    tasks.restoreReview(closed, extension(), session)
    expect(f.restart().find(closed.taskId)?.task.reviewClosed).toBe(true)
  })

  it('does not publish a task whose durable write failed', () => {
    const onChange = vi.fn()
    const tasks = new DesignTasks({
      createId: () => 'task',
      now: () => 1000,
      onChange,
      store: {
        load: () => undefined,
        save: () => {
          throw new Error('Disk full')
        }
      }
    })
    expect(() => tasks.begin('owner', 'extension', session, 'Design', 'request')).toThrow(
      'Disk full'
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(tasks.find('task')).toBeUndefined()
  })
})
