import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { CLIENT_HOOK_RETENTION_MS, type ClientHook } from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import { AgentClients } from '../src/agent-clients/registry'
import { DesignTaskStore, type DesignTaskSnapshot } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { writeDurableJson } from '../src/durable-json'
import {
  EXPIRED_HOOK_RESULT,
  HOOK_RECEIPT_LIMIT,
  hookSignature,
  hookPressureCutoff,
  LEGACY_HOOK_EXHAUSTED_RESULT
} from '../src/hook-receipts'
import { ensurePrivateDirectory, runtimeEndpoint } from '../src/runtime-platform'
import { startHookGateway } from '../src/runtime-prototype/hooks'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import { connectSocket, listenPrivate } from '../src/runtime-prototype/processes'
import { ControlPeer, SocketTransport } from '../src/runtime-prototype/protocol'

const platformModule = '../scripts/runtime-test-platform.mjs'
const { fixtureRoot } = await import(platformModule)
const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

async function directory() {
  const root = (await fixtureRoot('tp-hook-history-')) as string
  ensurePrivateDirectory(join(root, 'run'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function hook(version: 1 | 2, issuedAt = Date.now()): ClientHook {
  const input = {
    kind: 'claude' as const,
    sessionId: 'session',
    event: 'UserPromptSubmit' as const,
    invocationId: randomUUID()
  }
  return version === 1
    ? { ...input, version }
    : { ...input, version, issuedAt, profile: { kind: 'release' } }
}

async function request(root: string, input: ClientHook) {
  const socket = await connectSocket(runtimeEndpoint(join(root, 'run'), 'mcp.sock'))
  const reply = once(socket, 'data')
  socket.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params: input }) + '\n'
  )
  try {
    return JSON.parse(String((await reply)[0]))
  } finally {
    socket.destroy()
  }
}

it.each([1, 2] as const)(
  'reclaims full completed v%s history before opening the gateway and never reauthorizes its replay',
  async (version) => {
    const root = await directory()
    const now = Date.now()
    const issuedAt = now - CLIENT_HOOK_RETENTION_MS - 1
    const entries = Array.from({ length: HOOK_RECEIPT_LIMIT }, () => ({
      input: hook(version, issuedAt),
      result: { output: 'old result' }
    }))
    writeDurableJson(join(root, 'hooks.json'), { version: 2, cutoff: 0, entries })
    const deliver = vi.fn(async () => ({}))
    const fault = vi.fn()
    const retire = vi.fn(async () => {})
    const gateway = await startHookGateway(root, deliver, fault, undefined, retire)
    cleanup.push(() => gateway.close())
    expect(gateway.pending).toBe(false)
    await gateway.flush()
    expect(fault).toHaveBeenLastCalledWith(undefined)
    expect(deliver).not.toHaveBeenCalled()
    expect(retire).toHaveBeenCalledTimes(version === 1 ? 1 : 0)
    const stored = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'))
    expect(stored.cutoff).toBeGreaterThanOrEqual(issuedAt)
    if (version === 2) expect(stored.entries).toEqual([])
    else {
      expect(stored.entries).toHaveLength(HOOK_RECEIPT_LIMIT)
      expect(
        stored.entries.every(
          (entry: { retired?: string; result?: unknown }) =>
            entry.retired === 'expired' && entry.result === undefined
        )
      ).toBe(true)
    }
    await gateway.close()
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt)
    const restarted = await startHookGateway(root, deliver, fault, undefined, retire)
    cleanup.push(() => restarted.close())
    await restarted.flush()
    expect((await request(root, entries[0]!.input)).error.message).toContain('expired')
    expect(fault).toHaveBeenLastCalledWith(undefined)
    expect(deliver).not.toHaveBeenCalled()
  }
)

