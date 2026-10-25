import type { ClientHook } from '@tempad-dev/shared'

import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import { AgentClients } from '../src/agent-clients/registry'
import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { writeDurableJson } from '../src/durable-json'
import { startHookGateway } from '../src/runtime-prototype/hooks'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import { connectSocket, listenPrivate } from '../src/runtime-prototype/processes'
import { ControlPeer, SocketTransport } from '../src/runtime-prototype/protocol'

const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
const session = {
  sessionId: 'figma',
  fileKey: 'file',
  fileName: 'File',
  pageId: '0:1',
  busy: false
}
function directory() {
  const root = realpathSync(mkdtempSync('/tmp/tp-hook-evidence-'))
  mkdirSync(join(root, 'run'), { mode: 0o700 })
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function input(
  event: ClientHook['event'] = 'PreToolUse',
  issuedAt = Date.now(),
  turnId = 'turn'
): Extract<ClientHook, { version: 2 }> {
  return {
    version: 2,
    kind: 'claude',
    sessionId: 'session',
    event,
    turnId,
    issuedAt,
    profile: { kind: 'release' },
    invocationId: randomUUID()
  }
}
async function hub(root: string, versions = [2]) {
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  const tasks = new DesignTasks({ store, createId: randomUUID })
  tasks.restore()
  const clients = new AgentClients(tasks)
  const effect = vi.fn((hook: ClientHook, fresh: boolean) => clients.clientHook(hook, fresh))
  const secret = randomUUID()
  const control = new HubControl(secret, () => 0, {
    inspect: () => ({
      drained: true,
      deadline: Date.now() + 1000,
      blockers: [],
      version: '0.12.0'
    }),
    flush: () => tasks.flush(),
    stop: async () => {},
    hook: (hook, fresh) =>
      tasks.applyHook(
        hook.invocationId,
        hook,
        () => effect(hook, fresh),
        () => clients.retireHook(hook)
      )
  })
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    void control.attach(socket)
  })
  const path = join(root, `${control.hubId}.sock`)
  await listenPrivate(server, path)
  const peer = new ControlPeer()
  await peer.connect(new SocketTransport(await connectSocket(path)))
  cleanup.push(async () => {
    clients.close()
    await peer.close()
    await control.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  await peer.request(
    { method: 'tempad/runtime-acquire', params: { secret, versions } },
    LeaseSchema
  )
  const deliver = (hook: ClientHook, admittedHubId?: string) =>
    peer.request(
      {
        method: 'tempad/runtime-hook',
        params: { input: hook, ...(admittedHubId ? { admittedHubId } : {}) }
      },
      ResultSchema
    )
  const connect = (id = 'edge', sessionId = 'session') =>
    clients.event(id, {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'claude', sessionId }
    })
  const owner = (id = 'edge') => clients.owner(id, undefined, { name: 'claude-code' })
  return { clients, tasks, control, effect, deliver, connect, owner, peer }
}
async function request(root: string, params: ClientHook) {
  const socket = await connectSocket(join(root, 'run/mcp.sock'))
  const reply = once(socket, 'data')
  socket.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params }) + '\n'
  )
  try {
    return JSON.parse(String((await reply)[0]))
  } finally {
    socket.destroy()
  }
}

it.skipIf(process.platform === 'win32').each(['legacy', 'previous-hub'])(
  'does not reclaim a session from persisted %s hook evidence',
  async (format) => {
    const root = directory()
    const oldHubId = randomUUID()
    const queued = input('PreToolUse', Date.now() - 5000, 'old-turn')
    const entries = [
      { input: queued, ...(format === 'previous-hub' ? { admittedHubId: oldHubId } : {}) }
    ]
    writeDurableJson(
      join(root, 'hooks.json'),
      format === 'legacy'
        ? entries
        : {
            version: 2,
            cutoff: 0,
            receiver: { hubId: oldHubId },
            entries
          }
    )
    const current = await hub(root)
    current.connect()
    const gateway = await startHookGateway(root, current.deliver)
    cleanup.push(() => gateway.close())
    gateway.setReceiver(current.control.hubId)
    expect(await current.owner()).toBe('edge')
    await gateway.flush()
    expect(current.effect).toHaveBeenCalledExactlyOnceWith(queued, false)
    expect(await current.owner()).toBe('edge')
    expect(current.clients.hasLegacyHooks).toBe(true)
  }
)

