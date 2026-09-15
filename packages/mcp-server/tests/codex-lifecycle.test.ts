import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAppLifecycle } from '../src/agent-clients/codex-lifecycle'
import { AgentClients } from '../src/agent-clients/registry'
import { DesignTasks } from '../src/design-tasks'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
  vi.useRealTimers()
})

async function fixture() {
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  const disconnects = new Set<() => void>()
  const request = vi.fn().mockResolvedValue({
    handledByClientId: 'owner',
    result: { ok: true, interruptedTurnId: 'turn-a' }
  })
  const connection = {
    owner: vi.fn().mockResolvedValue('owner'),
    request,
    broadcast: vi.fn(),
    close: vi.fn(),
    onBroadcast: (listener: (message: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onDisconnect: (listener: () => void) => {
      disconnects.add(listener)
      return () => {
        disconnects.delete(listener)
      }
    }
  }
  const open = vi.fn().mockResolvedValue(connection)
  const changed = vi.fn()
  const lifecycle = new CodexAppLifecycle(changed, open, 10, 50)
  cleanups.push(() => lifecycle.close())
  lifecycle.watch('thread-a')
  await vi.waitFor(() => expect(connection.broadcast).toHaveBeenCalled())
  const emit = (change: unknown, extra: Record<string, unknown> = {}) => {
    for (const listener of listeners)
      listener({
        method: 'thread-stream-state-changed',
        version: 11,
        sourceClientId: 'owner',
        params: { hostId: 'local', conversationId: 'thread-a', change },
        ...extra
      })
  }
  const snapshot = (revision = 1, status = 'inProgress') =>
    emit({
      type: 'snapshot',
      revision,
      conversationState: {
        id: 'thread-a',
        turns: [],
        turnHistory: {
          kind: 'canonical',
          history: {
            entitiesByKey: {
              entity: { turnId: 'turn-a', status, items: [{ text: 'Private conversation text' }] }
            }
          }
        }
      }
    })
  return { lifecycle, changed, open, connection, emit, snapshot, disconnects }
}

describe('Codex native lifecycle', () => {
  it('follows the exact owner and retains only lifecycle fields from canonical history', async () => {
    const f = await fixture()
    expect(f.connection.broadcast).toHaveBeenCalledWith(
      'thread-stream-following-changed',
      1,
      { hostId: 'local', conversationId: 'thread-a', following: true },
      ['owner']
    )
    f.snapshot()
    expect(f.lifecycle.state('thread-a')).toEqual({
      turns: [{ turnId: 'turn-a', status: 'inProgress' }]
    })
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain('Private')
    f.lifecycle.watch('thread-a')
    expect(f.open).toHaveBeenCalledOnce()
    f.lifecycle.retain(new Set())
    await vi.waitFor(() => expect(f.connection.close).toHaveBeenCalled())
    expect(f.connection.broadcast).toHaveBeenLastCalledWith(
      'thread-stream-following-changed',
      1,
      { hostId: 'local', conversationId: 'thread-a', following: false },
      ['owner']
    )
  })

  it('ignores other owners, conversations and hosts', async () => {
    const f = await fixture()
    f.snapshot()
    f.changed.mockClear()
    const change = {
      type: 'snapshot',
      revision: 2,
      conversationState: { id: 'thread-a', turns: [] }
    }
    f.emit(change, { sourceClientId: 'other' })
    f.emit(change, { params: { hostId: 'remote', conversationId: 'thread-a', change } })
    f.emit(change, { params: { hostId: 'local', conversationId: 'thread-b', change } })
    expect(f.changed).not.toHaveBeenCalled()
  })

  it('applies lifecycle deltas without snapshots and resynchronizes only on revision gaps', async () => {
    const f = await fixture()
    f.snapshot()
    f.emit({
      type: 'patches',
      revision: 2,
      baseRevision: 1,
      patches: [
        {
          path: ['turnHistory', 'history', 'entitiesByKey', 'entity', 'items', 0],
          op: 'add',
          value: {}
        }
      ]
    })
    expect(f.connection.broadcast).toHaveBeenCalledOnce()
    f.emit({
      type: 'patches',
      revision: 3,
      baseRevision: 2,
      patches: [
        {
          path: ['turnHistory', 'history', 'entitiesByKey', 'entity', 'status'],
          op: 'replace',
          value: 'completed'
        }
      ]
    })
    expect(f.lifecycle.state('thread-a')?.turns[0]?.status).toBe('completed')
    expect(f.connection.broadcast).toHaveBeenCalledOnce()
    f.emit({ type: 'patches', revision: 4, baseRevision: 3, patches: [] })
    expect(f.connection.broadcast).toHaveBeenCalledOnce()
    expect(f.lifecycle.state('thread-a')?.turns[0]?.status).toBe('completed')
    f.snapshot(2)
    expect(f.lifecycle.state('thread-a')?.turns[0]?.status).toBe('completed')
    f.emit({ type: 'patches', revision: 6, baseRevision: 5, patches: [] })
    expect(f.lifecycle.state('thread-a')).toBeUndefined()
    expect(f.connection.broadcast).toHaveBeenCalledTimes(2)
    f.emit({ type: 'patches', revision: 7, baseRevision: 6, patches: [] })
    expect(f.connection.broadcast).toHaveBeenCalledTimes(2)
    f.snapshot(7, 'completed')
    expect(f.lifecycle.state('thread-a')?.turns[0]?.status).toBe('completed')
  })

  it('applies legacy turn additions and history container replacements without refetching', async () => {
    const f = await fixture()
    f.emit({
      type: 'snapshot',
      revision: 1,
      conversationState: { id: 'thread-a', turns: [{ turnId: 'old', status: 'failed' }] }
    })
    expect(f.lifecycle.state('thread-a')).toEqual({ turns: [{ turnId: 'old', status: 'failed' }] })
    f.emit({
      type: 'patches',
      baseRevision: 1,
      revision: 2,
      patches: [{ op: 'add', path: ['turns', 1], value: { turnId: 'new', status: 'inProgress' } }]
    })
    expect(f.lifecycle.state('thread-a')?.turns).toEqual([
      { turnId: 'old', status: 'failed' },
      { turnId: 'new', status: 'inProgress' }
    ])
    f.emit({
      type: 'patches',
      baseRevision: 2,
      revision: 3,
      patches: [
        {
          op: 'replace',
          path: ['turnHistory'],
          value: {
            kind: 'canonical',
            history: { entitiesByKey: { key: { turnId: 'new', status: 'completed' } } }
          }
        }
      ]
    })
    expect(f.lifecycle.state('thread-a')?.turns).toEqual([{ turnId: 'new', status: 'completed' }])
    expect(f.connection.broadcast).toHaveBeenCalledOnce()
  })

  it('never publishes a partial lifecycle batch and requests only one recovery snapshot', async () => {
    const f = await fixture()
    f.snapshot()
    f.changed.mockClear()
    f.emit({
      type: 'patches',
      baseRevision: 1,
      revision: 2,
      patches: [
        {
          op: 'replace',
          path: ['turnHistory', 'history', 'entitiesByKey', 'entity', 'status'],
          value: 'completed'
        },
        {
          op: 'replace',
          path: ['turnHistory', 'history', 'entitiesByKey', 'missing', 'status'],
          value: 'inProgress'
        }
      ]
    })
    expect(f.changed.mock.calls).toEqual([['thread-a', undefined]])
    expect(f.connection.broadcast).toHaveBeenCalledTimes(2)
    f.emit({ type: 'patches', baseRevision: 2, revision: 3, patches: [] })
    expect(f.connection.broadcast).toHaveBeenCalledTimes(2)
    f.snapshot(3)
    expect(f.lifecycle.state('thread-a')?.turns[0]?.status).toBe('inProgress')
  })

  it.each(['disconnect', 'version', 'timeout'] as const)(
    'rediscovers after %s without treating it as completion',
    async (reason) => {
      const f = await fixture()
      f.snapshot()
      if (reason === 'disconnect') for (const listener of f.disconnects) listener()
      else if (reason === 'version') f.emit({}, { version: 999 })
      else f.emit({ type: 'patches', baseRevision: 99, revision: 100, patches: [] })
      await vi.waitFor(() => expect(f.open.mock.calls.length).toBeGreaterThan(1))
      expect(f.lifecycle.state('thread-a')).toBeUndefined()
      f.snapshot(1)
      expect(f.lifecycle.state('thread-a')?.turns[0]?.status).toBe('inProgress')
      expect(
        f.changed.mock.calls.every(([, state]) => !state || state.turns[0].status === 'inProgress')
      ).toBe(true)
    }
  )

  it('interrupts only the expected turn through its current owner and validates acknowledgement', async () => {
    const f = await fixture()
    f.snapshot()
    expect(await f.lifecycle.interrupt('thread-a', 'turn-a')).toBe(true)
    expect(f.connection.request).toHaveBeenCalledWith(
      'thread-follower-interrupt-turn',
      4,
      { conversationId: 'thread-a', mode: 'user-stop', expectedTurnId: 'turn-a' },
      'owner'
    )
    f.connection.request.mockResolvedValueOnce({
      handledByClientId: 'owner',
      result: { ok: true, interruptedTurnId: null }
    })
    expect(await f.lifecycle.interrupt('thread-a', 'old-turn')).toBe(false)
    f.connection.request.mockResolvedValueOnce({
      handledByClientId: 'owner',
      result: { ok: true, interruptedTurnId: 'another-turn' }
    })
    await expect(f.lifecycle.interrupt('thread-a', 'turn-a')).rejects.toThrow('did not confirm')
  })
})

describe('hook-free task lifecycle', () => {
  async function taskFixture() {
    let changed!: ConstructorParameters<typeof CodexAppLifecycle>[0]
    const native = {
      watch: vi.fn(),
      state: vi.fn(),
      retain: vi.fn(),
      interrupt: vi.fn().mockResolvedValue(true),
      close: vi.fn()
    }
    let taskCount = 0
    const tasks = new DesignTasks({
      createId: () => `task-${taskCount++ === 0 ? 'a' : 'b'}`,
      now: () => 1000
    })
    const clients = new AgentClients(tasks, undefined, (callback) => {
      changed = callback
      return native
    })
    cleanups.push(() => clients.close())
    const owner = await clients.owner('transport', {
      'x-codex-turn-metadata': { thread_id: 'thread-a', turn_id: 'turn-a' }
    })
    const session = {
      sessionId: 'figma',
      fileKey: 'file',
      fileName: 'File',
      pageId: 'page',
      busy: false
    }
    const record = tasks.begin(
      owner,
      'extension',
      session,
      'Review',
      'begin',
      (await clients.describe(owner)).client
    )
    tasks.confirm(record.task.taskId, owner)
    const update = (turns: { turnId: string; status: string }[], id = 'thread-a') =>
      changed(id, { turns })
    return { native, tasks, clients, owner, record, session, update }
  }

  it('binds through MCP metadata, ignores old hooks, and pauses only the matching finished turn', async () => {
    const f = await taskFixture()
    expect(f.native.watch).toHaveBeenCalledWith('thread-a')
    f.clients.clientHook({
      version: 1,
      kind: 'codex',
      sessionId: 'thread-a',
      turnId: 'turn-a',
      event: 'Stop',
      invocationId: '00000000-0000-4000-8000-000000000001'
    })
    expect(f.record.task.status).toBe('active')
    f.update([{ turnId: 'turn-a', status: 'completed' }], 'another-thread')
    f.update([{ turnId: 'old-turn', status: 'completed' }])
    expect(f.record.task.status).toBe('active')
    f.update([{ turnId: 'turn-a', status: 'completed' }])
    expect(f.record.task.status).toBe('paused')
  })

  it.each([true, false])(
    'cancels locally before native Stop settles, including host success=%s',
    async (success) => {
      const f = await taskFixture()
      let settle!: () => void
      f.native.interrupt.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settle = () => (success ? resolve(true) : reject(new Error('Disconnected')))
          })
      )
      const pending = f.clients.action({
        requestId: 'stop',
        taskId: 'task-a',
        epoch: 0,
        action: 'stop'
      })
      expect(f.record.task.status).toBe('cancelled')
      expect(f.native.interrupt).toHaveBeenCalledWith('thread-a', 'turn-a')
      settle()
      const result = await pending
      expect(result.status).toBe('delivered')
      if (!success) expect(result.message).toContain('could not be confirmed')
      expect(() => f.tasks.resume('task-a', f.owner, 0, f.session)).toThrow('begin a new task')
    }
  )

  it('pauses the old lease at a turn boundary and tracks the next turn for Stop', async () => {
    const f = await taskFixture()
    f.update([
      { turnId: 'turn-a', status: 'completed' },
      { turnId: 'turn-b', status: 'inProgress' }
    ])
    expect(f.record.task.status).toBe('paused')
    await f.clients.action({ requestId: 'stop', taskId: 'task-a', epoch: 0, action: 'stop' })
    expect(f.native.interrupt).toHaveBeenCalledWith('thread-a', 'turn-b')
  })

  it('pauses every lease from the finished turn before advancing their shared conversation binding', async () => {
    const f = await taskFixture()
    f.tasks.stop('task-a', 'completed')
    const next = f.tasks.begin(f.owner, 'extension', f.session, 'Next design', 'begin-b')
    f.tasks.confirm(next.task.taskId, f.owner)
    f.update([
      { turnId: 'turn-a', status: 'completed' },
      { turnId: 'turn-b', status: 'inProgress' }
    ])
    expect(f.record.task.status).toBe('completed')
    expect(next.task.status).toBe('paused')
  })

  it('does not pause a resumed lease for an earlier turn after fresh MCP metadata binds the new turn', async () => {
    const f = await taskFixture()
    f.update([{ turnId: 'turn-a', status: 'completed' }])
    await f.clients.owner('transport', {
      'x-codex-turn-metadata': { thread_id: 'thread-a', turn_id: 'turn-b' }
    })
    f.tasks.resume('task-a', f.owner, 0, f.session)
    f.tasks.confirm('task-a', f.owner)
    f.update([
      { turnId: 'turn-a', status: 'completed' },
      { turnId: 'turn-b', status: 'inProgress' }
    ])
    expect(f.record.task.status).toBe('active')
    f.update([
      { turnId: 'turn-a', status: 'completed' },
      { turnId: 'turn-b', status: 'interrupted' }
    ])
    expect(f.record.task.status).toBe('paused')
  })
})