it('bounds a full recent v2 response cache with a durable pressure cutoff, without replaying old results', async () => {
  const root = await directory()
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const entries = Array.from({ length: HOOK_RECEIPT_LIMIT }, (_, index) => ({
    input: hook(2, now - HOOK_RECEIPT_LIMIT + index),
    result: { output: 'retained Stop output' }
  }))
  writeDurableJson(join(root, 'hooks.json'), { version: 2, cutoff: 0, entries })
  const fault = vi.fn()
  const deliver = vi.fn(async () => ({ output: 'new Stop output' }))
  const gateway = await startHookGateway(root, deliver, fault)
  cleanup.push(() => gateway.close())
  await gateway.flush()
  expect((await request(root, hook(2, now + 1))).error.data.code).toBe('MCP_HOOK_CLOCK_AHEAD')
  expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries).toEqual(entries)
  const input = hook(2)
  await request(root, input)
  await gateway.flush()
  expect((await request(root, input)).result.output).toBe('new Stop output')
  expect((await request(root, entries[0]!.input)).error.message).toContain('expired')
  expect((await request(root, entries[1]!.input)).result.output).toBe('retained Stop output')
  const stored = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'))
  expect(stored.entries).toHaveLength(HOOK_RECEIPT_LIMIT)
  now -= HOOK_RECEIPT_LIMIT
  expect((await request(root, entries[0]!.input)).error.message).toContain('expired')
  expect(deliver).toHaveBeenCalledOnce()
  expect(fault).toHaveBeenLastCalledWith(undefined)
})

it('keeps a full pending inbox and its fault even when the events are old', async () => {
  const root = await directory()
  const entries = Array.from({ length: HOOK_RECEIPT_LIMIT }, () => ({
    input: hook(2, Date.now() - CLIENT_HOOK_RETENTION_MS - 1)
  }))
  writeDurableJson(join(root, 'hooks.json'), { version: 2, cutoff: 0, entries })
  const fault = vi.fn()
  const deliver = vi.fn(async () => ({}))
  const gateway = await startHookGateway(root, deliver, fault)
  cleanup.push(() => gateway.close())
  expect(gateway.pending).toBe(true)
  expect(fault).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: 'Hook inbox capacity reached.' })
  )
  expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries).toEqual(entries)
  expect(deliver).not.toHaveBeenCalled()
})

it.each([1, 2] as const)(
  'reclaims completed v%s task receipts across restart without clearing an uncertain receipt',
  async (version) => {
    const root = await directory()
    const path = join(root, 'tasks.json')
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const old = now - CLIENT_HOOK_RETENTION_MS - 1
    const inputs = Array.from({ length: HOOK_RECEIPT_LIMIT }, () => hook(version, old))
    const uncertain = hook(1)
    writeDurableJson(path, {
      revision: 0,
      current: {},
      records: [],
      hookReceiptCutoff: 0,
      hookReceipts: [
        ...inputs.map((input) => ({
          invocationId: input.invocationId,
          signature: hookSignature(input),
          recordedAt: old,
          ...(input.version === 2 ? { issuedAt: input.issuedAt } : {}),
          result: { output: 'old result' }
        })),
        {
          invocationId: uncertain.invocationId,
          signature: hookSignature(uncertain),
          recordedAt: old,
          result: {},
          error: 'uncertain effect'
        }
      ]
    })
    const store = new DesignTaskStore(path)
    const tasks = new DesignTasks({ store, createId: randomUUID })
    tasks.restore()
    const input = hook(version)
    const apply = vi.fn(() => ({ output: 'Stop' }))
    if (version === 1)
      expect(() => tasks.applyHook(input.invocationId, input, apply)).toThrow(
        'Update the TemPad Dev plugin'
      )
    else expect(tasks.applyHook(input.invocationId, input, apply)).toEqual({ output: 'Stop' })
    expect(() => tasks.applyHook(uncertain.invocationId, uncertain, apply)).toThrow(
      'remains uncertain'
    )
    const saved = store.load()!
    expect(saved.hookReceiptCutoff).toBeGreaterThanOrEqual(old)
    if (version === 1) {
      expect(saved.hookReceipts?.filter((receipt) => receipt.retired)).toHaveLength(
        HOOK_RECEIPT_LIMIT
      )
      expect(
        saved.hookReceipts?.find((receipt) => receipt.invocationId === inputs[0]!.invocationId)
          ?.result
      ).toEqual(EXPIRED_HOOK_RESULT)
    } else expect(saved.hookReceipts).toHaveLength(2)
    now = old
    const restarted = new DesignTasks({ store, createId: randomUUID })
    restarted.restore()
    if (version === 1)
      expect(restarted.applyHook(inputs[0]!.invocationId, inputs[0], apply)).toEqual(
        EXPIRED_HOOK_RESULT
      )
    else
      expect(() => restarted.applyHook(inputs[0]!.invocationId, inputs[0], apply)).toThrow(
        'expired'
      )
    expect(apply).toHaveBeenCalledTimes(version === 1 ? 0 : 1)
  }
)

