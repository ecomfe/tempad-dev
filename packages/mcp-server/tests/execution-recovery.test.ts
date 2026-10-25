import type { WebSocket } from 'ws'

import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ExtensionConnection } from '../src/types'

import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { connectSocket, listenPrivate } from '../src/runtime-prototype/processes'
import { ControlPeer, SocketTransport } from '../src/runtime-prototype/protocol'
import { attachRuntimeRecovery, runRuntimeRecovery } from '../src/runtime-recovery'
import { TerminalReceipts } from '../src/terminal-receipts'

const session = {
  sessionId: 'page',
  fileKey: 'file',
  fileName: 'File',
  pageId: '1:1',
  busy: false,
  tabId: 1,
  documentId: 'document'
}
const extension: ExtensionConnection = {
  id: 'original',
  ws: {} as WebSocket,
  origin: 'chrome-extension://owner',
  connectedAt: '',
  runtime: {
    protocolVersion: 15,
    version: '1',
    fingerprint: 'a'.repeat(64),
    terminalReceipts: true,
    durableTerminalReceipts: true
  },
  sessions: { type: 'sessions', browserId: 'browser', activeSessionId: 'page', sessions: [session] }
}
let root: string
let server: Server | undefined
const peers: ControlPeer[] = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tpd-execution-'))
})
afterEach(async () => {
  await Promise.all(peers.splice(0).map((peer) => peer.close()))
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
  rmSync(root, { recursive: true, force: true })
})
function runtime() {
  const tasks = new DesignTasks({
    createId: () => 'task',
    store: new DesignTaskStore(join(root, 'tasks.json'))
  })
  tasks.restore()
  const receipts = new TerminalReceipts((records) => tasks.saveExecutions(records))
  receipts.restore(tasks.executionState())
  return { tasks, receipts }
}
function reserve(receipts: TerminalReceipts) {
  return {
    type: 'toolCompletion' as const,
    id: 'call',
    ...receipts.reserve('call', extension, session, 'task', true)!
  }
}
async function listen(receipts: TerminalReceipts) {
  const path = join(root, 'recover.sock')
  server = createServer((socket) => {
    void attachRuntimeRecovery(socket, receipts, () => {}).then((peer) => peers.push(peer))
  })
  await listenPrivate(server, path)
  return () => connectSocket(path)
}

