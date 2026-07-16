import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { ExtensionRegistry } from '../src/extension-registry'
import { attachExtensionSocket } from '../src/extension-socket'
import { createExtensionOriginPolicy } from '../src/security'
import { startExtensionWebSocketServer } from '../src/websocket-server'

const STORE_ORIGIN = 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
const servers: WebSocketServer[] = []
const registries: ExtensionRegistry[] = []

afterEach(async () => {
  registries.splice(0).forEach((registry) => registry.dispose())
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('extension socket lifecycle', () => {
  it('registers, activates, routes results, rejects invalid messages, and disconnects', async () => {
    const registry = new ExtensionRegistry(10_000)
    registries.push(registry)
    const onActivated = vi.fn()
    const onConnected = vi.fn()
    const onDisconnected = vi.fn()
    const onProtocolWarning = vi.fn()
    const onToolError = vi.fn()
    const onToolResult = vi.fn()
    const started = await startExtensionWebSocketServer({
      maxConnections: 2,
      maxPayloadBytes: 1024,
      originPolicy: createExtensionOriginPolicy(STORE_ORIGIN),
      portCandidates: [0]
    })
    servers.push(started.server)

    const broadcastState = () => {
      const message = JSON.stringify({
        type: 'state',
        activeId: registry.getActiveId(),
        assetServerUrl: 'http://127.0.0.1:1234/capability'
      })
      registry.list().forEach(({ ws }) => ws.send(message))
    }
    started.server.on('connection', (socket, request) => {
      attachExtensionSocket(socket, {
        createId: () => 'ext-1',
        origin: request.headers.origin ?? '',
        registry,
        onActivated,
        onConnected,
        onDisconnected,
        onProtocolWarning,
        onStateChange: broadcastState,
        onToolError,
        onToolResult
      })
    })

    const received: unknown[] = []
    const client = new WebSocket(`ws://127.0.0.1:${started.port}/`, {
      origin: STORE_ORIGIN
    })
    client.on('message', (raw) => received.push(JSON.parse(raw.toString('utf-8'))))
    await waitForOpen(client)
    await waitUntil(() => received.length >= 2)

    expect(onConnected).toHaveBeenCalledWith('ext-1')
    expect(received).toEqual([
      { id: 'ext-1', type: 'registered' },
      {
        activeId: null,
        assetServerUrl: 'http://127.0.0.1:1234/capability',
        type: 'state'
      }
    ])

    client.send(JSON.stringify({ type: 'activate' }))
    await waitUntil(() => onActivated.mock.calls.length === 1 && received.length >= 3)
    expect(registry.getActiveId()).toBe('ext-1')
    expect(received.at(-1)).toMatchObject({ activeId: 'ext-1', type: 'state' })

    client.send(JSON.stringify({ id: 'req-result', payload: { ok: true }, type: 'toolResult' }))
    await waitUntil(() => onToolResult.mock.calls.length === 1)
    expect(onToolResult).toHaveBeenCalledWith('req-result', 'ext-1', { ok: true })

    client.send(
      JSON.stringify({
        id: 'req-error',
        error: { code: 'EXTENSION_TIMEOUT', message: 'timed out' },
        type: 'toolResult'
      })
    )
    await waitUntil(() => onToolError.mock.calls.length === 1)
    expect(onToolError).toHaveBeenCalledWith('req-error', 'ext-1', {
      code: 'EXTENSION_TIMEOUT',
      message: 'timed out'
    })

    client.send(JSON.stringify({ type: 'ping' }))
    client.send('{')
    client.send(JSON.stringify({ type: 'unknown' }))
    client.send(Buffer.from('binary'))
    await waitUntil(() => onProtocolWarning.mock.calls.length === 3)
    expect(onProtocolWarning.mock.calls.map(([warning]) => warning.kind)).toEqual([
      'json',
      'schema',
      'binary'
    ])

    client.close()
    await waitForClose(client)
    await waitUntil(() => onDisconnected.mock.calls.length === 1)
    expect(onDisconnected).toHaveBeenCalledWith('ext-1', true)
    expect(registry.size).toBe(0)
  })

  it('contains oversized-message socket errors and cleans up the connection', async () => {
    const registry = new ExtensionRegistry(10_000)
    registries.push(registry)
    const onDisconnected = vi.fn()
    const onSocketError = vi.fn()
    const started = await startExtensionWebSocketServer({
      maxConnections: 1,
      maxPayloadBytes: 32,
      originPolicy: createExtensionOriginPolicy(STORE_ORIGIN),
      portCandidates: [0]
    })
    servers.push(started.server)
    started.server.on('connection', (socket, request) => {
      attachExtensionSocket(socket, {
        createId: () => 'ext-oversized',
        origin: request.headers.origin ?? '',
        registry,
        onDisconnected,
        onSocketError,
        onStateChange: () => undefined,
        onToolError: () => undefined,
        onToolResult: () => undefined
      })
    })

    const client = new WebSocket(`ws://127.0.0.1:${started.port}/`, {
      origin: STORE_ORIGIN
    })
    await waitForOpen(client)
    const closed = waitForClose(client)
    client.send('x'.repeat(64))

    await closed
    await waitUntil(
      () => onSocketError.mock.calls.length === 1 && onDisconnected.mock.calls.length === 1
    )
    expect(onSocketError.mock.calls[0]?.[0]).toBe('ext-oversized')
    expect(onSocketError.mock.calls[0]?.[1]).toBeInstanceOf(Error)
    expect(onDisconnected).toHaveBeenCalledWith('ext-oversized', false)
    expect(registry.size).toBe(0)
  })

  it('rejects cross-Origin takeover while allowing same-Origin reconnect activation', async () => {
    const registry = new ExtensionRegistry(10_000)
    registries.push(registry)
    const onActivationRejected = vi.fn()
    const started = await startExtensionWebSocketServer({
      maxConnections: 3,
      maxPayloadBytes: 1024,
      originPolicy: createExtensionOriginPolicy(undefined),
      portCandidates: [0]
    })
    servers.push(started.server)
    let connectionIndex = 0
    started.server.on('connection', (socket, request) => {
      connectionIndex += 1
      attachExtensionSocket(socket, {
        createId: () => `ext-${connectionIndex}`,
        origin: request.headers.origin ?? '',
        registry,
        onActivationRejected,
        onStateChange: () => undefined,
        onToolError: () => undefined,
        onToolResult: () => undefined
      })
    })

    const otherOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const first = new WebSocket(`ws://127.0.0.1:${started.port}/`, { origin: STORE_ORIGIN })
    await waitForOpen(first)
    const other = new WebSocket(`ws://127.0.0.1:${started.port}/`, { origin: otherOrigin })
    await waitForOpen(other)
    const reconnected = new WebSocket(`ws://127.0.0.1:${started.port}/`, {
      origin: STORE_ORIGIN
    })
    await waitForOpen(reconnected)
    await waitUntil(() => registry.size === 3)

    first.send(JSON.stringify({ type: 'activate' }))
    await waitUntil(() => registry.getActiveId() === 'ext-1')
    other.send(JSON.stringify({ type: 'activate' }))
    await waitUntil(() => onActivationRejected.mock.calls.length === 1)
    expect(onActivationRejected).toHaveBeenCalledWith('ext-2', 'ext-1')
    expect(registry.getActiveId()).toBe('ext-1')

    reconnected.send(JSON.stringify({ type: 'activate' }))
    await waitUntil(() => registry.getActiveId() === 'ext-3')

    const closed = [waitForClose(first), waitForClose(other), waitForClose(reconnected)]
    first.close()
    other.close()
    reconnected.close()
    await Promise.all(closed)
  })
})

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()))
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for WebSocket lifecycle event.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    server.clients.forEach((client) => client.terminate())
    server.close(() => resolve())
  })
}