it('retains a full legacy fence until scoped retirement is durable, then permits v2 without growing legacy history', async () => {
  const root = await directory()
  const entries = Array.from({ length: HOOK_RECEIPT_LIMIT }, () => ({ input: hook(1), result: {} }))
  writeDurableJson(join(root, 'hooks.json'), { version: 2, cutoff: 0, entries })
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  const tasks = new DesignTasks({ store, createId: randomUUID })
  const clients = new AgentClients(tasks)
  cleanup.push(() => clients.close())
  const legacy = { ...hook(1), sessionId: 'legacy' }
  const modern = { ...hook(2), sessionId: 'modern' }
  for (const input of [legacy, modern]) clients.clientHook(input)
  const session = {
    sessionId: 'figma',
    fileKey: 'file',
    fileName: 'File',
    pageId: '0:1',
    busy: false
  }
  const legacyTask = tasks.begin('legacy-owner', 'extension', session, 'Legacy', 'legacy-begin', {
    kind: 'claude',
    name: 'Claude',
    sessionId: legacy.sessionId
  })
  const modernTask = tasks.begin(
    'modern-owner',
    'extension',
    { ...session, fileKey: 'modern-file' },
    'Modern',
    'modern-begin',
    { kind: 'claude', name: 'Claude', sessionId: modern.sessionId }
  )
  const stopped = tasks.begin(
    'stopped-owner',
    'extension',
    { ...session, fileKey: 'stopped-file' },
    'Stopped',
    'stop-begin',
    { kind: 'claude', name: 'Claude', sessionId: legacy.sessionId }
  )
  tasks.stop(stopped.task.taskId, 'cancelled', { sessionId: legacy.sessionId })
  const fault = vi.fn()
  const retire = vi.fn(async () => {
    clients.retireLegacyHooks()
    tasks.flush()
  })
  const deliver = vi.fn(async (input: ClientHook) => clients.clientHook(input))
  const gateway = await startHookGateway(root, deliver, fault, undefined, retire)
  cleanup.push(() => gateway.close())
  const saving = vi.spyOn(store, 'save').mockImplementation(() => {
    throw new Error('ENOSPC')
  })
  await expect(gateway.flush()).rejects.toThrow('cannot be flushed')
  expect(fault).toHaveBeenLastCalledWith(expect.any(Error))
  saving.mockRestore()
  await gateway.flush()
  expect(fault).toHaveBeenLastCalledWith(undefined)
  expect(retire).toHaveBeenCalledTimes(2)
  expect(legacyTask.task.status).toBe('paused')
  expect(modernTask.task.status).toBe('active')
  expect(stopped).toMatchObject({
    task: { status: 'cancelled' },
    claudeStopNotice: { sessionId: legacy.sessionId }
  })
  expect(
    store.load()?.records.find((record) => record.task.taskId === legacyTask.task.taskId)?.task
      .status
  ).toBe('paused')
  expect((await request(root, hook(1))).error.data.code).toBe('MCP_HOOK_LEGACY_UPGRADE_REQUIRED')
  expect(deliver).not.toHaveBeenCalled()
  await request(root, { ...hook(2), sessionId: 'legacy' })
  await gateway.flush()
  expect(deliver).toHaveBeenCalledOnce()
  expect(retire).toHaveBeenCalledTimes(2)
  clients.event('edge', {
    method: 'notifications/tempad/client-event',
    params: { event: 'connect', kind: 'claude', sessionId: legacy.sessionId }
  })
  expect(await clients.owner('edge', undefined, { name: 'claude-code' })).toBe('edge/claude/legacy')
  gateway.setReceiver(randomUUID())
  await gateway.flush()
  expect(retire).toHaveBeenCalledTimes(3)
  expect(
    JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries.filter(
      (entry: { input: ClientHook }) => entry.input.version === 1
    )
  ).toHaveLength(HOOK_RECEIPT_LIMIT)
})

