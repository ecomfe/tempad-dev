import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { CLIENT_HOOK_RETENTION_MS, type ClientHook } from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'

import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { writeDurableJson } from '../src/durable-json'
import { HOOK_RECEIPT_LIMIT } from '../src/hook-receipts'
import { createPrivateTempDirectory } from '../src/runtime-platform'
import { startHookGateway } from '../src/runtime-prototype/hooks'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import { connectSocket, listenPrivate } from '../src/runtime-prototype/processes'
import { ControlPeer, SocketTransport } from '../src/runtime-prototype/protocol'
import {
  newerVersion,
  readJournal,
  writeJournal,
  readEndpoints,
  writeEndpoints
} from '../src/runtime-prototype/state'

const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
function directory() {
  const root = createPrivateTempDirectory('tp-handoff-')
  mkdirSync(join(root, 'run'), { mode: 0o700 })
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function tasks(root: string) {
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  const tasks = new DesignTasks({ store, createId: () => 'task' })
  tasks.restore()
  return { tasks, store }
}

it('expires receipt-capable retries with a durable cutoff, even after the clock moves backward', () => {
  const root = directory()
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  let now = Date.now()
  const current = new DesignTasks({ store, now: () => now, createId: randomUUID })
  current.restore()
  const input: ClientHook = {
    version: 2,
    kind: 'claude',
    sessionId: 'session',
    event: 'Stop',
    invocationId: randomUUID(),
    profile: { kind: 'release' },
    issuedAt: now
  }
  const apply = vi.fn(() => ({}))
  current.applyHook(input.invocationId, input, apply)
  current.applyHook(input.invocationId, input, apply)
  expect(apply).toHaveBeenCalledOnce()
  now += CLIENT_HOOK_RETENTION_MS + 1
  const next = { ...input, issuedAt: now, invocationId: randomUUID() }
  current.applyHook(next.invocationId, next, apply)
  expect(store.load()?.hookReceipts).toHaveLength(1)
  now = input.issuedAt
  const restored = new DesignTasks({ store, now: () => now, createId: randomUUID })
  restored.restore()
  expect(() => restored.applyHook(input.invocationId, input, apply)).toThrow('expired')
  expect(apply).toHaveBeenCalledTimes(2)
})

it.skipIf(process.platform === 'win32')(
  'distinguishes durable hook admission from application and deduplicates retries',
  async () => {
    const root = directory()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const deliver = vi.fn(async () => {
      await gate
      return { notice: 'Stop' }
    })
    const gateway = await startHookGateway(root, deliver)
    cleanup.push(async () => {
      release()
      await gateway.close()
    })
    const input: ClientHook = {
      version: 2,
      kind: 'claude',
      sessionId: 'session',
      event: 'Stop',
      invocationId: randomUUID(),
      profile: { kind: 'release' },
      issuedAt: Date.now()
    }
    const request = async () => {
      const socket = connect(join(root, 'run/mcp.sock'))
      await once(socket, 'connect')
      const reply = once(socket, 'data')
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params: input }) +
          '\n'
      )
      const result = JSON.parse(String((await reply)[0])).result
      socket.destroy()
      return result
    }
    expect(await request()).toEqual({
      receipt: { version: 2, invocationId: input.invocationId, state: 'accepted' }
    })
    expect(await request()).toHaveProperty('receipt.state', 'accepted')
    release()
    await gateway.flush()
    expect(await request()).toEqual({
      notice: 'Stop',
      receipt: { version: 2, invocationId: input.invocationId, state: 'applied' }
    })
    expect(deliver).toHaveBeenCalledOnce()
  }
)

