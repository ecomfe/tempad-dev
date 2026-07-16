import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { createExtensionOriginPolicy } from '../src/security'
import { startExtensionWebSocketServer } from '../src/websocket-server'

const STORE_ORIGIN = 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('extension WebSocket server', () => {
  it('accepts the configured extension Origin and rejects web Origins and query paths', async () => {
    const onRejectedHandshake = vi.fn()
    const started = await startExtensionWebSocketServer({
      maxConnections: 4,
      maxPayloadBytes: 1024,
      originPolicy: createExtensionOriginPolicy(STORE_ORIGIN),
      portCandidates: [0],
      onRejectedHandshake
    })
    servers.push(started.server)

    const accepted = new WebSocket(`ws://127.0.0.1:${started.port}/`, {
      origin: STORE_ORIGIN
    })
    await waitForOpen(accepted)
    accepted.close()
    await waitForClose(accepted)

    await expect(
      rejectionStatus(`ws://127.0.0.1:${started.port}/`, 'https://evil.example')
    ).resolves.toBe(401)
    await expect(
      rejectionStatus(`ws://127.0.0.1:${started.port}/?token=leak`, STORE_ORIGIN)
    ).resolves.toBe(401)
    expect(onRejectedHandshake).toHaveBeenCalledWith('https://evil.example', '/')
    expect(onRejectedHandshake).toHaveBeenCalledWith(STORE_ORIGIN, '/?token=leak')
  })

  it('falls through an occupied candidate and reports the selected ephemeral port', async () => {
    const occupied = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    servers.push(occupied)
    await waitForListening(occupied)
    const address = occupied.address()
    if (!address || typeof address !== 'object') throw new Error('Expected TCP address.')

    const onPortInUse = vi.fn()
    const started = await startExtensionWebSocketServer({
      maxConnections: 4,
      maxPayloadBytes: 1024,
      originPolicy: createExtensionOriginPolicy(undefined),
      portCandidates: [address.port, 0],
      onPortInUse
    })
    servers.push(started.server)

    expect(onPortInUse).toHaveBeenCalledWith(address.port)
    expect(started.port).toBeGreaterThan(0)
    expect(started.port).not.toBe(address.port)
  })

  it('bounds simultaneous extension connections and accepts a replacement after close', async () => {
    const onConnectionLimit = vi.fn()
    const started = await startExtensionWebSocketServer({
      maxConnections: 1,
      maxPayloadBytes: 1024,
      originPolicy: createExtensionOriginPolicy(STORE_ORIGIN),
      portCandidates: [0],
      onConnectionLimit
    })
    servers.push(started.server)

    const first = new WebSocket(`ws://127.0.0.1:${started.port}/`, { origin: STORE_ORIGIN })
    await waitForOpen(first)
    await expect(rejectionStatus(`ws://127.0.0.1:${started.port}/`, STORE_ORIGIN)).resolves.toBe(
      401
    )
    expect(onConnectionLimit).toHaveBeenCalledWith(1)

    first.close()
    await waitForClose(first)
    const replacement = new WebSocket(`ws://127.0.0.1:${started.port}/`, {
      origin: STORE_ORIGIN
    })
    await waitForOpen(replacement)
    replacement.close()
    await waitForClose(replacement)
  })

  it('reports exhaustion when every candidate is occupied', async () => {
    const occupied = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    servers.push(occupied)
    await waitForListening(occupied)
    const address = occupied.address()
    if (!address || typeof address !== 'object') throw new Error('Expected TCP address.')

    await expect(
      startExtensionWebSocketServer({
        maxConnections: 4,
        maxPayloadBytes: 1024,
        originPolicy: createExtensionOriginPolicy(undefined),
        portCandidates: [address.port]
      })
    ).rejects.toThrow(`Unable to start WebSocket server on candidate ports: ${address.port}.`)
  })
})

function waitForListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()))
}

function rejectionStatus(url: string, origin: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin })
    socket.once('open', () => {
      socket.close()
      reject(new Error('Expected WebSocket handshake rejection.'))
    })
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      resolve(response.statusCode)
    })
  })
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    server.clients.forEach((client) => client.terminate())
    server.close(() => resolve())
  })
}
