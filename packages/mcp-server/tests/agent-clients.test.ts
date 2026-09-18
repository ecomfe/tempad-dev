import type { DesignAction, DesignFeedback } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import type { ClientHook } from '../src/agent-clients/hooks'

import {
  bindRequestMetadata,
  ClientEventSchema,
  runtimeIdentity
} from '../src/agent-clients/identity'
import { AgentClients } from '../src/agent-clients/registry'
import { CANVAS_ONLY, CODEX_FEEDBACK_UNAVAILABLE } from '../src/agent-clients/types'
import { DesignTasks } from '../src/design-tasks'

const session = {
  sessionId: 'figma-a',
  fileKey: 'file-a',
  fileName: 'Product',
  pageId: 'page-a',
  busy: false
}
const feedback: DesignFeedback = {
  id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
  mode: 'queue',
  fileKey: 'file-a',
  items: [
    {
      nodeId: '1:2',
      nodeName: 'Heading',
      pageId: 'page-a',
      text: 'Increase spacing',
      createdAt: 1000
    },
    { nodeId: '2:3', nodeName: 'Button', pageId: 'page-b', text: 'Use more space', createdAt: 1001 }
  ],
  createdAt: 1000
}

async function fixture(connected = true) {
  let id = 0
  const tasks = new DesignTasks({ createId: () => `task-${++id}`, now: () => 1000 })
  const clients = new AgentClients(tasks)

  let invocation = 0
  const hook = (event: ClientHook['event'], turnId = 'turn-a') =>
    clients.clientHook({
      version: 1,
      kind: 'codex',
      sessionId: 'thread-a',
      turnId,
      event,
      invocationId: `00000000-0000-4000-8000-${String(++invocation).padStart(12, '0')}`
    })
  if (connected) hook('UserPromptSubmit')
  clients.event('connection-a', {
    method: 'notifications/tempad/client-event',
    params: {
      event: 'connect',
      kind: 'codex-app'
    }
  })
  const owner = await clients.owner('connection-a', {
    'x-codex-turn-metadata': { thread_id: 'thread-a', turn_id: 'turn-a' }
  })
  const description = await clients.describe(owner)
  const record = tasks.begin(
    owner,
    'extension-a',
    session,
    'Settings',
    'request-a',
    description.client,
    description.capabilities
  )
  tasks.confirm(record.task.taskId, owner)
  const action = (value: Partial<DesignAction> = {}): DesignAction => ({
    requestId: feedback.id,
    taskId: record.task.taskId,
    epoch: 0,
    action: 'feedback',
    feedback,
    ...value
  })
  return { clients, tasks, owner, hook, record, action }
}

