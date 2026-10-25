import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

const state = vi.hoisted(() => ({
  host: undefined as Transport | undefined,
  path: '',
  generation: 0,
  hubId: ''
}))
vi.mock('../src/consumer-transport', async (load) => ({
  ...(await load<typeof import('../src/consumer-transport')>()),
  ConsumerTransport: class {
    constructor() {
      return state.host!
    }
  }
}))
vi.mock('../src/runtime-prototype/processes', async (load) => {
  const actual = await load<typeof import('../src/runtime-prototype/processes')>()
  return {
    ...actual,
    supervisorConnection: (_config: unknown, signal: AbortSignal) =>
      actual.connectSocket(state.path, signal)
  }
})

import { startPrototypeEdge } from '../src/runtime-prototype/edge'
import {
  hubSocketPath,
  listenPrivate,
  type PrototypeConfig
} from '../src/runtime-prototype/processes'
import {
  ControlPeer,
  RuntimeDataTransport,
  SocketTransport
} from '../src/runtime-prototype/protocol'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

it.skipIf(process.platform === 'win32')(
  'reattaches control without reinitializing MCP, inheriting another host or replaying tools',
  async () => {
    const exitCode = process.exitCode
    vi.spyOn(process.stdin, 'destroy').mockImplementation(() => process.stdin)
    cleanup.push(async () => {
      process.exitCode = exitCode
    })
    const [clientTransport, host] = InMemoryTransport.createLinkedPair()
    state.host = host
    const root = await mkdtemp('/tmp/tp-edge-')
    await mkdir(`${root}/run`, { mode: 0o700 })
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    state.path = `${root}/control.sock`
    state.generation = 0
    state.hubId = randomUUID()
    const registrations: unknown[] = []
    const controls: ControlPeer[] = []
    const sockets = new Set<Socket>()
    const controlServer = createServer((socket) => {
      sockets.add(socket)
      const peer = new ControlPeer()
      controls.push(peer)
      peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-ready') }), () => ({}))
      peer.setRequestHandler(
        z.object({
          method: z.literal('tempad/runtime-hello'),
          params: z.record(z.string(), z.unknown())
        }),
        ({ params }) => {
          registrations.push(params)
          return {
            version: 1,
            generation: ++state.generation,
            hubId: state.hubId,
            hubPid: process.pid,
            supervisorPid: process.pid
          }
        }
      )
      void peer.connect(new SocketTransport(socket))
    })
    const notifications: unknown[] = []
    const calls = vi.fn(async () => ({ content: [], structuredContent: { received: true } }))
    let initialized = 0
    const dataServer = createServer((socket) => {
      sockets.add(socket)
      const wire = new SocketTransport(socket)
      wire.onmessage = async (message) => {
        if (!('id' in message) || message.id === undefined)
          throw new Error('Expected attachment request')
        await wire.send({ jsonrpc: '2.0', id: message.id, result: {} })
        const runtime = new Server(
          { name: 'fixture', version: '1' },
          { capabilities: { tools: {} }, instructions: 'Frozen' }
        )
        runtime.oninitialized = () => initialized++
        runtime.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
        runtime.fallbackRequestHandler = calls
        runtime.fallbackNotificationHandler = async (notification) => {
          notifications.push(notification)
        }
        await runtime.connect(
          new RuntimeDataTransport(wire, {
            generation: () => state.generation,
            admit: (generation) => generation === state.generation,
            role: 'hub',
            timeoutMs: 5000,
            started: true
          })
        )
      }
      void wire.start()
    })
    cleanup.push(async () => {
      for (const socket of sockets) socket.destroy()
      await Promise.all(
        [controlServer, dataServer].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve()))
        )
      )
    })
    await listenPrivate(controlServer, state.path)
    await listenPrivate(dataServer, hubSocketPath(root))
    const edge = startPrototypeEdge({ root } as PrototypeConfig)
    const client = new Client({ name: 'fixture host', version: '1' })
    cleanup.push(async () => {
      await client.close()
      await edge
    })
    await client.connect(clientTransport)
    expect(client.getInstructions()).toBe('Frozen')
    expect(initialized).toBe(1)
    await client.request({ method: 'tools/call', params: { name: 'write' } }, ResultSchema)
    expect(calls).toHaveBeenCalledOnce()
    await controls[0]!.close()
    await vi.waitFor(() => expect(registrations).toHaveLength(2))
    expect(registrations[1]).toEqual(registrations[0])
    await client.request({ method: 'tools/call', params: { name: 'read' } }, ResultSchema)
    expect(calls).toHaveBeenCalledTimes(2)
    expect(initialized).toBe(1)
    expect(notifications.map((value) => (value as { method: string }).method)).toEqual([
      'notifications/tempad/host-context',
      'notifications/tempad/client-event',
      'notifications/tempad/subscribe-client-binding'
    ])
    await client.close()
    await edge
    expect(process.exitCode).toBe(exitCode)
  }
)
