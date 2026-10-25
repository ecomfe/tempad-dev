import type { ClientHook } from '@tempad-dev/shared'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentClients } from '../src/agent-clients/registry'
import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function fixture(turnId: string | null = 'turn-a') {
  const directory = mkdtempSync(join(tmpdir(), 'tp-stop-notice-'))
  const store = new DesignTaskStore(join(directory, 'tasks.json'))
  let id = 0
  let tasks = new DesignTasks({
    createId: () => (++id === 1 ? 'task' : `task-${id}`),
    now: () => 1000,
    store
  })
  let clients = new AgentClients(tasks)
  cleanups.push(() => {
    clients.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const input = (
    event: ClientHook['event'],
    extra: Partial<Extract<ClientHook, { version: 2 }>> = {}
  ): ClientHook => ({
    version: 2,
    profile: { kind: 'release' },
    issuedAt: 1000,
    kind: 'claude',
    sessionId: 'claude-session',
    ...(turnId ? { turnId } : {}),
    event,
    invocationId: randomUUID(),
    ...extra
  })
  const hook = (event: ClientHook) =>
    tasks.applyHook(event.invocationId, event, () => clients.clientHook(event))
  const connect = (sessionId?: string) =>
    clients.event('connection', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'claude', ...(sessionId ? { sessionId } : {}) }
    })
  const owner = () => clients.owner('connection', undefined, { name: 'claude-code' })
  connect()
  hook(input('UserPromptSubmit'))
  const initialOwner = await owner()
  const session = {
    sessionId: 'figma',
    fileKey: 'file',
    fileName: 'Fixture',
    pageId: 'page',
    busy: false
  }
  tasks.begin(initialOwner, 'extension', session, 'Stop probe', 'begin')
  tasks.confirm('task', initialOwner)
  hook(input('PostToolUse', { taskId: 'task' }))
  await owner()
  return {
    get tasks() {
      return tasks
    },
    get clients() {
      return clients
    },
    store,
    input,
    hook,
    owner,
    session,
    stop: () =>
      clients.action({
        requestId: randomUUID(),
        taskId: 'task',
        epoch: tasks.find('task')!.task.epoch!,
        action: 'stop'
      }),
    restart: async () => {
      clients.close()
      tasks = new DesignTasks({ createId: () => 'unused', now: () => 1000, store })
      tasks.restore()
      clients = new AgentClients(tasks)
      connect('claude-session')
      await owner()
    }
  }
}