describe('client identity and capabilities', () => {
  it('binds a host session from the successful begin result without model-authored identity', async () => {
    const tasks = new DesignTasks({ createId: () => 'task-claude', now: () => 1000 })
    const clients = new AgentClients(tasks)
    const original = await clients.owner('claude-connection', undefined, {
      name: 'claude-code',
      title: 'Claude Code'
    })
    const record = tasks.begin(original, 'extension-a', session, 'Settings', 'request-a')
    tasks.confirm(record.task.taskId, original)
    clients.event('hook', {
      method: 'notifications/tempad/client-event',
      params: {
        event: 'taskBound',
        kind: 'claude',
        sessionId: 'claude-session',
        taskId: record.task.taskId
      }
    })
    expect(record.task.client?.name).toBe('Claude Code')
    const owner = await clients.owner('claude-connection', undefined, {
      name: 'claude-code',
      title: 'Claude Code'
    })
    expect(tasks.owned(record.task.taskId, owner).task.client).toEqual({
      kind: 'claude',
      name: 'Claude Code',
      sessionId: 'claude-session'
    })
    clients.event('hook', {
      method: 'notifications/tempad/client-event',
      params: {
        event: 'Stop',
        kind: 'claude',
        sessionId: 'claude-session'
      }
    })
    expect(record.task.status).toBe('paused')
  })

  it('uses MCP-reported display names without changing runtime identity or capabilities', async () => {
    const f = await fixture()
    const owner = await f.clients.owner(
      'connection-a',
      { 'x-codex-turn-metadata': { thread_id: 'thread-a' } },
      { name: 'codex-terminal', title: 'Codex Workspace' }
    )
    expect((await f.clients.describe(owner)).client).toEqual({
      kind: 'codex-app',
      name: 'Codex Workspace',
      sessionId: 'thread-a'
    })
    expect(f.record.task.client?.name).toBe('Codex Workspace')
    const other = await f.clients.owner('other-connection', undefined, { name: 'Custom Client' })
    expect(await f.clients.describe(other)).toEqual({
      client: { kind: 'other', name: 'Custom Client' },
      capabilities: CANVAS_ONLY
    })
    const wrapper = await f.clients.owner('wrapper-connection', undefined, {
      name: 'custom-claude-wrapper',
      title: 'Claude Code'
    })
    expect((await f.clients.describe(wrapper)).client).toEqual({
      kind: 'other',
      name: 'Claude Code'
    })
  })

  it('distinguishes application and CLI runtime evidence without granting controls', () => {
    expect(
      runtimeIdentity({ CODEX_APP_TOOLS_PIPE_PATH: '/private/pipe', CODEX_THREAD_ID: 'a' }).client
    ).toEqual({ kind: 'codex-app', name: 'Codex App', sessionId: 'a' })
    expect(runtimeIdentity({ CODEX_SESSION_ID: 'b' }).client.kind).toBe('codex-cli')
    expect(runtimeIdentity({}).client.kind).toBe('other')
    for (const kind of ['other', 'unknown'] as const) {
      expect(
        bindRequestMetadata(
          { client: { kind, name: 'Custom client' } },
          { 'x-codex-turn-metadata': { thread_id: 'thread-from-host', turn_id: 'turn-from-host' } }
        )
      ).toEqual({
        client: { kind: 'codex', name: 'Codex', sessionId: 'thread-from-host' },
        turnId: 'turn-from-host'
      })
    }
    const binding = runtimeIdentity({ CODEX_THREAD_ID: 'a' })
    expect(bindRequestMetadata(binding, { 'x-codex-turn-metadata': '{bad' })).toBe(binding)
    expect(
      bindRequestMetadata(binding, {
        'x-codex-turn-metadata': JSON.stringify({ thread_id: 'b', turn_id: 't' })
      }).client.sessionId
    ).toBe('b')
    const next = bindRequestMetadata(
      { ...binding, turnId: 'old-turn' },
      {
        'x-codex-turn-metadata': { thread_id: 'b' }
      }
    )
    expect(next.turnId).toBeUndefined()
  })

  it('does not accept a manually supplied native control endpoint', () => {
    expect(
      runtimeIdentity({ CODEX_THREAD_ID: 'a', TEMPAD_CODEX_APP_SERVER_URL: 'ws://127.0.0.1:1234' })
    ).toEqual({ client: { kind: 'codex-cli', name: 'Codex CLI', sessionId: 'a' } })
    expect(
      ClientEventSchema.safeParse({
        method: 'notifications/tempad/client-event',
        params: {
          event: 'connect',
          kind: 'codex-app',
          controlEndpoint: 'ws://127.0.0.1:1234'
        }
      }).success
    ).toBe(false)
  })

  it('keeps two conversations sharing an MCP transport separate', async () => {
    const f = await fixture()
    const other = await f.clients.owner('connection-a', {
      'x-codex-turn-metadata': { thread_id: 'thread-b' }
    })
    expect(() => f.tasks.owned(f.record.task.taskId, other)).toThrow('another MCP caller')
    expect(f.record.task.client?.sessionId).toBe('thread-a')
  })

  it('keeps local stop available without claiming reverse controls', async () => {
    const f = await fixture(false)
    expect(f.record.task.capabilities).toEqual(CODEX_FEEDBACK_UNAVAILABLE)
    expect((await f.clients.action(f.action({ action: 'stop', feedback: undefined }))).status).toBe(
      'delivered'
    )
    expect(f.record.task.status).toBe('cancelled')
  })
})

