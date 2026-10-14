import type { FigmaSession } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import type { DesignTaskSnapshot } from '../src/design-task-store'
import type { ExtensionConnection } from '../src/types'

import { DesignTasks } from '../src/design-tasks'
import { HISTORY_RETENTION_MS } from '../src/history-retention'

const session: FigmaSession = {
  sessionId: 'session',
  fileKey: 'file',
  fileName: 'Design',
  pageId: 'page',
  busy: false
}
const client = { kind: 'codex-app' as const, name: 'Codex', sessionId: 'conversation' }
function fixture() {
  let time = 1000
  let id = 0
  let snapshot: DesignTaskSnapshot | undefined
  const store = {
    load: () => structuredClone(snapshot),
    save: vi.fn((value: DesignTaskSnapshot) => {
      snapshot = structuredClone(value)
    })
  }
  const options = { createId: () => `task-${++id}`, now: () => time, store }
  const tasks = new DesignTasks(options)
  const begin = (request = `request-${id + 1}`, owner = 'owner') => {
    const record = tasks.begin(owner, 'extension', session, 'Design', request, client)
    tasks.confirm(record.task.taskId, owner)
    return record
  }
  const restart = () => {
    const next = new DesignTasks(options)
    next.restore()
    return next
  }
  return {
    tasks,
    begin,
    restart,
    store,
    advance: (elapsed: number) => {
      time += elapsed
    }
  }
}

