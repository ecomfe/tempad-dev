import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodexAppLifecycle } from '../src/agent-clients/codex-lifecycle'
import type { HostContext } from '../src/agent-clients/host-context'

import { CodexAppFeedback } from '../src/agent-clients/codex-feedback'
import { codexSocketPaths } from '../src/agent-clients/codex-ipc'
import { CodexNativeQueue } from '../src/agent-clients/codex-queue'
import {
  captureHostContext,
  HostContextSchema,
  hostContextKey,
  hostConversationKey,
  requireHostContext
} from '../src/agent-clients/host-context'
import { AgentClients } from '../src/agent-clients/registry'
import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { HISTORY_RETENTION_MS } from '../src/history-retention'
import { hostEnvironment, hubEnvironment } from '../src/process-environment'
import { log } from '../src/shared'

const contextA = captureHostContext({ HOME: resolve('/host-a'), TMPDIR: resolve('/tmp-a') })
const contextB = captureHostContext({ HOME: resolve('/host-b'), TMPDIR: resolve('/tmp-b') })
const session = {
  sessionId: 'figma',
  fileKey: 'file-a',
  fileName: 'File',
  pageId: 'page',
  busy: false
}
const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'tempad-host-context-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return path
}

describe('CLI host context', () => {
  it('resolves only bounded discovery paths, including defaults and relative overrides', () => {
    const context = captureHostContext({
      HOME: resolve('/home'),
      CODEX_HOME: './codex',
      CODEX_SQLITE_HOME: './sqlite',
      TEMP: resolve('/temp'),
      API_KEY: 'secret',
      CODEX_THREAD_ID: 'parent'
    })
    expect(context).toEqual({
      version: 1,
      home: resolve('/home'),
      tempDir: resolve('/temp'),
      codexHome: resolve('codex'),
      codexSqliteHome: resolve('sqlite')
    })
    expect(
      captureHostContext({ USERPROFILE: resolve('/user'), TMP: resolve('/temp') })
    ).toMatchObject({
      home: resolve('/user'),
      codexHome: resolve('/user/.codex'),
      tempDir: resolve('/temp')
    })
    expect(HostContextSchema.safeParse(captureHostContext({})).success).toBe(true)
    for (const invalid of [
      { ...context, version: 2 },
      { ...context, home: 'relative' },
      { ...context, tempDir: '/x\0y' },
      { ...context, codexHome: '/'.repeat(4097) },
      { ...context, executable: '/arbitrary/program' },
      { ...context, credentials: 'secret' }
    ])
      expect(HostContextSchema.safeParse(invalid).success).toBe(false)
    expect(requireHostContext(context)).toBe(context)
    expect(() => requireHostContext()).toThrow('Update TemPad Dev MCP and restart')
    expect(hostContextKey(contextA)).not.toBe(hostContextKey(contextB))
    expect(hostConversationKey('same-thread', contextA)).not.toBe(
      hostConversationKey('same-thread', contextB)
    )
    expect(hostContextKey()).toBe('')
  })

  it('launches Hub without inherited identities, secrets or Node injection flags', () => {
    const env = {
      PATH: '/bin',
      HOME: '/os-home',
      TMPDIR: '/tmp',
      SystemRoot: 'C:\\Windows',
      TEMPAD_MCP_RUNTIME_DIR: '/run',
      TEMPAD_MCP_DEV_CHECKOUT: '/checkout',
      TEMPAD_MCP_APPLY_CANVAS_TIMEOUT: '300000',
      CODEX_HOME: '/first-codex',
      CODEX_SQLITE_HOME: '/first-sqlite',
      CODEX_THREAD_ID: 'parent',
      CODEX_APP_TOOLS_PIPE_PATH: '/parent.pipe',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'parent-session',
      OPENAI_API_KEY: 'secret',
      NODE_OPTIONS: '--require /injected.js',
      TEMPAD_MCP_UNKNOWN: 'not-config'
    }
    expect(hubEnvironment(env)).toEqual({
      PATH: '/bin',
      HOME: '/os-home',
      TMPDIR: '/tmp',
      SystemRoot: 'C:\\Windows',
      TEMPAD_MCP_RUNTIME_DIR: '/run',
      TEMPAD_MCP_DEV_CHECKOUT: '/checkout',
      TEMPAD_MCP_APPLY_CANVAS_TIMEOUT: '300000'
    })
    const helper = hostEnvironment(contextB, env)
    expect(helper).toMatchObject({
      HOME: contextB.home,
      USERPROFILE: contextB.home,
      CODEX_HOME: contextB.codexHome,
      CODEX_SQLITE_HOME: contextB.codexSqliteHome,
      TMPDIR: contextB.tempDir,
      TEMP: contextB.tempDir,
      TMP: contextB.tempDir
    })
    for (const key of [
      'OPENAI_API_KEY',
      'CODEX_THREAD_ID',
      'CLAUDECODE',
      'NODE_OPTIONS',
      'TEMPAD_MCP_RUNTIME_DIR'
    ])
      expect(helper).not.toHaveProperty(key)
    expect(env.CODEX_HOME).toBe('/first-codex')
  })

  it('reads each host queue without consulting the Hub environment', async () => {
    const root = await directory()
    const contexts = ['a', 'b'].map((name) =>
      captureHostContext({ HOME: root, CODEX_HOME: join(root, name), TMPDIR: root })
    )
    vi.stubEnv('CODEX_HOME', '/wrong-home')
    vi.stubEnv('CODEX_SQLITE_HOME', '/wrong-sqlite')
    for (const [index, context] of contexts.entries()) {
      await mkdir(context.codexHome)
      await writeFile(
        join(context.codexHome, '.codex-global-state.json'),
        JSON.stringify({ 'queued-follow-ups': { same: [{ id: String(index) }] } })
      )
    }
    const queues = contexts.map(CodexNativeQueue.forContext)
    cleanups.push(() => queues.forEach((queue) => queue.close()))
    expect(await Promise.all(queues.map((queue) => queue.read('same')))).toEqual([
      [{ id: '0' }],
      [{ id: '1' }]
    ])
    expect(await queues[0]!.areQueuesEmpty('unused')).toBe(true)
    expect(await queues[1]!.areQueuesEmpty('same')).toBe(false)
    if (process.platform !== 'win32')
      expect(codexSocketPaths(contexts[0]!)[0]).toBe(join(contexts[0]!.codexHome, 'ipc/ipc.sock'))
  })
})

