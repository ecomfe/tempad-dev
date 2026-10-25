import { CLIENT_HOOK_RETENTION_MS, type ClientHook } from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import { AgentClients } from '../src/agent-clients/registry'
import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { writeDurableJson } from '../src/durable-json'
import { EXPIRED_HOOK_RESULT, HOOK_RECEIPT_LIMIT } from '../src/hook-receipts'
import { startHookGateway } from '../src/runtime-prototype/hooks'

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
  const root = mkdtempSync('/tmp/tp-hook-expiry-')
  mkdirSync(join(root, 'run'), { mode: 0o700 })
  cleanup.push(() => rmSync(root, { force: true, recursive: true }))
  return root
}
function hook(
  event: ClientHook['event'] = 'Stop',
  issuedAt = Date.now()
): Extract<ClientHook, { version: 2 }> {
  return {
    version: 2,
    kind: 'claude',
    sessionId: 'old-session',
    event,
    invocationId: randomUUID(),
    profile: { kind: 'release' },
    issuedAt
  }
}
function runtime(root: string) {
  const store = new DesignTaskStore(join(root, 'tasks.json'))
  const tasks = new DesignTasks({
    store,
    createId: randomUUID,
    now: () => Date.now(),
    leaseMs: 2 * CLIENT_HOOK_RETENTION_MS
  })
  tasks.restore()
  const clients = new AgentClients(tasks)
  cleanup.push(() => clients.close())
  const apply = vi.fn((input: ClientHook) => clients.clientHook(input))
  const deliver = async (input: ClientHook) =>
    tasks.applyHook(
      input.invocationId,
      input,
      () => apply(input),
      () => clients.retireHook(input)
    )
  return { store, tasks, clients, apply, deliver }
}
async function request(root: string, input: ClientHook) {
  const socket = connect(join(root, 'run/mcp.sock'))
  await once(socket, 'connect')
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

it.skipIf(process.platform === 'win32')(
  'retires a legitimately admitted hook after offline expiry, then admits fresh sessions across restarts',
  async () => {
    const root = directory()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const input = hook()
    const before = runtime(root)
    const task = before.tasks.begin('owner', 'extension', session, 'Work', 'begin', {
      kind: 'claude',
      name: 'Claude',
      sessionId: input.sessionId
    })
    before.tasks.stop(task.task.taskId, 'cancelled', { sessionId: input.sessionId })
    before.tasks.requireFileRead(session.fileKey, true)
    before.tasks.saveExecutions([
      {
        id: 'uncertain-write',
        revision: randomUUID(),
        recordedAt: now,
        receipt: { generation: 'generation', receiptId: 'receipt' },
        extensionId: 'extension',
        browserId: 'browser',
        origin: 'chrome-extension://owner',
        session,
        taskId: task.task.taskId,
        handoff: true
      }
    ])

    const failed = await startHookGateway(root, async () => {
      throw new Error('Hub crashed')
    })
    expect((await request(root, input)).result.receipt.state).toBe('accepted')
    await expect(failed.flush()).rejects.toThrow('Hub crashed')
    await failed.close()
    now += CLIENT_HOOK_RETENTION_MS + 1

    const after = runtime(root)
    const fault = vi.fn()
    const recovered = await startHookGateway(root, after.deliver, fault)
    const fresh = { ...hook('UserPromptSubmit'), sessionId: 'fresh-session' }
    expect((await request(root, fresh)).result.receipt.state).toBe('accepted')
    await recovered.flush()
    expect(after.apply.mock.calls.map(([event]) => event.invocationId)).toEqual([
      fresh.invocationId
    ])
    expect(fault).toHaveBeenLastCalledWith(undefined)
    const entries = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries
    expect(
      entries.find(
        (entry: { input: ClientHook }) => entry.input.invocationId === input.invocationId
      )
    ).toMatchObject({ retired: 'expired' })
    expect((await request(root, input)).error.message).toContain('cannot be replayed')
    expect(after.tasks.find(task.task.taskId)).toMatchObject({
      task: { status: 'cancelled' },
      claudeStopNotice: { sessionId: input.sessionId }
    })
    expect(after.tasks.needsFileRead(session.fileKey)).toBe(true)
    expect(() => after.tasks.checkOperation('fresh-owner', session, undefined, true)).toThrow(
      'earlier operation'
    )
    await recovered.close()

    const restarted = runtime(root)
    const gateway = await startHookGateway(root, restarted.deliver)
    cleanup.push(() => gateway.close())
    await gateway.flush()
    expect(restarted.apply).not.toHaveBeenCalled()
    expect((await request(root, input)).error.message).toContain('expired')
    expect(restarted.tasks.executionState()).toHaveLength(1)
    expect(restarted.tasks.find(task.task.taskId)?.task.status).toBe('cancelled')
  }
)

it('does not acknowledge retirement before its task fences are durable, and does not repeat an uncertain effect', async () => {
  const current = runtime(directory())
  const issuedAt = Date.now()
  const input = hook('Interrupt', issuedAt)
  const record = current.tasks.begin('owner', 'extension', session, 'Work', 'begin', {
    kind: 'claude',
    name: 'Claude',
    sessionId: input.sessionId
  })
  const apply = vi.fn(() => {
    current.tasks.requireFileRead(session.fileKey)
    throw new Error('lost lifecycle outcome')
  })
  expect(() => current.tasks.applyHook(input.invocationId, input, apply)).toThrow(
    'lost lifecycle outcome'
  )
  vi.spyOn(Date, 'now').mockReturnValue(issuedAt + CLIENT_HOOK_RETENTION_MS + 1)
  vi.spyOn(current.store, 'save').mockImplementationOnce(() => {
    throw new Error('ENOSPC')
  })
  await expect(current.deliver(input)).rejects.toThrow('cannot be flushed')
  expect(
    current.store
      .load()
      ?.hookReceipts?.find((receipt) => receipt.invocationId === input.invocationId)?.retired
  ).toBeUndefined()
  expect(await current.deliver(input)).toEqual(EXPIRED_HOOK_RESULT)
  expect(current.tasks.find(record.task.taskId)?.task.status).toBe('paused')
  expect(current.tasks.needsFileRead(session.fileKey)).toBe(true)
  expect(current.store.load()?.hookReceipts).toEqual([
    expect.objectContaining({
      retired: 'expired',
      error: 'Error: lost lifecycle outcome',
      result: EXPIRED_HOOK_RESULT
    })
  ])
  expect(apply).toHaveBeenCalledOnce()
  expect(current.apply).not.toHaveBeenCalled()
})

it.skipIf(process.platform === 'win32')(
  'does not retain a capacity fault after durable retirement',
  async () => {
    const root = directory()
    const input = hook('Stop', Date.now() - CLIENT_HOOK_RETENTION_MS - 1)
    writeDurableJson(join(root, 'hooks.json'), {
      version: 2,
      cutoff: 0,
      entries: Array.from({ length: HOOK_RECEIPT_LIMIT }, (_, index) => ({
        input: { ...input, invocationId: randomUUID() },
        ...(index ? { result: {} } : {})
      }))
    })
    const fault = vi.fn()
    const gateway = await startHookGateway(root, async () => EXPIRED_HOOK_RESULT, fault)
    cleanup.push(() => gateway.close())
    expect(fault).toHaveBeenLastCalledWith(expect.any(Error))
    await gateway.flush()
    expect(fault).toHaveBeenLastCalledWith(undefined)
  }
)

it.each([false, true])(
  'retirement preserves newer lifecycle evidence=%s without reviving the old event',
  async (freshEvidence) => {
    const current = runtime(directory())
    const old = hook('SessionEnd', Date.now() - CLIENT_HOOK_RETENTION_MS - 1)
    current.clients.event('connection', {
      method: 'notifications/tempad/client-event',
      params: { event: 'connect', kind: 'claude', sessionId: old.sessionId }
    })
    // Model a live receiver whose earlier binding predates the queued event.
    current.clients.clientHook({ ...old, event: 'UserPromptSubmit', issuedAt: old.issuedAt - 1 })
    const owner = await current.clients.owner('connection', undefined, { name: 'claude-code' })
    const record = current.tasks.begin(owner, 'extension', session, 'Work', 'begin', {
      kind: 'claude',
      name: 'Claude',
      sessionId: old.sessionId
    })
    current.tasks.confirm(record.task.taskId, owner)
    if (freshEvidence)
      current.clients.clientHook({ ...hook('UserPromptSubmit'), sessionId: old.sessionId })
    expect(await current.deliver(old)).toEqual(EXPIRED_HOOK_RESULT)
    expect(record.task.status).toBe(freshEvidence ? 'active' : 'paused')
    const nextOwner = await current.clients.owner('connection', undefined, { name: 'claude-code' })
    expect((await current.clients.describe(nextOwner)).client.sessionId).toBe(
      freshEvidence ? old.sessionId : undefined
    )
    expect(current.apply).not.toHaveBeenCalled()
  }
)
