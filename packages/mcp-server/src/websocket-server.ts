import { WebSocketServer } from 'ws'

import type { ExtensionOriginPolicy } from './security'

import { isAllowedWebSocketRequest } from './security'

type StartExtensionWebSocketServerOptions = {
  maxPayloadBytes: number
  maxConnections: number
  originPolicy: ExtensionOriginPolicy
  portCandidates: readonly number[]
  onConnectionLimit?: (limit: number) => void
  onPortInUse?: (port: number) => void
  onRejectedHandshake?: (origin: string | undefined, path: string | undefined) => void
}

export async function startExtensionWebSocketServer({
  maxPayloadBytes,
  maxConnections,
  originPolicy,
  portCandidates,
  onPortInUse,
  onConnectionLimit,
  onRejectedHandshake
}: StartExtensionWebSocketServerOptions): Promise<{
  port: number
  server: WebSocketServer
}> {
  for (const candidate of portCandidates) {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: candidate,
      maxPayload: maxPayloadBytes,
      verifyClient: (info: { origin: string; req: { url?: string } }) => {
        if (server.clients.size >= maxConnections) {
          onConnectionLimit?.(maxConnections)
          return false
        }
        const allowed = isAllowedWebSocketRequest(info.origin, info.req.url, originPolicy)
        if (!allowed) onRejectedHandshake?.(info.origin, info.req.url)
        return allowed
      }
    })

    try {
      await waitForListening(server)
      return { server, port: resolveListeningPort(server, candidate) }
    } catch (error) {
      server.close()
      const errno = error as NodeJS.ErrnoException
      if (errno.code === 'EADDRINUSE') {
        onPortInUse?.(candidate)
        continue
      }
      throw errno
    }
  }

  throw new Error(
    `Unable to start WebSocket server on candidate ports: ${portCandidates.join(', ')}.`
  )
}

function waitForListening(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
  })
}

function resolveListeningPort(server: WebSocketServer, candidate: number): number {
  const address = server.address()
  return address && typeof address === 'object' ? address.port : candidate
}