it.skipIf(process.platform === 'win32')(
  'returns a restart error to an old CLI after its identity prefix',
  async () => {
    const root = directory()
    const gateway = await startHookGateway(root, async () => ({}))
    cleanup.push(() => gateway.close())
    const socket = connect(join(root, 'run/mcp.sock'))
    await once(socket, 'connect')
    const reply = once(socket, 'data')
    socket.write(
      '{"jsonrpc":"2.0","method":"notifications/tempad/host-context","params":{}}\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    )
    expect(JSON.parse(String((await reply)[0])).error.message).toContain(
      'MCP_RUNTIME_RESTART_REQUIRED'
    )
    socket.destroy()
  }
)

it('records a lifecycle effect and receipt in the same durable task snapshot', () => {
  const root = directory()
  const current = tasks(root)
  current.tasks.begin(
    'owner',
    'extension',
    {
      sessionId: 'page',
      fileKey: 'file',
      fileName: 'File',
      pageId: '0:1',
      busy: false
    },
    'Work',
    'begin'
  )
  const id = randomUUID()
  const apply = vi.fn(() => {
    current.tasks.stop('task', 'cancelled')
    return { applied: true }
  })
  const save = vi.spyOn(current.store, 'save')
  expect(current.tasks.applyHook(id, { event: 'Stop' }, apply)).toEqual({ applied: true })
  expect(save).toHaveBeenCalledOnce()
  const restored = tasks(root).tasks
  expect(restored.find('task')?.task.status).toBe('cancelled')
  expect(restored.applyHook(id, { event: 'Stop' }, apply)).toEqual({ applied: true })
  expect(apply).toHaveBeenCalledOnce()
  expect(() => restored.applyHook(id, { event: 'Start' }, apply)).toThrow('different content')
})

it('does not acknowledge a failed receipt commit or repeat its in-memory effect on retry', () => {
  const { tasks: current, store } = tasks(directory())
  const save = vi.spyOn(store, 'save').mockImplementationOnce(() => {
    throw new Error('ENOSPC')
  })
  const apply = vi.fn(() => ({ notice: 'Stop' }))
  const id = randomUUID()
  expect(() => current.applyHook(id, {}, apply)).toThrow('cannot be flushed')
  expect(current.applyHook(id, {}, apply)).toEqual({ notice: 'Stop' })
  expect(apply).toHaveBeenCalledOnce()
  expect(save).toHaveBeenCalledTimes(2)
})

it('keeps version, endpoint capabilities and journal ownership across restart', () => {
  const root = directory()
  const journal = {
    version: 1 as const,
    revision: 1,
    phase: 'preparing' as const,
    active: { entry: join(root, 'a/runtime.mjs'), bundle: 'a'.repeat(64), version: '0.11.0' },
    candidate: { entry: join(root, 'b/runtime.mjs'), bundle: 'b'.repeat(64), version: '0.11.1' },
    failedBundles: []
  }
  writeJournal(root, journal)
  expect(readJournal(root)).toEqual(journal)
  const endpoints = {
    wsPort: 12345,
    httpPort: 12346,
    accessToken: 'a'.repeat(64),
    legacyAccessToken: 'b'.repeat(64)
  }
  writeEndpoints(root, endpoints)
  expect(readEndpoints(root)).toEqual(endpoints)
  expect(newerVersion('0.11.1', '0.11.0')).toBe(true)
  expect(newerVersion('0.10.9', '0.11.0')).toBe(false)
  expect(newerVersion('0.11.0', '0.11.0')).toBe(false)
  if (process.platform !== 'win32') {
    chmodSync(join(root, 'switch.json'), 0o644)
    expect(() => readJournal(root)).toThrow('untrusted')
  }
})

it('never repeats a lifecycle effect that threw after changing state', () => {
  const root = directory()
  const id = randomUUID()
  const apply = vi.fn(() => {
    throw new Error('after effect')
  })
  expect(() => tasks(root).tasks.applyHook(id, {}, apply)).toThrow('after effect')
  expect(() => tasks(root).tasks.applyHook(id, {}, apply)).toThrow('remains uncertain')
  expect(apply).toHaveBeenCalledOnce()
})

it.skipIf(process.platform === 'win32')(
  'drains before stopping and keeps metadata available behind the gate',
  async () => {
    const root = directory()
    let drained = false
    let autoBlockers: string[] | undefined
    let idleForMs = 0
    const flush = vi.fn()
    const stop = vi.fn(async () => {})
    const control = new HubControl('secret', undefined, {
      inspect: () => ({
        drained,
        deadline: Date.now() + 10000,
        blockers: drained ? [] : ['work'],
        version: '1',
        autoBlockers,
        idleForMs
      }),
      flush,
      stop,
      hook: () => ({})
    })
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      void control.attach(socket)
    })
    await listenPrivate(server, join(root, 'control.sock'))
    cleanup.push(async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const peer = new ControlPeer()
    await peer.connect(new SocketTransport(await connectSocket(join(root, 'control.sock'))))
    cleanup.push(() => peer.close())
    const lease = await peer.request(
      { method: 'tempad/runtime-acquire', params: { secret: 'secret', versions: [2] } },
      LeaseSchema
    )
    const registration = {
      sessionId: randomUUID(),
      token: randomUUID(),
      versions: [2],
      context: { version: 1, home: root, tempDir: root, codexHome: root, codexSqliteHome: root }
    }
    await peer.request({ method: 'tempad/runtime-register', params: registration }, ResultSchema)
    await expect(peer.request({ method: 'tempad/runtime-stop' }, ResultSchema)).rejects.toThrow(
      'not drained'
    )
    await peer.request({ method: 'tempad/runtime-gate', params: { closed: true } }, ResultSchema)
    expect(control.admits(registration.sessionId, lease.generation, 'tools/call')).toBe(false)
    expect(control.admits(registration.sessionId, lease.generation, 'tools/list')).toBe(true)
    await expect(peer.request({ method: 'tempad/runtime-stop' }, ResultSchema)).rejects.toThrow(
      'not drained'
    )
    drained = true
    const automaticStop = () =>
      peer.request({ method: 'tempad/runtime-stop', params: { automatic: true } }, ResultSchema)
    await expect(automaticStop()).rejects.toThrow('no longer idle or eligible')
    autoBlockers = ['Claude acceptance pending']
    idleForMs = 5000
    await expect(automaticStop()).rejects.toThrow('no longer idle or eligible')
    autoBlockers = []
    idleForMs = 4999
    await expect(automaticStop()).rejects.toThrow('no longer idle or eligible')
    expect(stop).not.toHaveBeenCalled()
    flush.mockImplementationOnce(() => {
      throw new Error('ENOSPC')
    })
    await expect(
      peer.request({ method: 'tempad/runtime-gate', params: { closed: false } }, ResultSchema)
    ).rejects.toThrow('ENOSPC')
    expect(control.admitting()).toBe(false)
    idleForMs = 5000
    await automaticStop()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
    await expect(
      peer.request({ method: 'tempad/runtime-gate', params: { closed: false } }, ResultSchema)
    ).rejects.toThrow('cannot change')
  }
)

