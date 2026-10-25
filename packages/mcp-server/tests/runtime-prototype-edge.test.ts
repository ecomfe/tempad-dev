import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Notification } from '@modelcontextprotocol/sdk/types.js'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, McpError, ResultSchema } from '@modelcontextprotocol/sdk/types.js'
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

import type { ClientBindingUpdate } from '../src/client-binding'

import { startPrototypeEdge } from '../src/runtime-prototype/edge'
import * as processes from '../src/runtime-prototype/processes'
import {
  hubSocketPath,
  listenPrivate,
  type PrototypeConfig
} from '../src/runtime-prototype/processes'
import {
  ControlPeer,
  CONTROL_VERSIONS,
  RECOVER_MS,
  RuntimeDataTransport,
  SocketTransport,
  unavailable
} from '../src/runtime-prototype/protocol'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function fixture(
  options: { hello?: () => void; attach?: () => void; delayData?: boolean } = {}
) {
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
  const runtimes: Server[] = []
  let ready = 0
  const sockets = new Set<Socket>()
  const controlServer = createServer((socket) => {
    sockets.add(socket)
    const peer = new ControlPeer()
    controls.push(peer)
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-ready'),
        params: z.object({ waitForRuntime: z.literal(true) })
      }),
      () => {
        ready++
        return {}
      }
    )
    peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-refresh') }), () => ({
      version: CONTROL_VERSIONS[0],
      generation: state.generation,
      hubId: state.hubId,
      hubPid: process.pid,
      supervisorPid: process.pid
    }))
    peer.setRequestHandler(
      z.object({
        method: z.literal('tempad/runtime-hello'),
        params: z.record(z.string(), z.unknown())
      }),
      ({ params }) => {
        registrations.push(params)
        options.hello?.()
        return {
          version: CONTROL_VERSIONS[0],
          generation: ++state.generation,
          hubId: state.hubId,
          hubPid: process.pid,
          supervisorPid: process.pid
        }
      }
    )
    void peer.connect(new SocketTransport(socket))
  })
  const notifications: Notification[] = []
  const calls = vi.fn(async () => ({ content: [], structuredContent: { received: true } }))
  let initialized = 0
  const dataServer = createServer((socket) => {
    sockets.add(socket)
    const wire = new SocketTransport(socket)
    wire.onmessage = async (message) => {
      if (!('id' in message) || message.id === undefined)
        throw new Error('Expected attachment request')
      try {
        options.attach?.()
      } catch (error) {
        if (!(error instanceof McpError)) throw error
        await wire.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: error.code, message: error.message, data: error.data }
        })
        return
      }
      await wire.send({ jsonrpc: '2.0', id: message.id, result: {} })
      const runtime = new Server(
        { name: 'fixture', version: '1' },
        { capabilities: { tools: {} }, instructions: 'Frozen' }
      )
      runtimes.push(runtime)
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
  const publishData = () => listenPrivate(dataServer, hubSocketPath(root))
  if (!options.delayData) await publishData()
  const edge = startPrototypeEdge({ root } as PrototypeConfig)
  const client = new Client({ name: 'fixture host', version: '1' })
  cleanup.push(async () => {
    await client.close()
    await edge
  })
  return {
    client,
    connect: () => client.connect(clientTransport),
    edge,
    registrations,
    controls,
    calls,
    notifications,
    publishData,
    publishBinding: async (binding: ClientBindingUpdate) => {
      const runtime = runtimes.at(-1)!
      await runtime.notification({ method: 'notifications/tempad/client-binding', params: binding })
      // The ordered reply proves the private notification reached the edge
      // before the control socket announces a replacement.
      await runtime.request({ method: 'ping' }, ResultSchema)
    },
    replaceHub: async () => {
      const previous = ready
      state.hubId = randomUUID()
      await controls.at(-1)!.notification({
        method: 'notifications/tempad/runtime-replaced',
        params: {
          version: CONTROL_VERSIONS[0],
          generation: ++state.generation,
          hubId: state.hubId,
          hubPid: process.pid,
          supervisorPid: process.pid
        }
      })
      await vi.waitFor(() => expect(ready).toBeGreaterThan(previous))
    },
    initialized: () => initialized,
    exitCode
  }
}

it.skipIf(process.platform === 'win32')(
  'reattaches control without reinitializing MCP, inheriting another host or replaying tools',
  async () => {
    const {
      client,
      connect,
      edge,
      registrations,
      controls,
      calls,
      notifications,
      initialized,
      exitCode
    } = await fixture()
    await connect()
    expect(client.getInstructions()).toBe('Frozen')
    expect(initialized()).toBe(1)
    await client.request({ method: 'tools/call', params: { name: 'write' } }, ResultSchema)
    expect(calls).toHaveBeenCalledOnce()
    await controls[0]!.close()
    await vi.waitFor(() => expect(registrations).toHaveLength(2))
    expect(registrations[1]).toEqual(registrations[0])
    await client.request({ method: 'tools/call', params: { name: 'read' } }, ResultSchema)
    expect(calls).toHaveBeenCalledTimes(2)
    expect(initialized()).toBe(1)
    expect(notifications.map((value) => value.method)).toEqual([
      'notifications/tempad/host-context',
      'notifications/tempad/client-event',
      'notifications/tempad/subscribe-client-binding'
    ])
    await client.close()
    await edge
    expect(process.exitCode).toBe(exitCode)
  }
)

function claudeEnvironment() {
  for (const name of ['CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID'])
    vi.stubEnv(name, undefined)
  vi.stubEnv('CLAUDECODE', '1')
  vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'birth-hint')
}

