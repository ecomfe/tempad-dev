import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js'
import { ResultSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { captureHostContext } from '../src/agent-clients/host-context'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import {
  ControlPeer,
  LEASE_MS,
  negotiate,
  RECOVER_MS,
  RuntimeDataTransport,
  SocketTransport
} from '../src/runtime-prototype/protocol'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

describe('runtime control negotiation and admission', () => {
  it('negotiates downward and rejects incompatible peers explicitly', () => {
    expect(negotiate([1, 2, 3], [1, 2])).toBe(2)
    expect(negotiate([1], [1, 2])).toBe(1)
    expect(() => negotiate([2], [1])).toThrow('MCP_RUNTIME_RESTART_REQUIRED')
    expect(() => negotiate([])).toThrow('MCP_RUNTIME_RESTART_REQUIRED')
  })

  it.skipIf(process.platform === 'win32')(
    'fences expired and replaced leases and preserves per-edge context',
    async () => {
      const root = await mkdtemp('/tmp/tp-control-')
      const path = join(root, 'control.sock')
      const sockets = new Set<Socket>()
      let now = 0
      const control = new HubControl('secret', () => now)
      const server = createServer((socket) => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
        void control.attach(socket)
      })
      server.listen(path)
      await once(server, 'listening')
      cleanup.push(async () => {
        await control.close()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await rm(root, { recursive: true, force: true })
      })
      const peer = async () => {
        const socket = connect(path)
        await once(socket, 'connect')
        const rpc = new ControlPeer()
        await rpc.connect(new SocketTransport(socket))
        cleanup.push(() => rpc.close())
        return rpc
      }
      const first = await peer()
      const acquire = (rpc: ControlPeer, secret = 'secret') =>
        rpc.request(
          {
            method: 'tempad/runtime-acquire',
            params: { secret, versions: [1, 2] }
          },
          LeaseSchema
        )
      await expect(acquire(first, 'wrong')).rejects.toThrow('invalid')
      const lease = await acquire(first)
      expect(lease.generation).toBe(1)
      const registration = {
        sessionId: randomUUID(),
        token: randomUUID(),
        context: captureHostContext({ HOME: root, TMPDIR: root }),
        versions: [1]
      }
      await first.request({ method: 'tempad/runtime-register', params: registration }, ResultSchema)
      expect(control.pendingConnections()).toBe(1)
      expect(control.claimSession(registration.sessionId, registration.token).context).toEqual(
        registration.context
      )
      expect(control.pendingConnections()).toBe(0)
      expect(control.admits(registration.sessionId, lease.generation)).toBe(true)
      const second = await peer()
      await expect(acquire(second)).rejects.toThrow('already owned')
      now = LEASE_MS
      expect(control.available()).toBe(false)
      await expect(first.request({ method: 'tempad/runtime-renew' }, ResultSchema)).rejects.toThrow(
        'not dispatched'
      )
      const replacement = await acquire(second)
      expect(replacement.generation).toBe(2)
      expect(replacement.hubId).toBe(lease.hubId)
      expect(control.admits(registration.sessionId, 2)).toBe(false)
      await second.request(
        { method: 'tempad/runtime-register', params: registration },
        ResultSchema
      )
      expect(control.admits(registration.sessionId, 2)).toBe(true)
      expect(control.admits(registration.sessionId, 1)).toBe(false)
      const abandoned = { ...registration, sessionId: randomUUID(), token: randomUUID() }
      await second.request({ method: 'tempad/runtime-register', params: abandoned }, ResultSchema)
      expect(control.pendingConnections()).toBe(1)
      expect(() => control.claimSession(abandoned.sessionId, registration.token)).toThrow(
        'no current'
      )
      now += RECOVER_MS
      expect(control.pendingConnections()).toBe(0)
      expect(() => control.claimSession(abandoned.sessionId, abandoned.token)).toThrow('no current')
      const third = await peer()
      await acquire(third)
      await expect(
        third.request(
          {
            method: 'tempad/runtime-register',
            params: {
              ...registration,
              context: { ...registration.context, codexHome: join(root, 'other') }
            }
          },
          ResultSchema
        )
      ).rejects.toThrow('identity changed')
      control.forget(registration.sessionId)
      expect(() => control.claimSession(registration.sessionId, registration.token)).toThrow(
        'no current'
      )
      await third.close()
      await vi.waitFor(() => expect(control.available()).toBe(false))
    }
  )

  it('rejects stale/expired calls while allowing cancellation and accepted replies to settle', async () => {
    const [client, wire] = InMemoryTransport.createLinkedPair()
    let available = true
    const transport = new RuntimeDataTransport(wire, {
      generation: () => 2,
      admit: (generation) => available && generation === 2,
      role: 'hub'
    })
    const delivered: JSONRPCMessage[] = []
    const output: JSONRPCMessage[] = []
    transport.onmessage = (message) => delivered.push(message)
    client.onmessage = (message) => output.push(message)
    await transport.start()
    cleanup.push(() => transport.close())
    const frame = (message: JSONRPCMessage, generation = 2, deadline = Date.now() + 10000) =>
      client.send({
        jsonrpc: '2.0',
        method: 'tempad/runtime-frame',
        params: { generation, deadline, message }
      })
    await frame({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: { _meta: { trace: 'one' } }
    })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      id: 'tempad:request:zero',
      params: { _meta: { trace: 'one' } }
    })
    await frame({ jsonrpc: '2.0', id: 1, method: 'tools/call' }, 1)
    await frame({ jsonrpc: '2.0', id: 2, method: 'tools/call' }, 2, Date.now() - 1)
    expect(delivered).toHaveLength(1)
    expect(output).toHaveLength(2)
    expect(output[0]).toMatchObject({
      params: { message: { id: 1, error: { data: { dispatched: false } } } }
    })
    for (const id of [0, '', 'tempad:request:zero', 'tempad:request:string:caller']) {
      await frame({ jsonrpc: '2.0', id, method: 'tools/call' }, 1)
      expect(output.at(-1)).toMatchObject({
        params: { message: { id, error: { data: { dispatched: false } } } }
      })
    }
    available = false
    await frame({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } }, 1)
    expect(delivered[1]).toMatchObject({ params: { requestId: 'tempad:request:zero' } })
    await transport.send({ jsonrpc: '2.0', id: 'tempad:request:zero', result: { complete: true } })
    expect(output.at(-1)).toMatchObject({
      params: { message: { id: 0, result: { complete: true } } }
    })
    await expect(
      transport.send({ jsonrpc: '2.0', id: 3, method: 'roots/list' })
    ).rejects.toMatchObject({ data: { dispatched: false } })
  })

  it.skipIf(process.platform === 'win32')(
    'bounds socket output and settles backpressure when the peer closes',
    async () => {
      const sockets = new Set<Socket>()
      const server = createServer((socket) => {
        socket.pause()
        sockets.add(socket)
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected ephemeral port')
      const socket = connect(address.port, '127.0.0.1')
      await once(socket, 'connect')
      const transport = new SocketTransport(socket)
      await transport.start()
      cleanup.push(async () => {
        await transport.close()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      })
      await expect(
        transport.send({
          jsonrpc: '2.0',
          id: 1,
          result: { text: 'x'.repeat(STDIO_DEFAULT_MAX_BUFFER_SIZE) }
        })
      ).rejects.toThrow('buffer is full')
      const sends = Array.from({ length: 8 }, (_, id) =>
        transport.send({ jsonrpc: '2.0', id, result: { text: 'x'.repeat(1024 * 1024) } })
      )
      const settled = Promise.allSettled(sends)
      await transport.close()
      const results = await settled
      expect(results.some((result) => result.status === 'rejected')).toBe(true)
      await expect(transport.send({ jsonrpc: '2.0', id: 9, result: {} })).rejects.toThrow('closed')
    }
  )
})