describe('durable execution exclusion and operator recovery', () => {
  it('retires a disconnected read but retains an unknown write for handoff', () => {
    const { receipts } = runtime()
    receipts.reserve('read', extension, session, undefined, false)
    reserve(receipts)
    expect(receipts.canHandoff()).toBe(false)
    receipts.disconnect(extension.id)
    expect(receipts.canHandoff()).toBe(true)
    expect([...receipts.transferableIds()]).toEqual(['call'])
    expect(runtime().receipts.pendingCount).toBe(1)
  })

  it('survives cold restart and reads, accepts only the original receipt, then requires readback', () => {
    const original = runtime()
    const completion = reserve(original.receipts)
    const next = runtime()
    expect(next.receipts.generation).not.toBe(completion.generation)
    expect(() => next.tasks.checkOperation('owner', session, undefined, false)).not.toThrow()
    next.tasks.acknowledgeFileRead('file')
    expect(() => next.tasks.checkOperation('owner', session, undefined, true)).toThrow(
      'earlier operation'
    )
    expect(
      next.receipts.accept(completion, {
        ...extension,
        sessions: { ...extension.sessions!, browserId: 'different' }
      })
    ).toEqual({ accepted: false })
    expect(next.receipts.accept(completion, { ...extension, id: 'new-connection' })).toMatchObject({
      accepted: true,
      recovered: { id: 'call' }
    })
    expect(() => next.tasks.checkOperation('owner', session, undefined, true)).toThrow(
      'previous write'
    )
    const restarted = runtime()
    expect(restarted.receipts.status()).toEqual([])
    restarted.tasks.acknowledgeFileRead('file')
    expect(() => restarted.tasks.checkOperation('owner', session, undefined, true)).not.toThrow()
  })

  it('keeps old/unknown peers blocked but does not claim their execution can cross a planned switch', () => {
    const { receipts } = runtime()
    expect(
      receipts.reserve('call', { ...extension, runtime: undefined }, session, undefined, true)
    ).toBeUndefined()
    expect(receipts.canHandoff()).toBe(false)
    const next = runtime()
    expect(next.receipts.status()).toHaveLength(1)
    next.receipts.reconcile({
      ...extension,
      sessions: { ...extension.sessions!, browserId: 'other', openTabIds: [] }
    })
    expect(next.receipts.pendingCount).toBe(1)
    next.receipts.reconcile({ ...extension, sessions: { ...extension.sessions!, openTabIds: [] } })
    expect(runtime().receipts.pendingCount).toBe(0)
  })

  it('persists abandonment with Stop and read fences, rejects stale confirmations and late receipts', () => {
    const { tasks, receipts } = runtime()
    tasks.begin('owner', extension.id, session, 'Work', 'begin')
    tasks.stop('task', 'cancelled')
    const completion = reserve(receipts)
    const block = receipts.status()[0]!
    expect(() => receipts.abandon('call', crypto.randomUUID())).toThrow('changed')
    expect(receipts.abandon('call', block.revision)).toMatchObject({ id: 'call' })
    expect(receipts.abandon('call', block.revision)).toBeUndefined()
    expect(receipts.accept(completion, extension)).toEqual({ accepted: false })
    const next = runtime()
    expect(next.tasks.find('task')?.task.status).toBe('cancelled')
    expect(next.tasks.needsFileRead('file')).toBe(true)
    expect(next.receipts.abandon('call', block.revision)).toBeUndefined()
    next.tasks.acknowledgeFileRead('file')
    next.receipts.reserve('read', extension, session, undefined, false)
    next.receipts.settle('read', extension.id)
    expect(next.tasks.needsFileRead('file')).toBe(false)
    expect(() => next.tasks.checkOperation('owner', session, undefined, true)).toThrow(
      'stopped task'
    )
  })

  it('does not dispatch or release a block when persistence fails', () => {
    const save = vi.fn(() => {})
    const receipts = new TerminalReceipts(save)
    save.mockImplementationOnce(() => {
      throw new Error('ENOSPC')
    })
    expect(() => reserve(receipts)).toThrow('ENOSPC')
    expect(receipts.status()).toEqual([])
    const completion = reserve(receipts)
    const block = receipts.status()[0]!
    for (const operation of [
      () => receipts.abandon('call', block.revision),
      () => receipts.accept(completion, extension)
    ]) {
      save.mockImplementationOnce(() => {
        throw new Error('ENOSPC')
      })
      expect(operation).toThrow('ENOSPC')
      expect(receipts.status()).toEqual([block])
    }
  })

  it('offers redacted status but refuses noninteractive or declined recovery', async () => {
    const { receipts } = runtime()
    const completion = reserve(receipts)
    const connect = await listen(receipts)
    const io = { interactive: false, write: vi.fn(), confirm: vi.fn(async () => 'no') }
    await runRuntimeRecovery(['--runtime-status'], connect, io)
    expect(io.write.mock.calls[0]![0]).toContain('document')
    expect(io.write.mock.calls[0]![0]).not.toContain(completion.receiptId)
    await expect(
      runRuntimeRecovery(['--resolve-runtime-block', 'call'], connect, io)
    ).rejects.toThrow('interactive')
    io.interactive = true
    await expect(
      runRuntimeRecovery(['--resolve-runtime-block', 'call'], connect, io)
    ).rejects.toThrow('cancelled')
    expect(receipts.pendingCount).toBe(1)
    io.confirm.mockResolvedValue('call')
    await runRuntimeRecovery(['--resolve-runtime-block', 'call'], connect, io)
    expect(receipts.pendingCount).toBe(0)
  })

  it('binds confirmation to one connection, revision and use', async () => {
    const { receipts } = runtime()
    reserve(receipts)
    const connect = await listen(receipts)
    const peer = new ControlPeer()
    peers.push(peer)
    await peer.connect(new SocketTransport(await connect()))
    const prepared = await peer.request(
      { method: 'tempad/runtime-prepare-resolution', params: { id: 'call' } },
      ResultSchema.extend({ challenge: z.string() })
    )
    receipts.settle('call', extension.id)
    reserve(receipts)
    const request = {
      method: 'tempad/runtime-resolve-block',
      params: { challenge: prepared.challenge, stopped: true }
    }
    await expect(peer.request(request, ResultSchema)).rejects.toThrow('changed')
    await expect(peer.request(request, ResultSchema)).rejects.toThrow('already used')
    expect(receipts.pendingCount).toBe(1)
  })
})