it('drains events received while legacy retirement is awaiting durability', async () => {
  const root = await directory()
  writeDurableJson(join(root, 'hooks.json'), {
    version: 2,
    cutoff: 0,
    entries: Array.from({ length: HOOK_RECEIPT_LIMIT }, () => ({
      input: hook(1),
      retired: 'expired'
    }))
  })
  const waiting = Promise.withResolvers<void>()
  const retire = vi.fn(() => waiting.promise)
  const deliver = vi.fn(async () => ({}))
  const fault = vi.fn()
  const gateway = await startHookGateway(root, deliver, fault, undefined, retire)
  cleanup.push(() => gateway.close())
  const flush = gateway.flush()
  await vi.waitFor(() => expect(retire).toHaveBeenCalledOnce())
  const pendingStop = { ...hook(2), event: 'Stop' as const }
  expect((await request(root, pendingStop)).result.receipt.state).toBe('accepted')
  waiting.resolve()
  await flush
  expect(deliver).toHaveBeenCalledExactlyOnceWith(pendingStop, undefined)
  expect(gateway.pending).toBe(false)
  expect(fault).toHaveBeenLastCalledWith(undefined)
})

it('preserves Hub-reported legacy exhaustion when its gateway history was shorter', async () => {
  const root = await directory()
  const deliver = vi.fn(async () => LEGACY_HOOK_EXHAUSTED_RESULT)
  const retire = vi.fn(async () => {})
  const gateway = await startHookGateway(root, deliver, undefined, undefined, retire)
  cleanup.push(() => gateway.close())
  expect((await request(root, hook(1))).error.data.code).toBe('MCP_HOOK_LEGACY_UPGRADE_REQUIRED')
  expect(gateway.legacyExhausted).toBe(true)
  await gateway.close()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + CLIENT_HOOK_RETENTION_MS + 1)
  const restarted = await startHookGateway(root, deliver, undefined, undefined, retire)
  cleanup.push(() => restarted.close())
  await restarted.flush()
  expect(restarted.legacyExhausted).toBe(true)
  expect((await request(root, hook(1))).error.data.code).toBe('MCP_HOOK_LEGACY_UPGRADE_REQUIRED')
  expect(deliver).toHaveBeenCalledOnce()
})

