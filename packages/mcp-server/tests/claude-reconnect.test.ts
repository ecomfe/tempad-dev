import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { DesignTaskSnapshot } from '../src/design-task-store'

import { AgentClients } from '../src/agent-clients/registry'
import { DesignTasks } from '../src/design-tasks'

const session = {
  sessionId: 'figma-a',
  fileKey: 'file-a',
  fileName: 'Product',
  pageId: 'page-a',
  busy: false
}
const connect = (clients: AgentClients, id: string, sessionId?: string) =>
  clients.event(id, {
    method: 'notifications/tempad/client-event',
    params: { event: 'connect', kind: 'claude', sessionId }
  })
const hook = (
  clients: AgentClients,
  event: 'PreToolUse' | 'SessionEnd' | 'PostToolUse',
  sessionId: string,
  taskId?: string
) =>
  clients.clientHook({
    version: 1,
    kind: 'claude',
    event,
    sessionId,
    taskId,
    invocationId: randomUUID()
  })

async function fixture() {
  let id = 0
  let snapshot: DesignTaskSnapshot | undefined
  const options = {
    createId: () => `task-${++id}`,
    now: () => 1000,
    store: {
      load: () => structuredClone(snapshot),
      save: (value: DesignTaskSnapshot) => {
        snapshot = structuredClone(value)
      }
    }
  }
  const tasks = new DesignTasks(options)
  const old = new AgentClients(tasks)
  connect(old, 'original')
  const owner = await old.owner('original', undefined, { name: 'claude-code' })
  const task = tasks.begin(owner, 'extension', session, 'Before restart', 'request-a', {
    kind: 'claude',
    name: 'Claude Code'
  })
  hook(old, 'PostToolUse', 'session-a', task.task.taskId)
  old.disconnect('original')
  const restored = new DesignTasks(options)
  restored.restore()
  return {
    tasks: restored,
    task: restored.find(task.task.taskId)!,
    clients: new AgentClients(restored)
  }
}

describe('Claude transport reconnection', () => {
  it.each([
    ['session-a', 'claude-code', true],
    ['session-b', 'claude-code', false],
    [undefined, 'claude-code', false],
    ['session-a', 'codex-app', false]
  ] as const)(
    'requires a matching birth hint %s, Claude handshake %s and fresh hook',
    async (hint, name, allowed) => {
      const { tasks, task, clients } = await fixture()
      clients.event('new-cli', {
        method: 'notifications/tempad/client-event',
        params: { event: 'connect', kind: 'codex-app', sessionId: 'inherited-parent' }
      })
      const update = vi.fn()
      clients.subscribeBinding('new-cli', update, hint)
      const before = await clients.owner('new-cli', undefined, { name })
      expect(() => tasks.owned(task.task.taskId, before)).toThrow('another MCP caller')
      hook(clients, 'PreToolUse', 'session-a')
      const after = await clients.owner('new-cli', undefined, { name })
      if (allowed) {
        expect(tasks.owned(task.task.taskId, after).task.client?.sessionId).toBe('session-a')
        expect(update).toHaveBeenCalledWith({ kind: 'claude', sessionId: 'session-a' })
      } else {
        expect(() => tasks.owned(task.task.taskId, after)).toThrow('another MCP caller')
        expect(update).not.toHaveBeenCalled()
      }
    }
  )

  it('revokes a birth hint on clear even before the first tool request', async () => {
    const { tasks, task, clients } = await fixture()
    connect(clients, 'new-cli')
    const update = vi.fn()
    clients.subscribeBinding('new-cli', update, 'session-a')
    hook(clients, 'PreToolUse', 'session-a')
    hook(clients, 'SessionEnd', 'session-a')
    expect(update).toHaveBeenCalledExactlyOnceWith({ clearSessionHint: true })
    hook(clients, 'PreToolUse', 'session-a')
    const owner = await clients.owner('new-cli', undefined, { name: 'claude-code' })
    expect(() => tasks.owned(task.task.taskId, owner)).toThrow('another MCP caller')
  })

  it('publishes only the original connection binding and clears only its current session', async () => {
    const tasks = new DesignTasks({ createId: () => 'task-a', now: () => 1000 })
    const clients = new AgentClients(tasks)
    connect(clients, 'original')
    const own = vi.fn(),
      other = vi.fn()
    clients.subscribeBinding('original', own)
    clients.subscribeBinding('other', other)
    const owner = await clients.owner('original', undefined, { name: 'claude-code' })
    tasks.begin(owner, 'extension', session, 'Task', 'request-a', {
      kind: 'claude',
      name: 'Claude Code'
    })
    hook(clients, 'PostToolUse', 'session-a', 'task-a')
    expect(own).toHaveBeenCalledExactlyOnceWith({ kind: 'claude', sessionId: 'session-a' })
    expect(other).not.toHaveBeenCalled()
    hook(clients, 'SessionEnd', 'different-session')
    expect(own).toHaveBeenCalledTimes(1)
    hook(clients, 'SessionEnd', 'session-a')
    expect(own).toHaveBeenLastCalledWith({ kind: 'claude' })
    clients.disconnect('original')
    hook(clients, 'SessionEnd', 'session-a')
    expect(own).toHaveBeenCalledTimes(2)
  })

  it('requires an exact fresh hook before reclaiming a cached session and keeps Stop fenced', async () => {
    const { tasks, task, clients } = await fixture()
    connect(clients, 'reconnected', 'session-a')
    const unverified = await clients.owner('reconnected', undefined)
    expect(() => tasks.owned(task.task.taskId, unverified)).toThrow('another MCP caller')
    hook(clients, 'PreToolUse', 'session-b')
    const unrelated = await clients.owner('reconnected', undefined)
    expect(() => tasks.owned(task.task.taskId, unrelated)).toThrow('another MCP caller')
    hook(clients, 'PreToolUse', 'session-a')
    const verified = await clients.owner('reconnected', undefined)
    expect(tasks.owned(task.task.taskId, verified).task.client?.sessionId).toBe('session-a')
    expect(task.task).toMatchObject({ status: 'paused', epoch: 1, needsRead: true })
    expect(task.ready).toBe(false)
    expect(() => tasks.assertEpoch(task.task.taskId, verified, 0)).toThrow('Stale task lease')
    tasks.stop(task.task.taskId, 'cancelled')
    expect(() => tasks.resume(task.task.taskId, verified, 1, session)).toThrow('cannot resume')
  })

  it('does not revive the cached session after an offline clear and can bind a fresh task', async () => {
    const { tasks, task, clients } = await fixture()
    connect(clients, 'reconnected', 'session-a')
    hook(clients, 'PreToolUse', 'session-b')
    const owner = await clients.owner('reconnected', undefined)
    const description = await clients.describe(owner)
    expect(description.client).toMatchObject({ kind: 'claude' })
    expect(description.client.sessionId).toBeUndefined()
    expect(() => tasks.owned(task.task.taskId, owner)).toThrow('another MCP caller')
    const fresh = tasks.begin(
      owner,
      'extension',
      session,
      'After clear',
      'request-b',
      description.client
    )
    hook(clients, 'PostToolUse', 'session-b', fresh.task.taskId)
    const bound = await clients.owner('reconnected', undefined)
    expect(tasks.owned(fresh.task.taskId, bound).task.client?.sessionId).toBe('session-b')
    hook(clients, 'PreToolUse', 'session-a')
    expect(await clients.owner('reconnected', undefined)).toBe(bound)
  })
})