describe('connection-scoped native routing', () => {
  it('does not share availability caches or lifecycle events between identical thread IDs in different homes', async () => {
    const open = vi.fn(async (context) => ({
      owner: async () => {
        if (hostContextKey(context) === hostContextKey(contextB)) throw new Error('Unavailable')
        return 'owner'
      },
      close: vi.fn(),
      request: vi.fn(),
      broadcast: vi.fn(),
      onBroadcast: () => () => {},
      onDisconnect: () => () => {}
    }))
    const feedback = new CodexAppFeedback(await directory(), { open })
    let changed!: ConstructorParameters<typeof CodexAppLifecycle>[0]
    const tasks = new DesignTasks({
      createId: (() => {
        let count = 0
        return () => `task-${++count}`
      })()
    })
    const clients = new AgentClients(tasks, feedback, (callback) => {
      changed = callback
      return {
        watch: vi.fn(),
        state: () => undefined,
        retain: vi.fn(),
        interrupt: vi.fn(),
        close: vi.fn()
      }
    })
    cleanups.push(() => clients.close())
    for (const [id, context] of [
      ['a', contextA],
      ['b', contextB]
    ] as const) {
      clients.registerContext(id, context)
      const owner = await clients.owner(id, {
        'x-codex-turn-metadata': { thread_id: 'same', turn_id: 'turn' }
      })
      const description = await clients.describe(owner)
      expect(description.capabilities.queue).toBe(id === 'a')
      tasks.begin(
        owner,
        'extension',
        { ...session, fileKey: id },
        id,
        id,
        description.client,
        description.capabilities,
        undefined,
        undefined,
        context
      )
      await clients.describe(owner)
    }
    expect(open).toHaveBeenCalledTimes(2)
    changed('same', { turns: [{ turnId: 'turn', status: 'completed' }] }, contextA)
    expect(tasks.find('task-1')!.task.status).toBe('paused')
    expect(tasks.find('task-2')!.task.status).toBe('active')
    clients.disconnect('a')
    const owner = await clients.owner('b', {
      'x-codex-turn-metadata': { thread_id: 'same', turn_id: 'next' }
    })
    expect((await clients.describe(owner)).capabilities.queue).toBe(false)
  })

  it('retains receipt context across restart and removes only the original host queue entry', async () => {
    const root = await directory()
    let releaseAdmission!: () => void
    const admission = new Promise<void>((resolve) => {
      releaseAdmission = resolve
    })
    const messages = new Map([
      [contextA.codexHome, [] as { id: string }[]],
      [contextB.codexHome, [] as { id: string }[]]
    ])
    const factory = vi.spyOn(CodexNativeQueue, 'forContext').mockImplementation((context) => {
      const queue = new CodexNativeQueue(
        async () => messages.get(context.codexHome)!,
        async () => null,
        { list: vi.fn(), add: vi.fn(), remove: vi.fn(), close: vi.fn() }
      )
      vi.spyOn(queue, 'admit').mockImplementation(
        async (_ipc, _owner, _conversation, _task, feedback, _signal, beforeWrite, onDispatch) => {
          await beforeWrite('legacy')
          onDispatch()
          await admission
          messages.get(context.codexHome)!.push({ id: feedback.id })
        }
      )
      vi.spyOn(queue, 'remove').mockImplementation(async (_ipc, _owner, _conversation, ids) => {
        messages.set(
          context.codexHome,
          messages.get(context.codexHome)!.filter(({ id }) => !ids.has(id))
        )
      })
      return queue
    })
    const open = vi.fn(async () => ({
      owner: async () => 'owner',
      close: vi.fn(),
      request: vi.fn(),
      broadcast: vi.fn(),
      onBroadcast: () => () => {},
      onDisconnect: () => () => {}
    }))
    let native = new CodexAppFeedback(root, { open })
    const feedback = {
      id: 'one',
      mode: 'queue' as const,
      fileKey: 'file',
      items: [],
      comment: 'Comment',
      createdAt: Date.now()
    }
    const binding = {
      client: { kind: 'codex-app' as const, name: 'Codex', sessionId: 'same' },
      hostContext: contextA
    }
    const pending = native.enqueue(
      binding,
      'task-a',
      feedback,
      new AbortController().signal,
      () => {},
      () => {}
    )
    try {
      await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
      const queue = factory.mock.results[0]!.value as CodexNativeQueue
      const close = vi.spyOn(queue, 'close')
      native.retainContexts([])
      expect(close).not.toHaveBeenCalled()
      await expect(
        native.enqueue(
          { ...binding, hostContext: { ...contextA, tempDir: contextB.tempDir } },
          'task-a',
          { ...feedback, mode: 'steer' },
          new AbortController().signal,
          () => {},
          () => {}
        )
      ).rejects.toThrow('pending delivery')
    } finally {
      releaseAdmission()
    }
    await pending
    await native.enqueue(
      { ...binding, hostContext: { ...contextA, home: contextB.home, tempDir: contextB.tempDir } },
      'task-a',
      feedback,
      new AbortController().signal,
      () => {},
      () => {}
    )
    await expect(
      native.enqueue(
        { ...binding, hostContext: contextB },
        'task-a',
        feedback,
        new AbortController().signal,
        () => {},
        () => {}
      )
    ).rejects.toThrow('different Codex host context')
    await native.enqueue(
      { ...binding, hostContext: contextB },
      'task-b',
      { ...feedback, id: 'two' },
      new AbortController().signal,
      () => {},
      () => {}
    )
    expect(factory).toHaveBeenCalledTimes(2)
    const stored = await Promise.all(
      (await readdir(root)).map(async (name) =>
        JSON.parse(await readFile(join(root, name), 'utf8'))
      )
    )
    expect(stored.map((receipt) => receipt.hostContext.codexHome).sort()).toEqual(
      [contextA.codexHome, contextB.codexHome].sort()
    )
    native.close()
    const moved = { ...contextA, home: contextB.home, tempDir: contextB.tempDir }
    let taskContext: HostContext | undefined = moved
    native = new CodexAppFeedback(root, {
      open,
      taskContext: (taskId) => (taskId === 'task-a' ? taskContext : undefined)
    })
    cleanups.push(() => native.close())
    open.mockClear()
    await native.cancelQueued('task-a')
    expect(open).toHaveBeenCalledExactlyOnceWith(moved)
    expect(messages.get(contextA.codexHome)).toEqual([])
    expect(messages.get(contextB.codexHome)).toEqual([{ id: 'two' }])
    // Even expired task metadata is unnecessary for late cancellation reconciliation.
    taskContext = undefined
    messages.set(contextA.codexHome, [{ id: 'one' }, { id: 'user-message' }])
    await native.reconcileQueued(() => false)
    expect(open).toHaveBeenLastCalledWith(moved)
    expect(messages.get(contextA.codexHome)).toEqual([{ id: 'user-message' }])
    native.retainContexts([])
    await native.cancelQueued('task-b')
    expect(messages.get(contextB.codexHome)).toEqual([])
  })

  it('recovers a legacy receipt only through its task context and persists that routing', async () => {
    const root = await directory()
    const path = join(root, `${'a'.repeat(64)}.json`)
    await writeFile(
      path,
      JSON.stringify({
        signature: 'legacy',
        status: 'delivered',
        delivery: 'queue',
        backend: 'server',
        conversationId: 'thread',
        taskId: 'task',
        messageId: 'comment',
        acceptedAt: Date.now() - HISTORY_RETENTION_MS - 10 * 60000
      })
    )
    let messages = [{ id: 'native-id', clientUserMessageId: 'comment', input: [] }]
    const queue = new CodexNativeQueue(
      async () => [],
      async () => null,
      {
        list: async () => messages,
        add: vi.fn(),
        remove: async (_thread, id) => {
          messages = messages.filter((message) => message.id !== id)
        },
        close: vi.fn()
      }
    )
    const factory = vi.spyOn(CodexNativeQueue, 'forContext').mockReturnValue(queue)
    let recovered: HostContext | undefined
    const feedback = new CodexAppFeedback(root, {
      taskContext: (id) => (id === 'task' ? recovered : undefined)
    })
    cleanups.push(() => feedback.close())
    vi.stubEnv('CODEX_HOME', contextB.codexHome)

    await feedback.reconcileQueued(() => false)
    expect(JSON.parse(await readFile(path, 'utf8')).status).toBe('delivered')
    expect(factory).not.toHaveBeenCalled()
    await expect(feedback.cancelQueued('task')).rejects.toThrow('Update TemPad Dev MCP and restart')
    expect(factory).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(path, 'utf8')).status).toBe('cancelled')
    expect(messages).toHaveLength(1)

    recovered = contextA
    await feedback.cancelQueued('task')
    expect(factory).toHaveBeenCalledExactlyOnceWith(contextA)
    expect(messages).toEqual([])
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      status: 'removed',
      hostContext: contextA
    })
    recovered = undefined
    messages = [{ id: 'late-native-id', clientUserMessageId: 'comment', input: [] }]
    await feedback.reconcileQueued(() => false)
    expect(messages).toEqual([])
  })

  it.each(['claude', 'codex-app'] as const)(
    'keeps contexts independent when %s connects first',
    async (first) => {
      const tasks = new DesignTasks({ createId: () => 'task-a' })
      const open = vi.fn(async () => ({
        owner: vi.fn(async () => 'owner'),
        close: vi.fn(),
        request: vi.fn(),
        broadcast: vi.fn(),
        onBroadcast: () => () => {},
        onDisconnect: () => () => {}
      }))
      const feedback = new CodexAppFeedback(await directory(), { open })
      const clients = new AgentClients(tasks, feedback)
      cleanups.push(() => clients.close())
      for (const kind of [first, first === 'claude' ? 'codex-app' : 'claude'] as const) {
        const context = kind === 'claude' ? contextA : contextB
        clients.registerContext(kind, context)
        clients.event(kind, {
          method: 'notifications/tempad/client-event',
          params: { event: 'connect', kind }
        })
        const owner = await clients.owner(
          kind,
          kind === 'codex-app' ? { 'x-codex-turn-metadata': { thread_id: 'thread' } } : undefined,
          { name: kind === 'claude' ? 'claude-code' : 'codex' }
        )
        const description = await clients.describe(owner)
        expect(description.hostContext).toEqual(context)
        expect(description.capabilities.queue).toBe(kind === 'codex-app')
      }
      expect(open).toHaveBeenCalledExactlyOnceWith(contextB)
      clients.disconnect('claude')
      const owner = await clients.owner('codex-app', {
        'x-codex-turn-metadata': { thread_id: 'thread' }
      })
      expect((await clients.describe(owner)).hostContext).toEqual(contextB)
      expect((await clients.describe(owner)).capabilities.queue).toBe(true)
    }
  )

  it('freezes a registration and rejects invalid, changed or late contexts', async () => {
    const clients = new AgentClients(new DesignTasks({ createId: () => 'unused' }))
    cleanups.push(() => clients.close())
    const input = structuredClone(contextA)
    clients.registerContext('a', input)
    input.home = contextB.home
    clients.registerContext('a', contextA)
    expect(() => clients.registerContext('a', contextB)).toThrow('cannot change')
    expect(() => clients.registerContext('bad', { ...contextA, version: 9 })).toThrow()
    const owner = await clients.owner('a', undefined)
    expect((await clients.describe(owner)).hostContext).toEqual(contextA)
    await clients.owner('late', undefined)
    expect(() => clients.registerContext('late', contextA)).toThrow('before using tools')
    clients.disconnect('a')
    clients.registerContext('a', contextB)
    expect((await clients.describe(await clients.owner('a', undefined))).hostContext).toEqual(
      contextB
    )
  })

  it('preserves context through disconnect and restart, and rejects adoption from another home', async () => {
    const root = await directory()
    const store = new DesignTaskStore(join(root, 'tasks.json'))
    let tasks = new DesignTasks({ createId: () => 'task-a', store })
    const feedback = new CodexAppFeedback(root)
    const available = vi.spyOn(feedback, 'available').mockResolvedValue(true)
    const interrupt = vi.fn(async () => true)
    const native = {
      watch: vi.fn(),
      state: () => ({ turns: [{ turnId: 'turn', status: 'inProgress' as const }] }),
      retain: vi.fn(),
      interrupt,
      close: vi.fn()
    }
    let clients = new AgentClients(tasks, feedback, () => native)
    const metadata = { 'x-codex-turn-metadata': { thread_id: 'same-thread', turn_id: 'turn' } }
    clients.registerContext('a', contextA)
    clients.event('a', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'codex-app' }
    })
    const owner = await clients.owner('a', metadata)
    const description = await clients.describe(owner)
    tasks.begin(
      owner,
      'extension',
      session,
      'Review',
      'request',
      description.client,
      description.capabilities,
      undefined,
      undefined,
      description.hostContext
    )
    clients.disconnect('a')
    expect((await clients.describe(owner)).hostContext).toEqual(contextA)
    clients.close()
    tasks = new DesignTasks({ createId: () => 'unused', store })
    tasks.restore()
    clients = new AgentClients(tasks, feedback, () => native)
    cleanups.push(() => clients.close())
    const record = tasks.find('task-a')!
    const restoredOwner = record.ownerId
    expect(record.hostContext).toEqual(contextA)
    await clients.describe(restoredOwner)
    expect(available).toHaveBeenLastCalledWith({
      client: description.client,
      hostContext: contextA
    })
    clients.registerContext('b', contextB)
    clients.event('b', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'codex-app' }
    })
    const warn = vi.spyOn(log, 'warn')
    await clients.owner('b', metadata)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskIds: ['task-a'] }),
      expect.stringContaining('Codex storage differs')
    )
    expect(record.ownerId).toBe(restoredOwner)
    expect(record.hostContext).toEqual(contextA)
    const moved = { ...contextA, home: contextB.home, tempDir: contextB.tempDir }
    clients.registerContext('c', moved)
    clients.event('c', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'codex-app' }
    })
    const nextOwner = await clients.owner('c', metadata)
    expect(record.ownerId).toBe(nextOwner)
    expect(record.hostContext).toEqual(moved)
    expect(store.load()?.records[0]?.hostContext).toEqual(moved)
    await clients.action({
      requestId: 'stop',
      taskId: 'task-a',
      epoch: record.task.epoch!,
      action: 'stop'
    })
    expect(interrupt).toHaveBeenCalledWith('same-thread', 'turn', moved)
  })

  it('does not require Codex storage or discovery paths to reconnect a Claude task', () => {
    const tasks = new DesignTasks({ createId: () => 'claude-task' })
    const client = { kind: 'claude' as const, name: 'Claude', sessionId: 'resumed-session' }
    const record = tasks.begin(
      'old',
      'extension',
      session,
      'Review',
      'request',
      client,
      undefined,
      undefined,
      undefined,
      contextA
    )
    tasks.disconnectOwner('old')
    tasks.attachClient('new', client, undefined, contextB)
    expect(record.ownerId).toBe('new')
    expect(record.hostContext).toEqual(contextB)
  })

  it('does not substitute the Hub environment for missing legacy client context', async () => {
    vi.stubEnv('CODEX_HOME', '/first-launcher')
    const feedback = new CodexAppFeedback(await directory())
    cleanups.push(() => feedback.close())
    expect(
      await feedback.available({
        client: { kind: 'codex-app', name: 'Codex', sessionId: 'thread' }
      })
    ).toBe(false)
    const clients = new AgentClients(new DesignTasks({ createId: () => 'unused' }), feedback)
    cleanups.push(() => clients.close())
    clients.event('legacy', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'codex-app' }
    })
    const owner = await clients.owner('legacy', {
      'x-codex-turn-metadata': { thread_id: 'thread' }
    })
    expect((await clients.describe(owner)).capabilities).toMatchObject({
      queue: false,
      steer: false,
      interrupt: false,
      reason: expect.stringContaining('Update TemPad Dev MCP and restart')
    })
  })
})