it.skipIf(process.platform === 'win32')(
  'accepts the initiating hook before first Hub startup, including legacy hooks',
  async () => {
    const root = directory()
    const first = input('UserPromptSubmit', Date.now() - 5000)
    const current = await hub(root)
    current.connect()
    const gateway = await startHookGateway(root, current.deliver)
    cleanup.push(() => gateway.close())
    gateway.setReceiver(current.control.hubId)
    await request(root, first)
    await gateway.flush()
    expect(current.effect).toHaveBeenCalledExactlyOnceWith(first, true)
    expect(await current.owner()).toBe('edge/claude/session')
    expect(current.clients.hasLegacyHooks).toBe(false)
    const legacy: ClientHook = {
      version: 1,
      kind: 'claude',
      sessionId: 'legacy-session',
      event: 'PreToolUse',
      invocationId: randomUUID()
    }
    await request(root, legacy)
    expect(current.effect).toHaveBeenLastCalledWith(legacy, true)
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps first-admission provenance across retries and supervisor restart against the same Hub',
  async () => {
    const root = directory()
    const current = await hub(root)
    current.connect()
    const first = input('UserPromptSubmit', Date.now() - 5000)
    const failed = await startHookGateway(root, async () => {
      throw new Error('transport unavailable')
    })
    failed.setReceiver(current.control.hubId)
    expect((await request(root, first)).result.receipt.state).toBe('accepted')
    await expect(failed.flush()).rejects.toThrow('transport unavailable')
    await failed.close()
    const gateway = await startHookGateway(root, current.deliver)
    cleanup.push(() => gateway.close())
    gateway.setReceiver(current.control.hubId)
    await request(root, first)
    await gateway.flush()
    expect(current.effect).toHaveBeenCalledExactlyOnceWith(first, true)
    expect(await current.owner()).toBe('edge/claude/session')
    const stored = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'))
    expect(stored.receiver).toEqual({ hubId: current.control.hubId })
    expect(stored.entries[0].admittedHubId).toBe(current.control.hubId)
  }
)

it.skipIf(process.platform === 'win32')(
  'cannot promote old retries or delayed first receipts after true Hub replacement',
  async () => {
    const root = directory()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const old = input('UserPromptSubmit')
    let current: Awaited<ReturnType<typeof hub>> | null = null
    const gateway = await startHookGateway(root, (hook, admittedHubId) => {
      if (!current) throw new Error('old Hub crashed')
      return current.deliver(hook, admittedHubId)
    })
    cleanup.push(() => gateway.close())
    const oldHubId = randomUUID()
    gateway.setReceiver(oldHubId)
    await request(root, old)
    await expect(gateway.flush()).rejects.toThrow('old Hub crashed')
    now += 5000
    current = await hub(root)
    current.connect()
    gateway.setReceiver(current.control.hubId)
    await request(root, old)
    await gateway.flush()
    expect(current.effect).toHaveBeenLastCalledWith(old, false)
    expect(
      JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries[0].admittedHubId
    ).toBe(oldHubId)
    const delayed = { ...old, invocationId: randomUUID() }
    await request(root, delayed)
    await gateway.flush()
    expect(current.effect).toHaveBeenLastCalledWith(delayed, false)
    expect(await current.owner()).toBe('edge')
    now++
    const fresh = input('UserPromptSubmit')
    await request(root, fresh)
    await gateway.flush()
    expect(current.effect).toHaveBeenLastCalledWith(fresh, true)
    expect(await current.owner()).toBe('edge/claude/session')
  }
)

it.skipIf(process.platform === 'win32')(
  'authenticates the private hook envelope and rejects legacy raw messages without effects',
  async () => {
    const current = await hub(directory())
    current.connect()
    const historical = input()
    await current.deliver(historical, randomUUID())
    expect(current.effect).toHaveBeenLastCalledWith(historical, false)
    expect(await current.owner()).toBe('edge')
    const raw = input()
    await expect(
      current.peer.request({ method: 'tempad/runtime-hook', params: raw }, ResultSchema)
    ).rejects.toThrow()
    expect(current.effect).toHaveBeenCalledExactlyOnceWith(historical, false)
    expect(await current.owner()).toBe('edge')
    const fresh = input()
    await current.deliver(fresh, current.control.hubId)
    expect(current.effect).toHaveBeenLastCalledWith(fresh, true)
    expect(await current.owner()).toBe('edge/claude/session')
  }
)

it.skipIf(process.platform === 'win32')(
  'rejects control v1 before acquiring a provenance-capable Hub lease',
  async () => {
    await expect(hub(directory(), [1])).rejects.toThrow('MCP_RUNTIME_RESTART_REQUIRED')
  }
)

it.skipIf(process.platform === 'win32')(
  'does not admit a future-issued hook behind a blocked delivery',
  async () => {
    const root = directory()
    const current = await hub(root)
    current.connect()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const blocker = { ...input(), sessionId: 'other-session' }
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const gateway = await startHookGateway(root, async (hook, admittedHubId) => {
      if (hook.invocationId === blocker.invocationId) await barrier
      return current.deliver(hook, admittedHubId)
    })
    cleanup.push(async () => {
      release()
      await gateway.flush()
      await gateway.close()
    })
    gateway.setReceiver(current.control.hubId)
    expect((await request(root, blocker)).result.receipt.state).toBe('accepted')
    const future = input('UserPromptSubmit', now + 1000)
    expect((await request(root, future)).error).toMatchObject({ code: -32001 })
    expect(current.effect).not.toHaveBeenCalled()
    now += 2000
    release()
    await gateway.flush()
    expect(current.effect).toHaveBeenCalledExactlyOnceWith(blocker, true)
    expect(await current.owner()).toBe('edge')
    await request(root, future)
    await gateway.flush()
    expect(current.effect).toHaveBeenCalledTimes(2)
    expect(current.effect).toHaveBeenLastCalledWith(future, true)
    expect(await current.owner()).toBe('edge/claude/session')
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps the replacement freshness boundary across same-Hub gateway restart',
  async () => {
    const root = directory()
    const current = await hub(root)
    current.connect()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const before = await startHookGateway(root, current.deliver)
    before.setReceiver(randomUUID())
    before.setReceiver(current.control.hubId)
    await before.close()
    const gateway = await startHookGateway(root, current.deliver)
    cleanup.push(() => gateway.close())
    now += 1000
    gateway.setReceiver(current.control.hubId)
    const delayed = input('UserPromptSubmit', now - 1000)
    await request(root, delayed)
    await gateway.flush()
    expect(current.effect).toHaveBeenLastCalledWith(delayed, false)
    expect(await current.owner()).toBe('edge')
    const fresh = input('UserPromptSubmit')
    await request(root, fresh)
    await gateway.flush()
    expect(current.effect).toHaveBeenLastCalledWith(fresh, true)
    expect(await current.owner()).toBe('edge/claude/session')
  }
)

it
  .skipIf(process.platform === 'win32')
  .each(['UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const)(
  'historical %s neither binds a task nor consumes a pending Stop notice',
  async (event) => {
    const current = await hub(directory())
    current.connect()
    const owner = await current.owner()
    const record = current.tasks.begin(owner, 'extension', session, 'Stopped work', 'begin', {
      kind: 'claude',
      name: 'Claude',
      sessionId: 'session'
    })
    current.tasks.stop(record.task.taskId, 'cancelled', { sessionId: 'session', turnId: 'turn' })
    current.tasks.requireFileRead(session.fileKey, true)
    current.tasks.saveExecutions([
      {
        id: 'uncertain-write',
        revision: randomUUID(),
        recordedAt: Date.now(),
        receipt: { generation: 'generation', receiptId: 'receipt' },
        extensionId: 'extension',
        browserId: 'browser',
        origin: 'chrome-extension://owner',
        session,
        taskId: record.task.taskId,
        handoff: true
      }
    ])
    const historical = { ...input(event), taskId: record.task.taskId }
    expect(await current.deliver(historical)).toEqual({})
    expect(record.ownerId).toBe(owner)
    expect(await current.owner()).toBe('edge')
    expect(record.claudeStopNotice).toEqual({ sessionId: 'session', turnId: 'turn' })
    expect(record.task.status).toBe('cancelled')
    expect(current.tasks.needsFileRead(session.fileKey)).toBe(true)
    expect(current.tasks.executionState()).toHaveLength(1)
    const result = await current.deliver(input('PreToolUse'), current.control.hubId)
    expect(result).toMatchObject({
      output: {
        hookSpecificOutput: { additionalContext: expect.stringContaining(record.task.taskId) }
      }
    })
    expect(record.task.status).toBe('cancelled')
  }
)

it.skipIf(process.platform === 'win32').each(['Stop', 'Interrupt', 'SessionEnd'] as const)(
  'historical %s pauses an old task but cannot stop a newer live turn',
  async (event) => {
    const current = await hub(directory())
    current.connect()
    const old = input(event, Date.now() - 1000, 'old-turn')
    const owner = await current.owner()
    const prior = current.tasks.begin(owner, 'extension', session, 'Old work', 'old-begin', {
      kind: 'claude',
      name: 'Claude',
      sessionId: 'session'
    })
    current.tasks.confirm(prior.task.taskId, owner)
    await current.deliver(old)
    expect(prior.task.status).toBe('paused')
    expect(await current.owner()).toBe('edge')
    current.clients.disconnect('edge')

    await current.deliver(input('UserPromptSubmit', Date.now(), 'new-turn'), current.control.hubId)
    current.connect('new-edge')
    const nextOwner = await current.owner('new-edge')
    const next = current.tasks.begin(nextOwner, 'extension', session, 'New work', 'new-begin', {
      kind: 'claude',
      name: 'Claude',
      sessionId: 'session'
    })
    current.tasks.confirm(next.task.taskId, nextOwner)
    const delayed: ClientHook[] = [
      { ...old, turnId: 'new-turn', invocationId: randomUUID() },
      { ...old, issuedAt: Date.now() + 1, invocationId: randomUUID() },
      {
        version: 1,
        kind: 'claude',
        sessionId: old.sessionId,
        event,
        turnId: 'new-turn',
        invocationId: randomUUID()
      }
    ]
    for (const historical of delayed) {
      await current.deliver(historical)
      expect(next.task.status).toBe('active')
      expect(await current.owner('new-edge')).toBe(nextOwner)
    }
    expect(current.clients.hasLegacyHooks).toBe(false)
  }
)
