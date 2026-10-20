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
  const onChange = vi.fn()
  const options = { createId: () => `task-${++id}`, now: () => 1000, store, onChange }
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
  return { tasks, begin, restart, store, onChange }
}

describe('durable design reviews', () => {
  it('retains taskless read requirements across restart until a successful read', () => {
    const f = fixture()
    f.tasks.requireFileRead(session.fileKey)
    const restored = f.restart()
    expect(() => restored.checkOperation('new-owner', session, undefined, true)).toThrow(
      'previous write result was lost'
    )
    restored.acknowledgeFileRead(session.fileKey)
    expect(() => f.restart().checkOperation('new-owner', session, undefined, true)).not.toThrow()
  })

  it('retains a read requirement in memory and storage when clearing it cannot be saved', () => {
    const f = fixture()
    f.tasks.requireFileRead(session.fileKey)
    const save = f.store.save
    f.store.save = () => {
      throw new Error('Disk full')
    }
    f.tasks.acknowledgeFileRead(session.fileKey)
    f.store.save = save
    expect(() => f.tasks.checkOperation('owner', session, undefined, true)).toThrow(
      'previous write result was lost'
    )
    expect(() => f.restart().checkOperation('owner', session, undefined, true)).toThrow(
      'previous write result was lost'
    )
  })

  it('does not let an old completion clear a newer read requirement', () => {
    const f = fixture()
    const generation = f.tasks.requireFileRead(session.fileKey)
    f.tasks.requireFileRead(session.fileKey)
    f.tasks.acknowledgeFileRead(session.fileKey, generation)
    expect(() => f.restart().checkOperation('owner', session, undefined, true)).toThrow(
      'previous write result was lost'
    )
    f.tasks.acknowledgeFileRead(session.fileKey)
    expect(() => f.restart().checkOperation('owner', session, undefined, true)).not.toThrow()
  })

  it('writes result roots only when their ordered last-20 snapshot changes', () => {
    const f = fixture()
    const record = f.begin()
    const taskId = record.task.taskId
    const save = vi.spyOn(f.store, 'save')
    f.tasks.captureResult(taskId, 'absent', true)
    expect(save).not.toHaveBeenCalled()
    for (let index = 0; index < 21; index++) f.tasks.captureResult(taskId, `root-${index}`, false)
    expect(save).toHaveBeenCalledTimes(21)
    expect(f.store.load()?.records[0]?.resultNodeIds).toEqual(
      Array.from({ length: 20 }, (_, index) => `root-${index + 1}`)
    )
    save.mockClear()
    f.tasks.captureResult(taskId, 'root-20', false)
    f.tasks.captureResult(taskId, 'root-0', true)
    expect(save).not.toHaveBeenCalled()
    f.tasks.captureResult(taskId, 'root-1', false)
    expect(save).toHaveBeenCalledOnce()
    expect(f.store.load()?.records[0]?.resultNodeIds).toEqual([
      ...Array.from({ length: 19 }, (_, index) => `root-${index + 2}`),
      'root-1'
    ])
    f.tasks.captureResult(taskId, 'root-1', true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(f.restart().find(taskId)?.resultNodeIds).toEqual(
      Array.from({ length: 19 }, (_, index) => `root-${index + 2}`)
    )
  })

  it('keeps repeated reads, confirmations, unchanged pages and idle sweeps write-free', () => {
    const f = fixture()
    const record = f.begin()
    const taskId = record.task.taskId
    f.tasks.confirm(taskId, record.ownerId)
    const before = structuredClone(record.task)
    const save = vi.spyOn(f.store, 'save')
    f.tasks.find(taskId)
    f.tasks.owned(taskId, record.ownerId)
    f.tasks.confirm(taskId, record.ownerId)
    f.tasks.list()
    f.tasks.sweep()
    f.tasks.updatePage(taskId, session.pageId)
    expect(save).not.toHaveBeenCalled()
    expect(record.task).toEqual(before)
    expect(record.ready).toBe(true)
    f.tasks.updatePage(taskId, 'page-new')
    expect(save).toHaveBeenCalledOnce()
    expect(record.task.expiresAt).toBe(before.expiresAt)
    expect(record.task.needsRead).toBe(before.needsRead)
    expect(record.ready).toBe(true)
    expect(f.restart().find(taskId)?.task.target.pageId).toBe('page-new')
  })

  it('retains a completed snapshot across restart until resume starts a new result pass', () => {
    const f = fixture()
    const record = f.begin()
    const taskId = record.task.taskId
    f.tasks.captureResult(taskId, 'root-a', false)
    f.tasks.snapshotResult(taskId, 'Saved first pass')
    f.tasks.stop(taskId, 'completed')
    const restored = f.restart()
    expect(restored.find(taskId)?.task.result).toEqual(record.task.result)
    restored.attachClient('fresh-transport', client)
    const resumed = restored.resume(taskId, 'fresh-transport', 1, session)
    expect(resumed.task.result).toBeUndefined()
    // A restart during resumed work must not restore the old completion snapshot.
    const next = f.restart()
    expect(next.find(taskId)?.task.result).toBeUndefined()
    next.attachClient('next-transport', client)
    next.resume(taskId, 'next-transport', 3, session)
    next.snapshotResult(taskId, 'New pass without canvas mutations')
    next.stop(taskId, 'completed')
    expect(f.restart().find(taskId)?.task.result).toEqual({
      nodeIds: ['root-a'],
      summary: 'New pass without canvas mutations',
      capturedAt: 1000
    })
  })

  it.each(['completed', 'paused', 'interrupted', 'expired'] as const)(
    'keeps the %s review unchanged when its resumed lease cannot be saved',
    (status) => {
      const f = fixture()
      const record = f.begin()
      const task = record.task
      f.tasks.confirm(task.taskId, record.ownerId)
      if (status === 'completed') f.tasks.snapshotResult(task.taskId, 'Prior completed pass')
      f.tasks.stop(task.taskId, status)
      const before = structuredClone(record)
      const saved = f.store.load()
      const save = f.store.save
      f.store.save = () => {
        throw new Error('Disk full')
      }
      f.onChange.mockClear()

      expect(() => f.tasks.resume(task.taskId, record.ownerId, 0, session)).toThrow('Disk full')
      expect(record.task).toBe(task)
      expect(record).toEqual(before)
      expect(f.onChange).not.toHaveBeenCalled()
      expect(f.store.load()).toEqual(saved)
      expect(() => f.begin()).toThrow('storage recovers')

      f.store.save = save
      const resumed = f.tasks.resume(task.taskId, record.ownerId, 0, session)
      expect(resumed.task).toBe(task)
      expect(task).toMatchObject({ status: 'active', epoch: 1, needsRead: true })
      expect(task.result).toBeUndefined()
      expect(record.ready).toBe(false)
      expect(record.ending).toBeUndefined()
      expect(f.onChange).toHaveBeenCalledOnce()
      expect(f.store.load()?.records[0]?.task).toMatchObject({ status: 'active', epoch: 1 })
      expect(f.store.load()?.records[0]?.task.result).toBeUndefined()
      const restored = f.restart().find(task.taskId)?.task
      expect(restored).toMatchObject({
        status: 'paused',
        epoch: 2,
        needsRead: true
      })
      expect(restored?.result).toBeUndefined()
    }
  )

  it.each([false, true])(
    'delivers offline Stop before cancellation even when reviewClosed=%s',
    (reviewClosed) => {
      const seen: string[] = []
      const tasks = new DesignTasks({
        createId: () => 'task',
        now: () => 1000,
        onReviewStop: (record) => {
          seen.push(record.task.status)
        }
      })
      const record = tasks.begin(
        'owner',
        'old-connection',
        session,
        'Review',
        'request',
        client,
        undefined,
        browser
      )
      tasks.disconnectExtension('old-connection')
      expect(record.extensionId).toBe('')
      tasks.restoreReview(
        { ...record.task, status: 'cancelled', reviewClosed },
        extension(),
        session
      )
      expect(seen).toEqual(['interrupted'])
      expect(record.task.status).toBe('cancelled')
      expect(!!record.task.reviewClosed).toBe(reviewClosed)
      tasks.restoreReview({ ...record.task, status: 'cancelled' }, extension(), session)
      expect(seen).toHaveLength(1)
    }
  )
  it('rejects copied Stop and Done snapshots from another connection or Origin', () => {
    const f = fixture()
    const record = f.begin()
    const copied = { ...record.task, reviewClosed: true, status: 'cancelled' as const }
    f.tasks.restoreReview(copied, extension(), session)
    f.tasks.restoreReview(
      copied,
      { ...extension(), id: record.extensionId, origin: 'chrome-extension://attacker' },
      session
    )
    expect(record.task.status).toBe('active')
    expect(record.task.reviewClosed).toBeUndefined()
  })

  it('keeps Stop in memory on storage failure and retries before accepting writes', () => {
    const f = fixture()
    const record = f.begin()
    const save = f.store.save
    f.store.save = () => {
      throw new Error('Disk full')
    }
    expect(() => f.tasks.stop(record.task.taskId, 'cancelled')).not.toThrow()
    expect(record.task.status).toBe('cancelled')
    expect(() => f.begin()).toThrow('storage recovers')
    f.store.save = save
    f.tasks.sweep()
    expect(f.restart().find(record.task.taskId)?.task.status).toBe('cancelled')
  })
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
    f2.tasks.restoreReview(
      { ...stopped.task, status: 'cancelled' },
      { ...extension(), id: 'original-extension' },
      session
    )
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