it('processes more than 4096 v2 effects with bounded receipts and no replay under pressure', async () => {
  const root = await directory()
  let now = Date.now()
  let saved: DesignTaskSnapshot | undefined
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  vi.spyOn(store, 'save').mockImplementation((snapshot) => {
    saved = snapshot
  })
  const tasks = new DesignTasks({ store, now: () => now, createId: randomUUID })
  const first = hook(2, now)
  let last = first
  const apply = vi.fn(() => ({ output: 'Stop' }))
  for (let index = 0; index <= HOOK_RECEIPT_LIMIT; index++) {
    last = index ? hook(2, ++now) : first
    expect(tasks.applyHook(last.invocationId, last, apply)).toEqual({ output: 'Stop' })
  }
  expect(saved?.hookReceipts).toHaveLength(HOOK_RECEIPT_LIMIT)
  expect(() => tasks.applyHook(first.invocationId, first, apply)).toThrow('expired')
  expect(tasks.applyHook(last.invocationId, last, apply)).toEqual({ output: 'Stop' })
  expect(apply).toHaveBeenCalledTimes(HOOK_RECEIPT_LIMIT + 1)
})

it('does not pressure-expire an uncertain effect to make space for a new hook', async () => {
  const root = await directory()
  const now = Date.now()
  const uncertain = hook(2, now - 1000)
  const completed = Array.from({ length: HOOK_RECEIPT_LIMIT - 1 }, () => hook(2, now - 500))
  const path = join(root, 'tasks.json')
  const hookReceipts = [uncertain, ...completed].map((input, index) => ({
    invocationId: input.invocationId,
    signature: hookSignature(input),
    issuedAt: input.version === 2 ? input.issuedAt : undefined,
    recordedAt: now,
    result: {},
    ...(index ? {} : { error: 'unknown effect' })
  }))
  writeDurableJson(path, {
    revision: 0,
    current: {},
    records: [],
    hookReceiptCutoff: 0,
    hookReceipts
  })
  const store = new DesignTaskStore(path)
  const tasks = new DesignTasks({ store, now: () => now, createId: randomUUID })
  tasks.restore()
  const apply = vi.fn(() => ({}))
  const fresh = hook(2, now)
  expect(() => tasks.applyHook(fresh.invocationId, fresh, apply)).toThrow(
    'uncertain lifecycle effects'
  )
  expect(() => tasks.applyHook(uncertain.invocationId, uncertain, apply)).toThrow(
    'remains uncertain'
  )
  expect(store.load()?.hookReceipts).toEqual(hookReceipts)
  expect(apply).not.toHaveBeenCalled()
})