it.skipIf(process.platform === 'win32')(
  'retains hooks across a slow receiver, lost reply and gateway restart',
  async () => {
    const root = directory()
    let available = false
    const input = {
      version: 1,
      kind: 'claude',
      sessionId: 'session',
      event: 'Interrupt',
      invocationId: randomUUID()
    }
    const applied = new Map<string, Record<string, unknown>>()
    const deliver = vi.fn(async (value) => {
      if (!available) throw new Error('switching')
      const prior = applied.get(value.invocationId)
      if (prior) return prior
      const result = { notice: 'stopped' }
      applied.set(value.invocationId, result)
      return result
    })
    let gateway = await startHookGateway(root, deliver)
    cleanup.push(() => gateway.close())
    const socket = connect(join(root, 'run/mcp.sock'))
    await once(socket, 'connect')
    const closed = once(socket, 'close')
    socket.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params: input }) + '\n'
    )
    await closed
    expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries[0].input).toEqual(
      input
    )
    await gateway.close()
    available = true
    gateway = await startHookGateway(root, deliver)
    await gateway.flush()
    const retry = connect(join(root, 'run/mcp.sock'))
    await once(retry, 'connect')
    const reply = once(retry, 'data')
    retry.write(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tempad/client-hook', params: input }) + '\n'
    )
    expect(JSON.parse(String((await reply)[0])).result).toEqual({ notice: 'stopped' })
    retry.destroy()
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(applied.size).toBe(1)
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps a delivery fault fenced through the whole backlog, including concurrent admissions',
  async () => {
    const root = directory()
    const input = (event: ClientHook['event']): ClientHook => ({
      version: 2,
      kind: 'claude',
      sessionId: 'session',
      event,
      turnId: 'turn',
      invocationId: randomUUID(),
      profile: { kind: 'release' },
      issuedAt: Date.now()
    })
    const first = input('UserPromptSubmit')
    const second = input('Stop')
    const third = input('SessionEnd')
    writeDurableJson(join(root, 'hooks.json'), [{ input: first }, { input: second }])
    const secondGate = Promise.withResolvers<void>()
    const thirdGate = Promise.withResolvers<void>()
    let failing = true
    const fault = vi.fn()
    const deliver = vi.fn(async (hook: ClientHook) => {
      if (failing) throw new Error('Hub temporarily unavailable')
      if (hook.invocationId === second.invocationId) await secondGate.promise
      if (hook.invocationId === third.invocationId) await thirdGate.promise
      return {}
    })
    const gateway = await startHookGateway(root, deliver, fault)
    cleanup.push(() => gateway.close())
    await expect(gateway.flush()).rejects.toThrow('temporarily unavailable')
    failing = false
    const retry = gateway.flush()
    try {
      await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(second, undefined))
      expect(fault).toHaveBeenLastCalledWith(expect.any(Error))
      const socket = connect(join(root, 'run/mcp.sock'))
      await once(socket, 'connect')
      const reply = once(socket, 'data')
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params: third }) +
          '\n'
      )
      try {
        expect(JSON.parse(String((await reply)[0])).result.receipt.state).toBe('accepted')
      } finally {
        socket.destroy()
      }
      secondGate.resolve()
      await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(third, undefined))
      expect(fault).toHaveBeenLastCalledWith(expect.any(Error))
    } finally {
      secondGate.resolve()
      thirdGate.resolve()
      await retry
    }
    expect(fault).toHaveBeenLastCalledWith(undefined)
    expect(deliver.mock.calls.map(([hook]) => hook.invocationId)).toEqual([
      first.invocationId,
      first.invocationId,
      second.invocationId,
      third.invocationId
    ])
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps admission fenced when a restored inbox remains full after pending delivery',
  async () => {
    const root = directory()
    const entries = Array.from({ length: HOOK_RECEIPT_LIMIT }, (_, index) => ({
      input: {
        version: 1,
        kind: 'claude',
        sessionId: 'session',
        event: 'SessionEnd',
        invocationId: randomUUID()
      },
      ...(index < HOOK_RECEIPT_LIMIT - 1 ? { result: {} } : {})
    }))
    writeDurableJson(join(root, 'hooks.json'), entries)
    const fault = vi.fn()
    const deliver = vi.fn(async () => ({}))
    const gateway = await startHookGateway(root, deliver, fault)
    cleanup.push(() => gateway.close())
    expect(fault).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Hook inbox capacity reached.' })
    )
    await gateway.flush()
    expect(deliver).toHaveBeenCalledOnce()
    expect(fault.mock.calls.every(([error]) => error instanceof Error)).toBe(true)
    const socket = connect(join(root, 'run/mcp.sock'))
    await once(socket, 'connect')
    const closed = once(socket, 'close')
    socket.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempad/client-hook',
        params: { ...entries[0]!.input, invocationId: randomUUID() }
      }) + '\n'
    )
    await closed
    expect(deliver).toHaveBeenCalledOnce()
    expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries).toHaveLength(
      HOOK_RECEIPT_LIMIT
    )
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps a received event when a legacy hook exits at its deadline',
  async () => {
    const root = directory()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const deliver = vi.fn(async () => {
      await gate
      return { applied: true }
    })
    const gateway = await startHookGateway(root, deliver)
    cleanup.push(async () => {
      release()
      await gateway.close()
    })
    const socket = connect(join(root, 'run/mcp.sock'))
    await once(socket, 'connect')
    socket.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tempad/client-hook',
        params: {
          version: 1,
          kind: 'claude',
          sessionId: 'session',
          event: 'SessionEnd',
          invocationId: randomUUID()
        }
      }) + '\n'
    )
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce())
    await delay(800)
    const closed = once(socket, 'close')
    socket.destroy()
    await closed
    release()
    await gateway.flush()
    expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries[0].result).toEqual({
      applied: true
    })
    expect(deliver).toHaveBeenCalledOnce()
  }
)