describe('design task history retention', () => {
  it('expires cancelled details while retaining restart-safe Stop and stale-review fences', () => {
    const f = fixture()
    const record = f.begin('original-request')
    const oldTab = structuredClone(record.task)
    f.tasks.stop(record.task.taskId, 'cancelled')
    f.advance(HISTORY_RETENTION_MS - 1)
    expect(f.tasks.retry('owner', 'original-request')).toBe(record)
    f.advance(1)
    expect(f.tasks.find(record.task.taskId)).toBeUndefined()
    expect(f.tasks.current(session.fileKey)).toBeUndefined()
    expect(() => f.tasks.retry('owner', 'original-request')).toThrow('requestId has expired')
    const restored = f.restart()
    const extension = {
      id: 'extension',
      origin: 'chrome-extension://test',
      sessions: { browserId: 'browser', sessions: [session] }
    } as ExtensionConnection
    expect(restored.restoreReview(oldTab, extension, session)).toBeUndefined()
    expect(restored.find(oldTab.taskId)).toBeUndefined()
    expect(() => restored.checkOperation('owner', session, undefined, true)).toThrow('stopped task')
    const fresh = restored.begin('new-owner', 'extension', session, 'New work', 'fresh', client)
    restored.confirm(fresh.task.taskId, 'new-owner')
    expect(() =>
      restored.checkOperation('new-owner', session, fresh.task.taskId, true)
    ).not.toThrow()
    expect(restored.find(oldTab.taskId)).toBeUndefined()
    expect(f.store.load()?.fileFences).toEqual({ file: true })
  })

  it('starts replacement retention at replacement and preserves the current open review', () => {
    const f = fixture()
    const first = f.begin()
    f.tasks.stop(first.task.taskId, 'completed')
    f.advance(HISTORY_RETENTION_MS * 2)
    expect(f.tasks.find(first.task.taskId)).toBe(first)
    const current = f.begin()
    f.tasks.stop(current.task.taskId, 'completed')
    f.advance(HISTORY_RETENTION_MS - 1)
    expect(f.tasks.find(first.task.taskId)).toBe(first)
    f.advance(1)
    expect(f.tasks.find(first.task.taskId)).toBeUndefined()
    expect(f.tasks.find(current.task.taskId)).toBe(current)
    expect(f.store.load()?.fileFences).toEqual({ file: false })
    const restored = f.restart()
    restored.attachClient('new-owner', client)
    expect(() => restored.resume(current.task.taskId, 'new-owner', 1, session)).not.toThrow()
  })

  it.each(['completed', 'paused', 'interrupted', 'expired'] as const)(
    'retains a current unclosed %s review without a retirement clock',
    (status) => {
      const f = fixture()
      const record = f.begin()
      f.tasks.stop(record.task.taskId, status)
      f.advance(HISTORY_RETENTION_MS * 2)
      expect(f.tasks.find(record.task.taskId)).toBe(record)
      expect(record.retiredAt).toBeUndefined()
    }
  )

  it('does not retire active or draining operations until definitive completion', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.startOperation(
      'operation',
      'owner',
      'extension',
      'browser',
      session,
      record.task.taskId,
      true
    )
    f.advance(HISTORY_RETENTION_MS * 2)
    expect(f.tasks.find(record.task.taskId)?.task.status).toBe('active')
    f.tasks.closeReview(record.task.taskId)
    f.advance(HISTORY_RETENTION_MS * 2)
    expect(f.tasks.find(record.task.taskId)?.task.status).toBe('stopping')
    expect(record.retiredAt).toBeUndefined()
    f.tasks.finishOperation('operation', 'extension')
    f.advance(HISTORY_RETENTION_MS - 1)
    expect(f.tasks.find(record.task.taskId)).toBe(record)
    f.advance(1)
    expect(f.tasks.find(record.task.taskId)).toBeUndefined()
  })

  it('expires closed completed reviews without treating them as cancelled writes', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'completed')
    f.tasks.closeReview(record.task.taskId)
    f.advance(HISTORY_RETENTION_MS)
    expect(f.tasks.find(record.task.taskId)).toBeUndefined()
    expect(() => f.tasks.checkOperation('owner', session, undefined, true)).not.toThrow()
    expect(f.store.load()?.fileFences).toEqual({ file: false })
  })

  it('migrates legacy records from first load and never resets their retirement clock on restart', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'cancelled')
    const legacy = f.store.load()!
    delete legacy.records[0]!.retiredAt
    f.store.save(legacy)
    f.advance(HISTORY_RETENTION_MS * 3)
    const migrated = f.restart()
    const retiredAt = migrated.find(record.task.taskId)!.retiredAt
    expect(retiredAt).toBe(1000 + HISTORY_RETENTION_MS * 3)
    f.advance(HISTORY_RETENTION_MS / 2)
    const again = f.restart()
    expect(again.find(record.task.taskId)!.retiredAt).toBe(retiredAt)
    f.advance(HISTORY_RETENTION_MS / 2)
    expect(again.find(record.task.taskId)).toBeUndefined()
  })

  it('keeps writes blocked until a failed pruning snapshot and its file fence become durable', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'cancelled')
    const save = f.store.save.getMockImplementation()!
    f.store.save.mockImplementation(() => {
      throw new Error('Disk full')
    })
    f.advance(HISTORY_RETENTION_MS)
    expect(f.tasks.find(record.task.taskId)).toBeUndefined()
    expect(() => f.tasks.checkOperation('owner', session, undefined, true)).toThrow(
      'storage recovers'
    )
    f.store.save.mockImplementation(save)
    f.tasks.sweep()
    expect(f.store.load()).toMatchObject({ current: {}, records: [], fileFences: { file: true } })
    expect(() => f.restart().checkOperation('owner', session, undefined, true)).toThrow(
      'stopped task'
    )
  })

  it('forgets expired begin IDs on disconnect rather than retaining every past owner', () => {
    const f = fixture()
    const record = f.begin('expired-request')
    f.tasks.stop(record.task.taskId, 'cancelled')
    f.advance(HISTORY_RETENTION_MS)
    expect(() => f.tasks.retry('owner', 'expired-request')).toThrow('requestId has expired')
    f.tasks.disconnectOwner('owner')
    expect(f.tasks.retry('owner', 'expired-request')).toBeUndefined()
    expect(f.begin('expired-request', 'new-owner').task.taskId).not.toBe(record.task.taskId)
  })

  it('does not recreate a disconnected owner cache during review capability refresh', () => {
    const f = fixture()
    const record = f.begin('old-request')
    f.tasks.stop(record.task.taskId, 'cancelled')
    f.tasks.disconnectOwner('owner')
    f.tasks.attachClient('owner', client)
    f.advance(HISTORY_RETENTION_MS)
    expect(f.tasks.retry('owner', 'old-request')).toBeUndefined()
    expect(f.tasks.find(record.task.taskId)).toBeUndefined()
  })

  it('preserves a current review when persisting its replacement fails', () => {
    const f = fixture()
    const record = f.begin()
    f.tasks.stop(record.task.taskId, 'paused')
    const save = f.store.save.getMockImplementation()!
    f.store.save.mockImplementation(() => {
      throw new Error('Disk full')
    })
    expect(() => f.begin()).toThrow('Disk full')
    f.store.save.mockImplementation(save)
    f.advance(HISTORY_RETENTION_MS)
    expect(f.tasks.find(record.task.taskId)).toBe(record)
    expect(f.tasks.current(session.fileKey)).toBe(record)
    expect(record.retiredAt).toBeUndefined()
  })
})