it('authenticates scoped legacy retirement and acknowledges only after its fences flush', async () => {
  const root = await directory()
  const secret = randomUUID()
  const retire = vi.fn()
  const flush = vi.fn().mockImplementationOnce(() => {
    throw new Error('fsync failed')
  })
  const control = new HubControl(secret, undefined, {
    inspect: () => ({
      drained: true,
      blockers: [],
      deadline: Date.now() + 1000,
      version: '0.12.0'
    }),
    stop: async () => {},
    hook: () => ({}),
    retireLegacyHooks: retire,
    flush
  })
  const sockets = new Set<Socket>()
  const path = runtimeEndpoint(join(root, 'run'), 'control.sock')
  const server = createServer((socket) => {
    sockets.add(socket)
    void control.attach(socket)
  })
  await listenPrivate(server, path)
  const owner = new ControlPeer()
  const stranger = new ControlPeer()
  cleanup.push(async () => {
    await owner.close()
    await stranger.close()
    await control.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  await owner.connect(new SocketTransport(await connectSocket(path)))
  await stranger.connect(new SocketTransport(await connectSocket(path)))
  const request = { method: 'tempad/runtime-retire-legacy-hooks' }
  await expect(stranger.request(request, ResultSchema)).rejects.toThrow()
  expect(retire).not.toHaveBeenCalled()
  await owner.request(
    { method: 'tempad/runtime-acquire', params: { secret, versions: [2] } },
    LeaseSchema
  )
  await expect(owner.request(request, ResultSchema)).rejects.toThrow('fsync failed')
  expect(await owner.request(request, ResultSchema)).toEqual({})
  expect(retire).toHaveBeenCalledTimes(2)
  expect(flush).toHaveBeenCalledTimes(2)
})

it('retires an expired pending event even when recent results occupy every receipt slot', async () => {
  const root = await directory()
  const now = Date.now()
  const path = join(root, 'tasks.json')
  const hookReceipts = Array.from({ length: HOOK_RECEIPT_LIMIT }, () => {
    const input = hook(2, now)
    return {
      invocationId: input.invocationId,
      signature: hookSignature(input),
      issuedAt: now,
      recordedAt: now,
      result: {}
    }
  })
  writeDurableJson(path, {
    revision: 0,
    current: {},
    records: [],
    hookReceiptCutoff: 0,
    hookReceipts
  })
  const store = new DesignTaskStore(path)
  const tasks = new DesignTasks({ store, now: () => now, createId: randomUUID })
  tasks.restore()
  const expired = { ...hook(2, now - CLIENT_HOOK_RETENTION_MS - 1), event: 'Stop' as const }
  const apply = vi.fn(() => ({}))
  expect(
    tasks.applyHook(expired.invocationId, expired, apply, () => tasks.requireFileRead('file'))
  ).toEqual(EXPIRED_HOOK_RESULT)
  expect(store.load()?.hookReceipts).toEqual(hookReceipts)
  const restarted = new DesignTasks({
    store,
    now: () => now - CLIENT_HOOK_RETENTION_MS,
    createId: randomUUID
  })
  restarted.restore()
  expect(restarted.needsFileRead('file')).toBe(true)
  expect(() => restarted.applyHook(expired.invocationId, expired, apply)).toThrow('expired')
  expect(apply).not.toHaveBeenCalled()
})

it('expires a complete timestamp cohort only when no member is unresolved', () => {
  const issuedAt = Date.now()
  expect(hookPressureCutoff(0, Array(HOOK_RECEIPT_LIMIT).fill(issuedAt), [])).toBe(issuedAt)
  expect(hookPressureCutoff(0, Array(HOOK_RECEIPT_LIMIT - 1).fill(issuedAt), [issuedAt])).toBe(
    issuedAt - 1
  )
})

it('keeps an expired event pending through a partial retirement and a failed flush, without claiming application', async () => {
  const root = await directory()
  const old = { ...hook(2, Date.now() - CLIENT_HOOK_RETENTION_MS - 1), event: 'Stop' as const }
  writeDurableJson(join(root, 'hooks.json'), { version: 2, cutoff: 0, entries: [{ input: old }] })
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  const tasks = new DesignTasks({ store, createId: randomUUID })
  const apply = vi.fn(() => ({}))
  const retire = vi.fn(() => {
    tasks.requireFileRead('file')
    if (retire.mock.calls.length === 1) throw new Error('retirement interrupted after mutation')
  })
  const fault = vi.fn()
  const gateway = await startHookGateway(
    root,
    async (input) => tasks.applyHook(input.invocationId, input, apply, retire),
    fault
  )
  cleanup.push(() => gateway.close())
  await expect(gateway.flush()).rejects.toThrow('retirement interrupted')
  expect(gateway.pending).toBe(true)
  expect(fault).toHaveBeenLastCalledWith(expect.any(Error))
  const saving = vi.spyOn(store, 'save').mockImplementation(() => {
    throw new Error('ENOSPC')
  })
  await expect(gateway.flush()).rejects.toThrow('cannot be flushed')
  expect(gateway.pending).toBe(true)
  expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries).toEqual([
    { input: old }
  ])
  saving.mockRestore()
  await gateway.flush()
  expect(gateway.pending).toBe(false)
  expect(fault).toHaveBeenLastCalledWith(undefined)
  expect(store.load()?.filesNeedingRead).toContain('file')
  expect(store.load()?.hookReceipts).toBeUndefined()
  expect(retire).toHaveBeenCalledTimes(3)
  expect(apply).not.toHaveBeenCalled()
  const stored = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'))
  expect(stored.entries[0]).toMatchObject({ retired: 'expired', result: EXPIRED_HOOK_RESULT })
})
