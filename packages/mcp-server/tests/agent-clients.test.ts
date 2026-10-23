import type { DesignAction, DesignFeedback } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import type { ClientHook } from '../src/agent-clients/hooks'
import type { DesignTaskSnapshot } from '../src/design-task-store'

import { CodexAppFeedback } from '../src/agent-clients/codex-feedback'
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
  it.each([false, true])(
    'does not trust a browser-only review destination after restart=%s or an ordinary owner read',
    async (restart) => {
      let snapshot: DesignTaskSnapshot | undefined
      const store = {
        load: () => structuredClone(snapshot),
        save: (next: DesignTaskSnapshot) => {
          snapshot = structuredClone(next)
        }
      }
      let tasks = new DesignTasks({ createId: () => 'unused', now: () => 1000, store })
      const client = { kind: 'codex-app' as const, name: 'Codex App', sessionId: 'victim-thread' }
      const { busy: _busy, ...target } = session
      tasks.restoreReview(
        {
          taskId: 'browser-only',
          title: 'Saved review',
          target,
          client,
          status: 'completed',
          operation: null,
          epoch: 0,
          revision: 1,
          expiresAt: 1000
        },
        {
          id: 'extension-a',
          origin: 'chrome-extension://fixture',
          sessions: { browserId: 'browser', sessions: [session] }
        } as never,
        session
      )
      if (restart) {
        tasks = new DesignTasks({ createId: () => 'unused', now: () => 1000, store })
        tasks.restore()
      }
      const native = new CodexAppFeedback('/unused')
      const enqueue = vi.spyOn(native, 'enqueue').mockResolvedValue()
      const available = vi.spyOn(native, 'available').mockResolvedValue(true)
      const clients = new AgentClients(tasks, native)
      try {
        const record = tasks.find('browser-only')!
        const originalOwner = record.ownerId
        const action: DesignAction = {
          requestId: feedback.id,
          taskId: record.task.taskId,
          epoch: record.task.epoch!,
          action: 'feedback',
          feedback
        }
        expect(record.task.client).toEqual(client)
        expect((await clients.action(action)).status).toBe('failed')
        // A normal read identifies the real conversation, but does not adopt an
        // arbitrary browser-created task claiming that conversation.
        clients.event('victim-transport', {
          method: 'notifications/tempad/client-event',
          params: { event: 'connect', kind: 'codex-app' }
        })
        await clients.owner('victim-transport', {
          'x-codex-turn-metadata': { thread_id: client.sessionId, turn_id: 'real-turn' }
        })
        expect(record.ownerId).toBe(originalOwner)
        expect((await clients.action(action)).status).toBe('failed')
        expect(enqueue).not.toHaveBeenCalled()
        expect(available).not.toHaveBeenCalled()
      } finally {
        clients.close()
      }
    }
  )

  it('keeps native feedback available for a persisted Hub-owned review after restart', async () => {
    let snapshot: DesignTaskSnapshot | undefined
    const store = {
      load: () => structuredClone(snapshot),
      save: (value: DesignTaskSnapshot) => {
        snapshot = structuredClone(value)
      }
    }
    const client = { kind: 'codex-app' as const, name: 'Codex App', sessionId: 'original-thread' }
    const original = new DesignTasks({ createId: () => 'saved-task', now: () => 1000, store })
    original.begin(
      'original-owner',
      'original-extension',
      session,
      'Saved review',
      'begin-request',
      client
    )
    original.stop('saved-task', 'completed')
    const restored = new DesignTasks({ createId: () => 'unused', now: () => 1000, store })
    restored.restore()
    const native = new CodexAppFeedback('/unused')
    const enqueue = vi.spyOn(native, 'enqueue').mockResolvedValue()
    const clients = new AgentClients(restored, native)
    try {
      const record = restored.find('saved-task')!
      expect(
        (
          await clients.action({
            requestId: feedback.id,
            taskId: record.task.taskId,
            epoch: record.task.epoch!,
            action: 'feedback',
            feedback
          })
        ).status
      ).toBe('delivered')
      expect(enqueue).toHaveBeenCalledWith(
        { client },
        record.task.taskId,
        feedback,
        expect.any(AbortSignal),
        expect.any(Function),
        expect.any(Function)
      )
    } finally {
      clients.close()
    }
  })

  it.each([
    ['parent-codex-thread', 'claude-turn', true],
    [undefined, undefined, true],
    ['parent-codex-thread', 'claude-turn', false]
  ] as const)(
    'isolates inherited Codex conversation %s with hook turn %s and initialized=%s',
    async (inheritedSession, hookTurn, initialized) => {
      const tasks = new DesignTasks({ createId: () => 'claude-task', now: () => 1000 })
      const nativeOwner = vi.fn().mockResolvedValue('codex-owner')
      const native = new CodexAppFeedback('/unused', async () => ({
        owner: nativeOwner,
        close: vi.fn(),
        request: vi.fn(),
        broadcast: vi.fn(),
        onBroadcast: vi.fn(() => () => {}),
        onDisconnect: vi.fn(() => () => {})
      }))
      const watch = vi.fn()
      const interrupt = vi.fn().mockResolvedValue(true)
      const clients = new AgentClients(tasks, native, () => ({
        watch,
        interrupt,
        retain: vi.fn(),
        close: vi.fn(),
        state: () => undefined
      }))
      try {
        clients.event('nested', {
          method: 'notifications/tempad/client-event',
          params: {
            event: 'connect',
            kind: 'codex-app',
            sessionId: inheritedSession,
            turnId: 'parent-turn'
          }
        })
        await clients.owner('nested', undefined)
        const clientInfo = initialized ? { name: 'claude-code', title: 'Claude Code' } : undefined
        const metadata = initialized
          ? {
              'x-codex-turn-metadata': { thread_id: 'parent-codex-thread', turn_id: 'parent-turn' }
            }
          : undefined
        const owner = await clients.owner('nested', metadata, clientInfo)
        const description = await clients.describe(owner)
        expect(description.capabilities).toEqual(CANVAS_ONLY)
        expect(description.client).toMatchObject({ kind: initialized ? 'claude' : 'other' })
        expect(description.client.sessionId).toBeUndefined()
        if (!initialized) {
          for (const invalid of ['not-json', { turn_id: 'parent-turn' }, { thread_id: '' }]) {
            const invalidOwner = await clients.owner('nested', { 'x-codex-turn-metadata': invalid })
            const invalidDescription = await clients.describe(invalidOwner)
            expect(invalidDescription.client).toMatchObject({ kind: 'other' })
            expect(invalidDescription.client.sessionId).toBeUndefined()
            expect(invalidDescription.capabilities).toEqual(CANVAS_ONLY)
          }
        }
        expect(nativeOwner).not.toHaveBeenCalled()
        expect(watch).not.toHaveBeenCalled()
        const record = tasks.begin(
          owner,
          'extension-a',
          session,
          'Nested Claude',
          'request-a',
          description.client,
          description.capabilities
        )
        tasks.confirm(record.task.taskId, owner)
        clients.clientHook({
          version: 1,
          kind: 'claude',
          event: 'PostToolUse',
          sessionId: 'real-claude-session',
          turnId: hookTurn,
          taskId: record.task.taskId,
          invocationId: '00000000-0000-4000-8000-000000000001'
        })
        const boundOwner = await clients.owner('nested', metadata, clientInfo)
        expect(tasks.owned(record.task.taskId, boundOwner).task.client?.sessionId).toBe(
          'real-claude-session'
        )
        expect((await clients.describe(boundOwner)).capabilities).toEqual(CANVAS_ONLY)
        await clients.action({
          requestId: 'stop-nested',
          taskId: record.task.taskId,
          epoch: 0,
          action: 'stop'
        })
        expect(interrupt).not.toHaveBeenCalled()
        expect(
          clients.clientHook({
            version: 1,
            kind: 'claude',
            event: 'PreToolUse',
            sessionId: 'real-claude-session',
            turnId: 'claude-turn',
            invocationId: '00000000-0000-4000-8000-000000000002'
          }).output?.hookSpecificOutput.additionalContext
        ).toContain('claude-task')
        if (!initialized) {
          clients.event('codex-reconnected', {
            method: 'notifications/tempad/client-event',
            params: {
              event: 'connect',
              kind: 'codex-app',
              sessionId: 'inherited-thread',
              turnId: 'inherited-turn'
            }
          })
          const conversationOwner = await clients.owner('codex-reconnected', {
            'x-codex-turn-metadata': { thread_id: 'actual-thread' }
          })
          expect((await clients.describe(conversationOwner)).capabilities.interrupt).toBe(false)
          const codexOwner = await clients.owner('codex-reconnected', {
            'x-codex-turn-metadata': { thread_id: 'actual-thread', turn_id: 'actual-turn' }
          })
          const codex = await clients.describe(codexOwner)
          expect(codex.client).toMatchObject({ kind: 'codex-app', sessionId: 'actual-thread' })
          expect(codex.capabilities).toMatchObject({ interrupt: true, queue: true, steer: true })
          expect(nativeOwner).toHaveBeenCalledWith('actual-thread', undefined, 2000)
          expect(watch).toHaveBeenCalledWith('actual-thread')
        }
      } finally {
        clients.close()
      }
    }
  )

  it('keeps Stop available after more than the bounded completed-action history', async () => {
    const f = await fixture()
    for (let index = 0; index < 1030; index++) {
      const result = await f.clients.action(
        f.action({ requestId: `stop-${index}`, action: 'stop', feedback: undefined })
      )
      expect(result.status).toBe('delivered')
    }
    expect(f.record.task.status).toBe('cancelled')
  })
  it('binds a host session from the successful begin result without model-authored identity', async () => {
    const tasks = new DesignTasks({ createId: () => 'task-claude', now: () => 1000 })
    const clients = new AgentClients(tasks)
    clients.event('claude-connection', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'other' }
    })
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

  it('rebinds Claude after SessionEnd on the same connection and routes Stop to the new session', async () => {
    let taskId = 0
    let invocationId = 0
    const tasks = new DesignTasks({ createId: () => `task-${++taskId}`, now: () => 1000 })
    const clients = new AgentClients(tasks)
    const owner = () =>
      clients.owner('claude-connection', undefined, { name: 'claude-code', title: 'Claude Code' })
    const hook = (event: ClientHook['event'], sessionId: string, taskId?: string) =>
      clients.clientHook({
        version: 1,
        kind: 'claude',
        event,
        sessionId,
        ...(taskId ? { taskId } : {}),
        invocationId: `00000000-0000-4000-8000-${String(++invocationId).padStart(12, '0')}`
      })
    clients.event('claude-connection', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'claude' }
    })

    hook('UserPromptSubmit', 'before-clear')
    const firstOwner = await owner()
    const first = tasks.begin(firstOwner, 'extension-a', session, 'Before clear', 'request-a')
    tasks.confirm(first.task.taskId, firstOwner)
    hook('PostToolUse', 'before-clear', first.task.taskId)
    const boundFirstOwner = await owner()
    expect(first.task.client?.sessionId).toBe('before-clear')

    hook('SessionEnd', 'before-clear')
    expect(first.task.status).toBe('paused')
    hook('UserPromptSubmit', 'after-clear')
    const secondOwner = await owner()
    expect(secondOwner).not.toBe(boundFirstOwner)
    expect((await clients.describe(secondOwner)).client.sessionId).toBeUndefined()
    const second = tasks.begin(secondOwner, 'extension-a', session, 'After clear', 'request-b')
    tasks.confirm(second.task.taskId, secondOwner)
    hook('PostToolUse', 'after-clear', second.task.taskId)
    const boundSecondOwner = await owner()
    expect(tasks.owned(second.task.taskId, boundSecondOwner).task.client?.sessionId).toBe(
      'after-clear'
    )
    hook('Stop', 'before-clear')
    expect(second.task.status).toBe('active')

    expect(
      await clients.action({
        requestId: 'stop-after-clear',
        taskId: second.task.taskId,
        epoch: 0,
        action: 'stop'
      })
    ).toMatchObject({ status: 'delivered' })
    expect(second.task.status).toBe('cancelled')
    expect(first.task.status).toBe('paused')
    expect(hook('PreToolUse', 'before-clear')).toEqual({})
    expect(
      hook('PreToolUse', 'after-clear').output?.hookSpecificOutput.additionalContext
    ).toContain(`task ${second.task.taskId}`)
    expect(hook('PreToolUse', 'after-clear')).toEqual({})
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
    const namedWrapper = await f.clients.owner('connection-a', undefined, {
      name: 'custom-claude-wrapper',
      title: 'Claude Code'
    })
    expect((await f.clients.describe(namedWrapper)).client.kind).toBe('codex-app')
  })

  it('distinguishes application and CLI runtime evidence without granting controls', () => {
    expect(
      runtimeIdentity({ CODEX_APP_TOOLS_PIPE_PATH: '/private/pipe', CODEX_THREAD_ID: 'a' }).client
    ).toEqual({ kind: 'codex-app', name: 'Codex App', sessionId: 'a' })
    expect(runtimeIdentity({ CODEX_SESSION_ID: 'b' }).client.kind).toBe('codex-cli')
    expect(runtimeIdentity({}).client.kind).toBe('other')
    expect(runtimeIdentity({ CLAUDECODE: '1' }).client.kind).toBe('claude')
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

  it('cancels a completed Claude review without sending a Stop notice to its next turn', async () => {
    const tasks = new DesignTasks({ createId: () => 'task', now: () => 1000 })
    const clients = new AgentClients(tasks)
    let invocation = 0
    const hook = (event: ClientHook['event'], turnId: string) =>
      clients.clientHook({
        version: 1,
        kind: 'claude',
        sessionId: 'claude-session',
        turnId,
        event,
        invocationId: `00000000-0000-4000-8000-${String(++invocation).padStart(12, '0')}`
      })
    clients.event('connection', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'claude', sessionId: 'claude-session' }
    })
    hook('UserPromptSubmit', 'turn-a')
    const owner = await clients.owner('connection', undefined)
    const record = tasks.begin(
      owner,
      'extension',
      session,
      'Review',
      'begin',
      (await clients.describe(owner)).client
    )
    tasks.stop(record.task.taskId, 'completed')
    hook('UserPromptSubmit', 'turn-b')

    const result = await clients.action({
      requestId: 'stop',
      taskId: record.task.taskId,
      epoch: 0,
      action: 'stop'
    })
    expect(result.status).toBe('delivered')
    expect(record.task.status).toBe('cancelled')
    expect(hook('PreToolUse', 'turn-b')).toEqual({})
    expect(() => tasks.resume(record.task.taskId, owner, 0, session)).toThrow('cannot resume')
    clients.close()
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
