import type { FigmaSession } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import type { ExtensionConnection } from '../src/types'

import { DesignTasks, resolveDesignTarget } from '../src/design-tasks'

const session: FigmaSession = {
  sessionId: 'tab-a',
  fileKey: 'file-a',
  fileName: 'Design',
  pageId: 'page-a',
  busy: false
}

function fixture() {
  let time = 1000
  let id = 0
  const onChange = vi.fn()
  const tasks = new DesignTasks({
    createId: () => `task-${++id}`,
    now: () => time,
    leaseMs: 100,
    onChange
  })
  function begin(owner = 'caller-a', target = session, request = `begin-${id + 1}`) {
    const entry = tasks.begin(
      owner,
      'extension-a',
      target,
      'Settings',
      request,
      undefined,
      undefined,
      {
        browserId: 'browser-a',
        origin: 'chrome-extension://tempad'
      }
    )
    tasks.confirm(entry.task.taskId, owner)
    return entry.task
  }
  function call(requestId: string, taskId?: string, write = true, target = session) {
    tasks.startOperation(requestId, 'caller-a', 'extension-a', 'browser-a', target, taskId, write)
  }
  return {
    tasks,
    begin,
    call,
    onChange,
    advance: (delta: number) => {
      time += delta
    }
  }
}

describe('design task leases', () => {
  const originalDocument = { ...session, tabId: 1, documentId: 'document-before' }
  const refreshedSession = {
    ...originalDocument,
    sessionId: 'session-after',
    documentId: 'document-after',
    pageId: 'page-b'
  }
  function refreshedExtension(target: FigmaSession = refreshedSession): ExtensionConnection {
    return {
      id: 'extension-b',
      origin: 'chrome-extension://tempad',
      sessions: { browserId: 'browser-a', sessions: [target] }
    } as ExtensionConnection
  }

  it('automatically restores a refreshed original tab with a fresh lease and read fence', () => {
    const f = fixture()
    const task = f.begin('caller-a', originalDocument)
    task.client = { kind: 'codex-app', name: 'Codex', sessionId: 'conversation-a' }
    f.tasks.disconnectExtension('extension-a')
    const extension = refreshedExtension()
    const [recovery] = f.tasks.recoverSessions([extension])
    expect(recovery?.record.task).toBe(task)
    expect(task).toMatchObject({
      status: 'active',
      epoch: 1,
      needsRead: true,
      target: { sessionId: 'session-after', fileKey: 'file-a', pageId: 'page-a' },
      client: { sessionId: 'conversation-a' }
    })
    expect(recovery?.record.extensionId).toBe('extension-b')
    expect(() => f.tasks.assertEpoch(task.taskId, 'caller-a', 0)).toThrow('get_design_task')
    expect(() => f.tasks.checkOperation('caller-a', refreshedSession, task.taskId)).toThrow(
      'not bound'
    )
    f.tasks.confirm(task.taskId, 'caller-a')
    expect(() => f.tasks.checkOperation('caller-a', refreshedSession, task.taskId, true)).toThrow(
      'Read the bound canvas'
    )
    f.tasks.checkOperation('caller-a', refreshedSession, task.taskId)
    f.tasks.acknowledgeRead(task.taskId, 'caller-a', 1)
    f.tasks.checkOperation('caller-a', refreshedSession, task.taskId, true)
    expect(
      resolveDesignTarget(f.tasks, [extension], null, 'caller-a', task.taskId).session
    ).toEqual(refreshedSession)
    const revision = task.revision
    expect(f.tasks.recoverSessions([extension])).toEqual([])
    expect(task.revision).toBe(revision)
  })

  it.each([
    { name: 'another tab', target: { ...refreshedSession, tabId: 2 } },
    { name: 'another file', target: { ...refreshedSession, fileKey: 'file-b' } },
    { name: 'the same document', target: { ...refreshedSession, documentId: 'document-before' } },
    { name: 'missing browser evidence', target: { ...refreshedSession, documentId: undefined } }
  ])('does not substitute $name even if it is the only available session', ({ target }) => {
    const f = fixture()
    const task = f.begin('caller-a', originalDocument)
    f.tasks.disconnectExtension('extension-a')
    expect(f.tasks.recoverSessions([refreshedExtension(target)])).toEqual([])
    expect(task.target.sessionId).toBe('tab-a')
    expect(task.status).toBe('interrupted')
  })

  it('requires matching browser identity and extension origin and an absent original runtime', () => {
    const f = fixture()
    const task = f.begin('caller-a', originalDocument)
    f.tasks.disconnectExtension('extension-a')
    const extension = refreshedExtension()
    expect(f.tasks.recoverSessions([{ ...extension, origin: 'chrome-extension://other' }])).toEqual(
      []
    )
    expect(
      f.tasks.recoverSessions([
        { ...extension, sessions: { ...extension.sessions!, browserId: 'other-browser' } }
      ])
    ).toEqual([])
    expect(
      f.tasks.recoverSessions([
        {
          ...extension,
          sessions: { ...extension.sessions!, sessions: [originalDocument, refreshedSession] }
        }
      ])
    ).toEqual([])
    expect(
      f.tasks.recoverSessions([extension, { ...extension, id: 'ambiguous-extension' }])
    ).toEqual([])
    expect(task.epoch).toBe(0)
  })

  it.each(['paused', 'expired'] as const)(
    'restores the %s task association without starting work',
    (status) => {
      const f = fixture()
      const task = f.begin('caller-a', originalDocument)
      f.tasks.stop(task.taskId, status)
      expect(f.tasks.recoverSessions([refreshedExtension()])).toEqual([])
      expect(task).toMatchObject({
        status,
        epoch: 1,
        needsRead: true,
        target: { sessionId: 'session-after' }
      })
      expect(f.tasks.resume(task.taskId, 'caller-a', 1, refreshedSession).task.epoch).toBe(2)
    }
  )

  it.each(['completed', 'cancelled'] as const)('never revives a %s task on refresh', (status) => {
    const f = fixture()
    const task = f.begin('caller-a', originalDocument)
    f.tasks.stop(task.taskId, status)
    expect(f.tasks.recoverSessions([refreshedExtension()])).toEqual([])
    expect(task.status).toBe(status)
    expect(task.epoch).toBe(status === 'completed' ? 1 : 0)
    expect(task.target.sessionId).toBe(status === 'completed' ? 'session-after' : 'tab-a')
    if (status === 'completed') {
      expect(() => f.tasks.assertEpoch(task.taskId, 'caller-a', 0)).toThrow()
      expect(f.tasks.resume(task.taskId, 'caller-a', 1, refreshedSession).task.epoch).toBe(2)
    }
  })

  it('waits for uncertain execution to be cleared by document replacement before recovering', () => {
    const f = fixture()
    const task = f.begin('caller-a', originalDocument)
    f.call('write-before-reload', task.taskId, true, originalDocument)
    f.tasks.disconnectExtension('extension-a')
    expect(f.tasks.recoverSessions([refreshedExtension()])).toEqual([])
    f.tasks.reconcileSessions('browser-a', [refreshedSession], [1])
    expect(f.tasks.recoverSessions([refreshedExtension()])).toHaveLength(1)
    expect(task).toMatchObject({ status: 'active', epoch: 1, operation: null, needsRead: true })
    f.tasks.finishOperation('write-before-reload', 'extension-a')
    expect(task.needsRead).toBe(true)
  })

  it('waits while another same-file runtime is busy and never revives superseded history', () => {
    const f = fixture()
    const task = f.begin('caller-a', originalDocument)
    f.tasks.disconnectExtension('extension-a')
    const extension = refreshedExtension()
    const busy = refreshedExtension({
      ...refreshedSession,
      tabId: 2,
      sessionId: 'busy-tab',
      busy: true
    })
    expect(f.tasks.recoverSessions([extension, busy])).toEqual([])
    const newer = f.begin('caller-b', refreshedSession)
    expect(f.tasks.recoverSessions([extension])).toEqual([])
    expect(task.status).toBe('interrupted')
    expect(f.tasks.current('file-a')?.task).toBe(newer)
  })

  it('keeps older task updates and resume attempts out of the current file UI', () => {
    const f = fixture()
    const first = f.begin()
    const client = { kind: 'codex' as const, name: 'Codex', sessionId: 'thread-a' }
    first.client = client
    f.tasks.stop(first.taskId, 'paused')
    const second = f.begin()
    second.client = client
    f.onChange.mockClear()
    f.tasks.attachClient('reconnected-owner', client)
    expect(f.tasks.owned(first.taskId, 'reconnected-owner').task.status).toBe('paused')
    expect(f.onChange).not.toHaveBeenCalled()
    expect(f.tasks.current(session.fileKey)?.task.taskId).toBe(second.taskId)
    f.tasks.stop(second.taskId, 'completed')
    expect(() =>
      f.tasks.resume(first.taskId, 'reconnected-owner', 0, { ...session, pageId: 'page-b' })
    ).toThrow('replaced')
    expect(f.tasks.current(session.fileKey)?.task.taskId).toBe(second.taskId)
    expect(first.target.pageId).toBe('page-a')
    f.onChange.mockClear()
    f.tasks.attachClient('caller-a', client, {
      interrupt: true,
      queue: false,
      steer: true,
      continue: false
    })
    expect(f.onChange).toHaveBeenCalledOnce()
    expect(f.onChange.mock.calls[0]![0].task.taskId).toBe(second.taskId)
  })

  it.each(['other', 'unknown'] as const)('does not reclaim a task from a %s identity', (kind) => {
    const f = fixture()
    const task = f.begin()
    const client = { kind, name: 'Custom client', sessionId: 'thread-a' }
    task.client = client
    f.tasks.stop(task.taskId, 'paused')
    f.tasks.attachClient('different-owner', client)
    expect(f.tasks.owned(task.taskId, 'caller-a').task).toBe(task)
    expect(() => f.tasks.owned(task.taskId, 'different-owner')).toThrow('another MCP caller')
  })

  it.each(['paused', 'completed'] as const)(
    'resumes the same %s task with a new lease and requires a fresh canvas read',
    (status) => {
      const f = fixture()
      const task = f.begin()
      f.tasks.stop(task.taskId, status)
      expect(task.status).toBe(status)
      expect(() => f.tasks.owned(task.taskId, 'caller-a', true)).toThrow('resume_design')
      const record = f.tasks.resume(task.taskId, 'caller-a', 0, session)
      expect(record.task.taskId).toBe(task.taskId)
      expect(record.task.epoch).toBe(1)
      expect(() => f.tasks.assertEpoch(task.taskId, 'caller-a', 0)).toThrow('Stale task lease')
      f.tasks.confirm(task.taskId, 'caller-a')
      expect(() => f.call('old-write', task.taskId)).toThrow('Read the bound canvas')
      f.call('read', task.taskId, false)
      f.tasks.finishOperation('read', 'extension-a')
      f.tasks.acknowledgeRead(task.taskId, 'caller-a', 1)
      f.call('fresh-write', task.taskId)
      expect(task.operation).toBe('writing')
    }
  )

  it.each(['paused', 'expired', 'interrupted', 'completed'] as const)(
    'fences a replaced %s task even after the new review completes or closes',
    (status) => {
      const f = fixture()
      const first = f.begin()
      f.tasks.stop(first.taskId, status)
      const second = f.begin('caller-b')
      expect(() => f.tasks.resume(first.taskId, 'caller-a', 0, session)).toThrow('replaced')
      f.tasks.stop(second.taskId, 'completed')
      expect(() => f.tasks.resume(first.taskId, 'caller-a', 0, session)).toThrow('replaced')
      f.tasks.closeReview(second.taskId)
      expect(() => f.tasks.resume(first.taskId, 'caller-a', 0, session)).toThrow('replaced')
      expect(f.tasks.current(session.fileKey)?.task.taskId).toBe(second.taskId)
    }
  )

  it('repeats completed review passes on one task until Done and rejects old epochs', () => {
    const f = fixture()
    const task = f.begin()
    for (let epoch = 0; epoch < 2; epoch++) {
      f.tasks.stop(task.taskId, 'completed')
      const resumed = f.tasks.resume(task.taskId, 'caller-a', epoch, session)
      expect(resumed.task).toBe(task)
      expect(resumed.task.epoch).toBe(epoch + 1)
      expect(() => f.tasks.assertEpoch(task.taskId, 'caller-a', epoch)).toThrow('Stale task lease')
      f.tasks.confirm(task.taskId, 'caller-a')
      expect(() => f.call('write', task.taskId)).toThrow('Read the bound canvas')
      f.call('read', task.taskId, false)
      f.tasks.finishOperation('read', 'extension-a')
      f.tasks.acknowledgeRead(task.taskId, 'caller-a', epoch + 1)
      f.call('write', task.taskId)
      f.tasks.finishOperation('write', 'extension-a')
    }
    f.tasks.stop(task.taskId, 'completed')
    f.tasks.closeReview(task.taskId)
    expect(() => f.tasks.resume(task.taskId, 'caller-a', 2, session)).toThrow('closed')
    expect(() => f.call('write-after-done', task.taskId)).toThrow('closed')
  })

  it('does not resume during a draining operation or switch to another runtime', () => {
    const f = fixture()
    const task = f.begin()
    f.call('write', task.taskId)
    f.tasks.stop(task.taskId, 'paused')
    expect(() => f.tasks.resume(task.taskId, 'caller-a', 0, session)).toThrow('stopping operation')
    f.tasks.finishOperation('write', 'extension-a')
    expect(() =>
      f.tasks.resume(task.taskId, 'caller-a', 0, { ...session, sessionId: 'other' })
    ).toThrow('original Figma runtime')
    f.tasks.stop(task.taskId, 'cancelled')
    expect(() => f.tasks.resume(task.taskId, 'caller-a', 0, session)).toThrow('cannot resume')
  })

  it('retains a completed result snapshot and excludes removed result roots', () => {
    const f = fixture()
    const task = f.begin()
    f.tasks.captureResult(task.taskId, 'root-a', false)
    f.tasks.captureResult(task.taskId, 'root-b', false)
    f.tasks.captureResult(task.taskId, 'root-a', true)
    f.tasks.snapshotResult(task.taskId, 'Updated settings')
    f.tasks.stop(task.taskId, 'completed')
    f.tasks.snapshotResult(task.taskId, 'Retry must not rewrite history')
    expect(task.result).toEqual({
      nodeIds: ['root-b'],
      summary: 'Updated settings',
      capturedAt: 1000
    })
  })

  it('routes to the acknowledged tab even after both active extension and active tab change', () => {
    const f = fixture()
    const task = f.begin()
    const extension = {
      id: 'extension-a',
      sessions: {
        type: 'sessions',
        browserId: 'browser-a',
        activeSessionId: 'tab-b',
        sessions: [session, { ...session, sessionId: 'tab-b', fileKey: 'file-b' }]
      }
    } as ExtensionConnection
    const other = {
      id: 'extension-b',
      sessions: {
        type: 'sessions',
        browserId: 'browser-b',
        activeSessionId: 'tab-c',
        sessions: [{ ...session, sessionId: 'tab-c', fileKey: 'file-c' }]
      }
    } as ExtensionConnection
    expect(
      resolveDesignTarget(f.tasks, [extension, other], 'extension-b', 'caller-a', task.taskId)
        .session
    ).toEqual(session)
    expect(
      resolveDesignTarget(f.tasks, [extension, other], 'extension-b', 'caller-a').session.sessionId
    ).toBe('tab-c')
    expect(() =>
      resolveDesignTarget(f.tasks, [other], 'extension-b', 'caller-a', task.taskId)
    ).toThrow('no other tab was selected')
    expect(() => resolveDesignTarget(f.tasks, [], null, 'caller-a')).toThrow(
      'Activate the intended file'
    )
    extension.sessions!.sessions[0] = { ...session, fileKey: 'changed' }
    expect(() =>
      resolveDesignTarget(f.tasks, [extension], 'extension-a', 'caller-a', task.taskId)
    ).toThrow('file changed')
  })

  it('includes busy same-file runtimes in another connected extension', () => {
    const f = fixture()
    const extension = {
      id: 'extension-a',
      sessions: { activeSessionId: 'tab-a', sessions: [session] }
    } as ExtensionConnection
    const other = {
      id: 'extension-b',
      sessions: { sessions: [{ ...session, sessionId: 'other', busy: true }] }
    } as ExtensionConnection
    const target = resolveDesignTarget(f.tasks, [extension, other], 'extension-a', 'caller-a')
    expect(target.session.busy).toBe(true)
    expect(() => f.begin('caller-a', target.session)).toThrow('not finished')
  })
  it('creates distinct task identities and retries begin without renewing or rebinding', () => {
    const f = fixture()
    const task = f.begin()
    f.advance(30)
    expect(
      f.tasks.begin(
        'caller-a',
        'other-extension',
        { ...session, sessionId: 'other-tab' },
        'Settings',
        'begin-1'
      ).task
    ).toBe(task)
    expect(task.expiresAt).toBe(1100)
    expect(() =>
      f.tasks.begin('caller-a', 'extension-a', session, 'Different title', 'begin-1')
    ).toThrow('another title')
    expect(() => f.begin('caller-a')).toThrow('occupied')
    expect(() => f.begin('caller-b')).toThrow('occupied')
  })

  it('locks a file across tabs but lets another file have its own task', () => {
    const f = fixture()
    f.begin()
    expect(() => f.begin('caller-b', { ...session, sessionId: 'tab-b' })).toThrow('occupied')
    expect(f.begin('caller-b', { ...session, fileKey: 'file-b', sessionId: 'tab-b' }).taskId).toBe(
      'task-2'
    )
  })

  it('releases an abandoned task while its caller stays connected; observation never renews', () => {
    const f = fixture()
    const task = f.begin()
    f.advance(99)
    f.tasks.list()
    f.tasks.retry('caller-a', 'begin-1')
    expect(task.expiresAt).toBe(1100)
    f.advance(1)
    const replacement = f.begin('caller-b')
    expect(task.status).toBe('expired')
    expect(replacement.taskId).not.toBe(task.taskId)
    expect(() => f.tasks.owned(task.taskId, 'caller-a', true)).toThrow('reread')
    expect(f.tasks.retry('caller-a', 'begin-1')?.task.status).toBe('expired')
  })

  it('renews actual work and holds long operations through lease expiry', () => {
    const f = fixture()
    const task = f.begin()
    f.advance(80)
    f.call('write-1', task.taskId)
    expect(task.operation).toBe('writing')
    expect(task.expiresAt).toBe(1180)
    f.advance(1000)
    f.tasks.sweep()
    expect(task.status).toBe('active')
    expect(() => f.begin('caller-b')).toThrow('not finished')
    f.tasks.finishOperation('write-1', 'extension-a')
    expect(task.operation).toBeNull()
    expect(task.expiresAt).toBe(2180)
    f.advance(80)
    f.tasks.touch(task.taskId, 'caller-a')
    expect(task.expiresAt).toBe(2260)
  })

  it('rejects writes without the occupying task and permits independent reads between operations', () => {
    const f = fixture()
    const task = f.begin()
    expect(() => f.call('legacy')).toThrow('occupied')
    f.call('read', undefined, false)
    expect(() => f.call('write', task.taskId)).toThrow('not finished')
    f.tasks.finishOperation('read', 'extension-a')
    f.call('task-read', task.taskId, false)
    expect(task.operation).toBe('reading')
    f.tasks.finishOperation('task-read', 'extension-a')
    f.call('write', task.taskId)
  })

  it('blocks begin while an untracked page operation is busy', () => {
    const f = fixture()
    expect(() => f.begin('caller-a', { ...session, busy: true })).toThrow('not finished')
    f.call('legacy')
    expect(() => f.begin()).toThrow('not finished')
    f.tasks.finishOperation('legacy', 'extension-a')
    expect(f.begin().status).toBe('active')
  })

  it('checks caller and target identity rather than trusting a supplied task id', () => {
    const f = fixture()
    const task = f.begin()
    expect(() => f.tasks.owned(task.taskId, 'caller-b')).toThrow('another MCP caller')
    expect(() => f.tasks.owned('unknown', 'caller-a')).toThrow('Unknown')
    expect(() => f.call('write', task.taskId, true, { ...session, sessionId: 'tab-b' })).toThrow(
      'not bound'
    )
    f.tasks.updatePage(task.taskId, 'page-b')
    expect(task.target).toMatchObject({ pageId: 'page-b', sessionId: 'tab-a' })
  })

  it('requires page acknowledgement before dispatching task work', () => {
    const f = fixture()
    const task = f.tasks.begin('caller-a', 'extension-a', session, 'Settings', 'request').task
    expect(() => f.call('write', task.taskId)).toThrow('not bound')
    f.tasks.confirm(task.taskId, 'caller-a')
    f.call('write', task.taskId)
  })

  it('stops an idle task immediately, and late end calls cannot complete a cancelled task', () => {
    const f = fixture()
    const task = f.begin()
    f.tasks.stop(task.taskId, 'cancelled')
    f.tasks.stop(task.taskId, 'completed')
    expect(task.status).toBe('cancelled')
    expect(() => f.tasks.resume(task.taskId, 'caller-a', 0, session)).toThrow('begin a new task')
    expect(() => f.call('untagged-write')).toThrow('Begin a new task')
    expect(() => f.call('late-write', task.taskId)).toThrow('Begin a new task')
    expect(f.begin('caller-b').status).toBe('active')
    expect(() => f.call('late-write', task.taskId)).toThrow('cancelled')
  })

  it('lets explicit Stop end a lifecycle pause that is already draining', () => {
    const f = fixture()
    const task = f.begin()
    f.call('write', task.taskId)
    f.tasks.stop(task.taskId, 'paused')
    f.tasks.stop(task.taskId, 'cancelled')
    f.tasks.stop(task.taskId, 'paused')
    f.tasks.finishOperation('write', 'extension-a')
    expect(task.status).toBe('cancelled')
    expect(() => f.tasks.resume(task.taskId, 'caller-a', 0, session)).toThrow('begin a new task')
    const next = f.begin()
    expect(next.taskId).not.toBe(task.taskId)
    f.call('new-write', next.taskId)
    expect(next.operation).toBe('writing')
  })

  it('drains executing work before takeover and ignores results from another extension', () => {
    const f = fixture()
    const task = f.begin()
    f.call('write', task.taskId)
    f.tasks.stop(task.taskId, 'cancelled')
    f.tasks.stop(task.taskId, 'completed')
    f.advance(1000)
    f.tasks.sweep()
    expect(task.status).toBe('stopping')
    f.tasks.finishOperation('write', 'wrong-extension')
    expect(() => f.begin('caller-b')).toThrow('not finished')
    f.tasks.finishOperation('write', 'extension-a')
    expect(task.status).toBe('cancelled')
    const replacement = f.begin('caller-b')
    f.tasks.finishOperation('write', 'extension-a')
    expect(replacement.status).toBe('active')
    expect(() => f.begin('caller-c')).toThrow('occupied')
  })

  it('releases a disconnected owner without requiring that thread to return', () => {
    const f = fixture()
    const task = f.begin()
    f.tasks.disconnectOwner('unrelated')
    expect(task.status).toBe('active')
    f.tasks.disconnectOwner('caller-a')
    expect(task.status).toBe('paused')
    expect(f.begin('caller-b').status).toBe('active')
  })

  it('keeps uncertain execution fenced until its browser proves the runtime idle or gone', () => {
    const f = fixture()
    const task = f.begin()
    f.call('write', task.taskId)
    f.tasks.disconnectExtension('extension-a')
    f.tasks.reconcileSessions('other-browser', [])
    f.tasks.reconcileSessions('browser-a', [{ ...session, busy: true }])
    expect(() => f.begin('caller-b')).toThrow('not finished')
    f.tasks.reconcileSessions('browser-a', [session])
    expect(task.status).toBe('interrupted')
    const second = f.begin()
    f.call('write-2', second.taskId, true, { ...session, tabId: 1, documentId: 'document-a' })
    f.tasks.uncertain('write-2', 'wrong-extension')
    f.tasks.reconcileSessions('browser-a', [])
    expect(() => f.begin('caller-b')).toThrow('not finished')
    f.tasks.uncertain('write-2', 'extension-a')
    f.tasks.stop(second.taskId, 'interrupted')
    f.tasks.reconcileSessions('browser-a', [])
    expect(() => f.begin('caller-b')).toThrow('not finished')
    f.tasks.reconcileSessions('browser-a', [], [])
    expect(f.begin('caller-b').status).toBe('active')
  })

  it('accepts a proven new document in the executing tab as recovery evidence', () => {
    const f = fixture()
    const task = f.begin()
    f.call('write', task.taskId, true, { ...session, tabId: 1, documentId: 'old-document' })
    f.tasks.disconnectExtension('extension-a')
    const reloaded = { ...session, sessionId: 'reloaded-tab', tabId: 1, documentId: 'new-document' }
    f.tasks.reconcileSessions('other-browser', [reloaded], [1])
    expect(() => f.begin('caller-b')).toThrow('not finished')
    f.tasks.reconcileSessions('browser-a', [reloaded], [1])
    expect(task.status).toBe('interrupted')
    expect(f.begin('caller-b', reloaded).status).toBe('active')
  })

  it('retains review identities until Done regardless of lease expiry or newer task count', () => {
    const f = fixture()
    const task = f.begin()
    f.tasks.stop(task.taskId, 'completed')
    f.tasks.updatePage(task.taskId, 'ignored')
    f.tasks.updatePage('unknown', 'ignored')
    expect(f.tasks.stop('unknown', 'cancelled')).toBeUndefined()
    f.advance(60 * 60_000)
    expect(f.tasks.find(task.taskId)?.task).toBe(task)
    expect(f.tasks.retry('caller-a', 'begin-1')?.task).toBe(task)
    for (let index = 0; index < 260; index++) {
      const next = f.begin()
      f.tasks.stop(next.taskId, 'completed')
    }
    expect(f.tasks.list()).toHaveLength(261)
  })
})