describe('bound client actions', () => {
  it.each(['queue', 'steer', 'continue'] as const)(
    'rejects %s comments without native delivery even when hooks are active',
    async (mode) => {
      const f = await fixture()
      const accepted = vi.fn()
      expect(
        await f.clients.action(f.action({ feedback: { ...feedback, mode } }), accepted)
      ).toMatchObject({
        status: 'failed',
        message: expect.stringContaining('never delivered through hooks')
      })
      expect(accepted).not.toHaveBeenCalled()
      for (const event of ['PreToolUse', 'PostToolUse', 'Stop'] as const)
        expect(f.hook(event)).toEqual({})
      expect((await f.clients.describe(f.owner)).capabilities.queue).toBe(false)
    }
  )

  it('rejects queued Steer promotion without injecting context through hooks', async () => {
    const f = await fixture()
    expect(
      await f.clients.action(
        f.action({
          action: 'steer',
          feedback: undefined,
          feedbackId: feedback.id
        })
      )
    ).toMatchObject({ status: 'failed', message: expect.stringContaining('not available') })
    expect(f.hook('PreToolUse')).toEqual({})
  })

  it.each(['claude', 'codex-cli', 'other'] as const)(
    'keeps %s comments unavailable even with active lifecycle hooks',
    async (kind) => {
      const tasks = new DesignTasks({ createId: () => 'task-a', now: () => 1000 })
      const clients = new AgentClients(tasks)
      clients.event('connection', {
        method: 'notifications/tempad/client-event',
        params: { event: 'connect', kind, sessionId: 'thread-a' }
      })
      const owner = await clients.owner('connection', undefined)
      clients.clientHook({
        version: 1,
        kind: kind === 'claude' ? 'claude' : 'codex',
        sessionId: 'thread-a',
        event: 'UserPromptSubmit',
        invocationId: '00000000-0000-4000-8000-000000000001'
      })
      const description = await clients.describe(owner)
      expect(description.capabilities).toEqual(CANVAS_ONLY)
      const record = tasks.begin(
        owner,
        'extension-a',
        session,
        'Settings',
        'request-a',
        description.client,
        description.capabilities
      )
      tasks.confirm(record.task.taskId, owner)
      expect(
        await clients.action({
          requestId: feedback.id,
          taskId: record.task.taskId,
          epoch: 0,
          action: 'feedback',
          feedback
        })
      ).toMatchObject({ status: 'failed' })
      expect(
        await clients.action({
          requestId: 'stop',
          taskId: record.task.taskId,
          epoch: 0,
          action: 'stop'
        })
      ).toMatchObject({ status: 'delivered' })
      expect(record.task.status).toBe('cancelled')
    }
  )

  it('gates writes immediately and drains an active transaction without host interruption', async () => {
    const f = await fixture()
    f.tasks.startOperation(
      'write',
      f.owner,
      'extension-a',
      'browser-a',
      session,
      f.record.task.taskId,
      true
    )
    const pending = f.clients.action(f.action({ action: 'stop', feedback: undefined }))
    expect(f.record.task.status).toBe('stopping')
    expect((await pending).status).toBe('delivered')
    f.tasks.finishOperation('write', 'extension-a')
    expect(f.record.task.status).toBe('cancelled')
    expect(() => f.tasks.resume(f.record.task.taskId, f.owner, 0, session)).toThrow(
      'begin a new task'
    )
  })

  it('does not stop a new task for a delayed Stop from the old task', async () => {
    const f = await fixture()
    f.tasks.stop(f.record.task.taskId, 'cancelled')
    const next = f.tasks.begin(f.owner, 'extension-a', session, 'New design', 'request-b')
    f.tasks.confirm(next.task.taskId, f.owner)
    const result = await f.clients.action(f.action({ action: 'stop', feedback: undefined }))
    expect(result.status).toBe('failed')
    expect(next.task.status).toBe('active')
  })

  it('accepts lifecycle events only for the bound conversation and current turn', async () => {
    const f = await fixture()
    const event = (sessionId: string, turnId: string) =>
      f.clients.event('hook', {
        method: 'notifications/tempad/client-event',
        params: { event: 'Interrupt', kind: 'codex-app', sessionId, turnId }
      })
    event('thread-b', 'turn-a')
    event('thread-a', 'old-turn')
    expect(f.record.task.status).toBe('active')
    event('thread-a', 'turn-a')
    expect(f.record.task.status).toBe('paused')
    f.tasks.resume(f.record.task.taskId, f.owner, 0, session)
    await f.clients.owner('connection-a', {
      'x-codex-turn-metadata': { thread_id: 'thread-a', turn_id: 'turn-b' }
    })
    event('thread-a', 'turn-a')
    expect(f.record.task.status).toBe('active')
    f.clients.disconnect('connection-a')
    expect(f.record.task.status).toBe('paused')
  })
})