describe('durable Claude Stop notices', () => {
  it.each([false, true])(
    'keeps cancellation and notice in one snapshot while executing=%s',
    async (executing) => {
      const f = await fixture()
      if (executing)
        f.tasks.startOperation(
          'write',
          await f.owner(),
          'extension',
          'browser',
          f.session,
          'task',
          true
        )
      const save = vi.spyOn(f.store, 'save')
      expect(await f.stop()).toMatchObject({ status: 'delivered' })
      for (const [snapshot] of save.mock.calls) {
        const record = snapshot.records.find(({ task }) => task.taskId === 'task')!
        expect(record.claudeStopNotice).toEqual({ sessionId: 'claude-session', turnId: 'turn-a' })
        expect(record.task.status).toBe(executing ? 'stopping' : 'cancelled')
      }
      expect(save).toHaveBeenCalled()
      await f.restart()
      expect(f.tasks.find('task')?.task.status).toBe('cancelled')
      expect(f.clients.hasLegacyHooks).toBe(true)
      expect(f.hook(f.input('PreToolUse'))).toMatchObject({
        output: { hookSpecificOutput: { additionalContext: expect.stringContaining('task task.') } }
      })
      await f.owner()
      expect(f.clients.hasLegacyHooks).toBe(false)
      expect(f.tasks.find('task')?.task.status).toBe('cancelled')
    }
  )

  it.each([true, false])(
    'deduplicates the consumed notice across another restart with turn ID=%s',
    async (withTurn) => {
      const f = await fixture(withTurn ? 'turn-a' : null)
      await f.stop()
      await f.restart()
      const event = f.input('PostToolUse')
      const result = f.hook(event)
      expect(result).toMatchObject({
        output: { hookSpecificOutput: { additionalContext: expect.stringContaining('task task.') } }
      })
      const saved = f.store.load()!
      expect(saved.records[0]?.claudeStopNotice).toBeUndefined()
      expect(
        saved.hookReceipts?.find(({ invocationId }) => invocationId === event.invocationId)?.result
      ).toEqual(result)
      await f.restart()
      expect(f.hook(event)).toEqual(result)
      expect(f.hook(f.input('PreToolUse'))).toEqual({})
      expect(f.tasks.find('task')?.task.status).toBe('cancelled')
    }
  )

  it('does not consume or adopt a stale session/turn before the correct fresh hook', async () => {
    const f = await fixture()
    await f.stop()
    await f.restart()
    expect(f.hook(f.input('PreToolUse', { sessionId: 'different-session' }))).toEqual({})
    expect(f.hook(f.input('PreToolUse', { turnId: 'old-turn' }))).toEqual({})
    expect(f.clients.hasLegacyHooks).toBe(true)
    expect(f.store.load()?.records[0]?.claudeStopNotice).toBeDefined()
    expect(f.hook(f.input('PreToolUse'))).toMatchObject({ output: expect.any(Object) })
  })

  it.each([false, true])(
    'keeps the original owner after a stale SessionEnd with restart=%s',
    async (restart) => {
      const f = await fixture()
      const originalOwner = await f.owner()
      if (restart) {
        await f.stop()
        await f.restart()
      }
      const published = vi.fn()
      f.clients.subscribeBinding('connection', published)
      expect(f.hook(f.input('SessionEnd', { turnId: 'old-turn' }))).toEqual({})
      expect(published).not.toHaveBeenCalled()
      expect(f.tasks.find('task')?.task.status).toBe(restart ? 'cancelled' : 'active')
      expect(f.hook(f.input('PreToolUse'))).toEqual(restart ? { output: expect.any(Object) } : {})
      const owner = await f.owner()
      expect(owner).toBe(originalOwner)
      expect(() => f.tasks.owned('task', owner)).not.toThrow()

      expect(f.hook(f.input('SessionEnd'))).toEqual({})
      expect(published).toHaveBeenCalledWith({ kind: 'claude' })
      expect(await f.owner()).not.toBe(originalOwner)
    }
  )

  it('keeps legacy hooks silent while rejecting stale lifecycle and task binding effects', async () => {
    const f = await fixture()
    const owner = await f.owner()
    const hook = (event: ClientHook['event'], turnId: string, taskId?: string) =>
      f.clients.clientHook({
        version: 1,
        kind: 'claude',
        sessionId: 'claude-session',
        turnId,
        event,
        invocationId: randomUUID(),
        ...(taskId ? { taskId } : {})
      })
    const published = vi.fn()
    f.clients.subscribeBinding('connection', published)
    expect(hook('PostToolUse', 'old-turn', 'task')).toEqual({})
    expect(hook('SessionEnd', 'old-turn')).toEqual({})
    expect(published).not.toHaveBeenCalled()
    expect(await f.owner()).toBe(owner)
    expect(f.tasks.find('task')?.task.status).toBe('active')
    expect(hook('PreToolUse', 'turn-a')).toEqual({})
    expect(hook('SessionEnd', 'turn-a')).toEqual({})
    expect(published).toHaveBeenCalledWith({ kind: 'claude' })
    expect(f.tasks.find('task')?.task.status).toBe('paused')
  })

  it('does not replace the authoritative turn through a stale task-bound hook', async () => {
    const f = await fixture()
    await f.stop()
    expect(f.hook(f.input('PostToolUse', { taskId: 'task', turnId: 'old-turn' }))).toEqual({})
    const owner = await f.owner()
    const description = await f.clients.describe(owner)
    const next = f.tasks.begin(
      owner,
      'extension',
      f.session,
      'Explicit next probe',
      'next',
      description.client
    )
    f.tasks.confirm(next.task.taskId, owner)
    await f.clients.action({
      requestId: randomUUID(),
      taskId: next.task.taskId,
      epoch: 0,
      action: 'stop'
    })
    expect(
      f.store.load()?.records.find(({ task }) => task.taskId === next.task.taskId)?.claudeStopNotice
    ).toEqual({
      sessionId: 'claude-session',
      turnId: 'turn-a'
    })
  })

  it.each(['UserPromptSubmit', 'Stop', 'SessionEnd', 'Interrupt'] as const)(
    'retires a pending notice on %s even without a turn ID',
    async (event) => {
      const f = await fixture()
      await f.stop()
      await f.restart()
      expect(f.hook(f.input(event, { turnId: undefined }))).toEqual({})
      expect(f.store.load()?.records[0]?.claudeStopNotice).toBeUndefined()
      await f.restart()
      expect(f.hook(f.input('PreToolUse', { turnId: undefined }))).toEqual({})
    }
  )

  it('does not invent a notice from an ordinary cancelled task or restore old active capability', async () => {
    const f = await fixture()
    f.tasks.stop('task', 'cancelled')
    await f.restart()
    expect(f.clients.hasLegacyHooks).toBe(true)
    expect(f.hook(f.input('PreToolUse'))).toEqual({})
    expect(f.tasks.find('task')?.task.status).toBe('cancelled')
  })

  it('retries failed notice persistence using its original durable receipt', async () => {
    const f = await fixture()
    await f.stop()
    await f.restart()
    const event = f.input('PreToolUse')
    vi.spyOn(f.store, 'save').mockImplementationOnce(() => {
      throw new Error('disk unavailable')
    })
    expect(() => f.hook(event)).toThrow('cannot be flushed')
    expect(f.store.load()?.records[0]?.claudeStopNotice).toBeDefined()
    const result = f.hook(event)
    expect(result).toMatchObject({ output: expect.any(Object) })
    expect(f.store.load()?.records[0]?.claudeStopNotice).toBeUndefined()
    await f.restart()
    expect(f.hook(event)).toEqual(result)
    expect(f.hook(f.input('PreToolUse'))).toEqual({})
  })
})