it.skipIf(process.platform === 'win32')(
  'preserves verified Claude reconnect claims, rotation and clearing across Hub replacements',
  async () => {
    claudeEnvironment()
    const { client, connect, notifications, publishBinding, replaceHub, initialized } =
      await fixture()
    const publicNotifications = vi.fn()
    client.fallbackNotificationHandler = publicNotifications
    await connect()
    for (const sessionId of ['verified-a', 'verified-b', undefined]) {
      await publishBinding({ kind: 'claude', ...(sessionId ? { sessionId } : {}) })
      // Retiring only a birth hint must not erase an already verified claim.
      await publishBinding({ clearSessionHint: true })
      await replaceHub()
      const event = notifications.findLast(
        (value) => value.method === 'notifications/tempad/client-event'
      )
      const subscription = notifications.findLast(
        (value) => value.method === 'notifications/tempad/subscribe-client-binding'
      )
      expect(event?.params).toEqual({
        event: 'connect',
        kind: 'claude',
        ...(sessionId ? { sessionId } : {})
      })
      expect(subscription?.params).toBeUndefined()
    }
    expect(initialized()).toBe(4)
    expect(publicNotifications).not.toHaveBeenCalled()
  }
)

it.skipIf(process.platform === 'win32').each([false, true])(
  'replays a Claude birth hint only until retired (clearSessionHint=%s)',
  async (clear) => {
    claudeEnvironment()
    const { connect, notifications, publishBinding, replaceHub } = await fixture()
    await connect()
    expect(notifications.at(-1)?.params).toEqual({ sessionId: 'birth-hint' })
    if (clear) await publishBinding({ clearSessionHint: true })
    await replaceHub()
    const event = notifications.findLast(
      (value) => value.method === 'notifications/tempad/client-event'
    )
    const subscription = notifications.findLast(
      (value) => value.method === 'notifications/tempad/subscribe-client-binding'
    )
    expect(event?.params).toEqual({ event: 'connect', kind: 'claude' })
    expect(subscription?.params).toEqual(clear ? undefined : { sessionId: 'birth-hint' })
  }
)

it.skipIf(process.platform === 'win32').each(['hello', 'attach'] as const)(
  'waits for initial %s admission without replaying MCP initialization or tools',
  async (stage) => {
    let attempts = 0
    const { client, connect, initialized, calls } = await fixture({
      [stage]: () => {
        if (++attempts < 3) throw unavailable('Runtime handoff in progress; retry attachment.')
      }
    })
    await connect()
    expect(attempts).toBe(3)
    expect(initialized()).toBe(1)
    await client.request({ method: 'tools/call', params: { name: 'write' } }, ResultSchema)
    expect(calls).toHaveBeenCalledOnce()
  }
)

it.skipIf(process.platform === 'win32')(
  'retries only the unavailable data socket before initialization',
  async () => {
    const connectSocket = vi.spyOn(processes, 'connectSocket')
    const { connect, publishData, initialized } = await fixture({ delayData: true })
    const connecting = connect()
    void connecting.catch(() => {})
    await vi.waitFor(() => expect(connectSocket.mock.calls.length).toBeGreaterThan(1))
    await publishData()
    await connecting
    expect(initialized()).toBe(1)
  }
)

it.skipIf(process.platform === 'win32')(
  'does not retry filesystem ENOENT from supervisor startup',
  async () => {
    const error = Object.assign(new Error('Missing verified release artifact'), { code: 'ENOENT' })
    const supervisor = vi.spyOn(processes, 'supervisorConnection').mockRejectedValue(error)
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) =>
      timeout(milliseconds === RECOVER_MS ? 500 : milliseconds)
    )
    const { connect, initialized } = await fixture()
    await expect(connect()).rejects.toThrow(error.message)
    expect(supervisor).toHaveBeenCalledOnce()
    expect(initialized()).toBe(0)
  }
)

it
  .skipIf(process.platform === 'win32')
  .each([
    new McpError(-32002, 'MCP_RUNTIME_RESTART_REQUIRED: incompatible protocol.'),
    new Error('MCP_RUNTIME_RESTART_REQUIRED: pinned client requests a different runtime.'),
    new McpError(-32001, 'Unclassified request timeout.')
  ])('rejects permanent registration failures without retrying: %s', async (error) => {
  const { connect, registrations, initialized } = await fixture({
    hello: () => {
      throw error
    }
  })
  await expect(connect()).rejects.toThrow(error.message)
  expect(registrations).toHaveLength(1)
  expect(initialized()).toBe(0)
})

it.skipIf(process.platform === 'win32')(
  'bounds initial recovery when admission never becomes available',
  async () => {
    const deadline = new AbortController()
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) =>
      milliseconds === RECOVER_MS ? deadline.signal : timeout(milliseconds)
    )
    const { connect, registrations, initialized } = await fixture({
      hello: () => {
        throw unavailable()
      }
    })
    const connecting = expect(connect()).rejects.toThrow('Runtime startup recovery timed out')
    await vi.waitFor(() => expect(registrations.length).toBeGreaterThan(1))
    expect(AbortSignal.timeout).toHaveBeenCalledWith(RECOVER_MS)
    deadline.abort()
    await connecting
    const attempts = registrations.length
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(registrations).toHaveLength(attempts)
    expect(initialized()).toBe(0)
  }
)

it.skipIf(process.platform === 'win32')(
  'cancels initial recovery when the host closes',
  async () => {
    const { client, connect, edge, registrations, initialized } = await fixture({
      hello: () => {
        throw unavailable()
      }
    })
    const connecting = expect(connect()).rejects.toThrow('Connection closed')
    await vi.waitFor(() => expect(registrations.length).toBeGreaterThan(0))
    await client.close()
    await connecting
    await edge
    const attempts = registrations.length
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(registrations).toHaveLength(attempts)
    expect(initialized()).toBe(0)
  }
)
