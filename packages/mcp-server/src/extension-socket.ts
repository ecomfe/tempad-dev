import type { TempadMcpErrorPayload } from '@tempad-dev/shared'
import type { RawData, WebSocket } from 'ws'

import { MessageFromExtensionSchema, type RegisteredMessage } from '@tempad-dev/shared'

import type { ExtensionRegistry } from './extension-registry'
import type { ExtensionConnection } from './types'

type ExtensionProtocolWarning =
  | { extensionId: string; kind: 'binary' }
  | { error: unknown; extensionId: string; kind: 'json' | 'schema' }

type AttachExtensionSocketOptions = {
  createId: () => string
  origin: string
  registry: ExtensionRegistry
  onActivationRejected?: (extensionId: string, activeExtensionId: string) => void
  onActivated?: (extensionId: string) => void
  onAutoActivated?: (extensionId: string) => void
  onConnected?: (extensionId: string) => void
  onDisconnected?: (extensionId: string, wasActive: boolean) => void
  onProtocolWarning?: (warning: ExtensionProtocolWarning) => void
  onSocketError?: (extensionId: string, error: Error) => void
  onStateChange: () => void
  onToolError: (requestId: string, extensionId: string, error: TempadMcpErrorPayload) => void
  onToolResult: (requestId: string, extensionId: string, payload: unknown) => void
}

export function attachExtensionSocket(
  ws: WebSocket,
  options: AttachExtensionSocketOptions
): ExtensionConnection {
  const extension: ExtensionConnection = {
    id: options.createId(),
    origin: options.origin.toLowerCase(),
    ws
  }
  options.registry.add(extension)
  options.onConnected?.(extension.id)

  const registered: RegisteredMessage = { id: extension.id, type: 'registered' }
  ws.send(JSON.stringify(registered))
  options.onStateChange()
  scheduleAutoActivation(options)

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      options.onProtocolWarning?.({ extensionId: extension.id, kind: 'binary' })
      return
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawDataToBuffer(raw).toString('utf-8'))
    } catch (error) {
      options.onProtocolWarning?.({ error, extensionId: extension.id, kind: 'json' })
      return
    }

    const parseResult = MessageFromExtensionSchema.safeParse(parsedJson)
    if (!parseResult.success) {
      options.onProtocolWarning?.({
        error: parseResult.error.flatten(),
        extensionId: extension.id,
        kind: 'schema'
      })
      return
    }

    const message = parseResult.data
    switch (message.type) {
      case 'activate':
        if (options.registry.activate(extension.id)) {
          options.onActivated?.(extension.id)
          options.onStateChange()
          scheduleAutoActivation(options)
        } else {
          const activeExtensionId = options.registry.getActiveId()
          if (activeExtensionId) {
            options.onActivationRejected?.(extension.id, activeExtensionId)
          }
        }
        break
      case 'toolResult':
        if (message.error !== undefined) {
          options.onToolError(message.id, extension.id, message.error)
        } else {
          options.onToolResult(message.id, extension.id, message.payload)
        }
        break
      case 'ping':
        break
    }
  })

  ws.on('error', (error) => {
    options.onSocketError?.(extension.id, error)
  })

  ws.once('close', () => {
    const removed = options.registry.remove(extension.id)
    if (!removed) return
    options.onDisconnected?.(extension.id, removed.wasActive)
    options.onStateChange()
    scheduleAutoActivation(options)
  })

  return extension
}

function scheduleAutoActivation(options: AttachExtensionSocketOptions): void {
  options.registry.scheduleAutoActivation((extensionId) => {
    options.onAutoActivated?.(extensionId)
    options.onStateChange()
  })
}

function rawDataToBuffer(raw: RawData): Buffer {
  if (typeof raw === 'string') return Buffer.from(raw)
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return Buffer.concat(raw)
}
