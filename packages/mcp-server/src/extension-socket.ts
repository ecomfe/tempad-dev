import type { DesignAction, TempadMcpErrorPayload, ToolCompletionMessage } from '@tempad-dev/shared'

import {
  MessageFromExtensionSchema,
  LegacyMessageFromExtensionSchema,
  TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_BRIDGE_SUPPORTED_PROTOCOL_VERSIONS,
  type RegisteredMessage
} from '@tempad-dev/shared'
import { WebSocket, type RawData } from 'ws'

import type { ExtensionRegistry } from './extension-registry'
import type { ExtensionConnection } from './types'

type ExtensionProtocolWarning =
  | { extensionId: string; kind: 'binary' }
  | { error: unknown; extensionId: string; kind: 'json' | 'schema' }

type AttachExtensionSocketOptions = {
  createId: () => string
  origin: string
  registry: ExtensionRegistry
  terminalReceiptGeneration?: string
  onToolCompletion?: (message: ToolCompletionMessage, extension: ExtensionConnection) => boolean
  onActivationRejected?: (extensionId: string, activeExtensionId: string) => void
  onActivated?: (extensionId: string) => void
  onAutoActivated?: (extensionId: string) => void
  onConnected?: (extensionId: string) => void
  onDisconnected?: (extensionId: string, wasActive: boolean) => void
  onProtocolWarning?: (warning: ExtensionProtocolWarning) => void
  onRuntimeHello?: (extension: ExtensionConnection) => void
  onSessions?: (extension: ExtensionConnection) => void
  onDesignAction?: (extension: ExtensionConnection, sessionId: string, action: DesignAction) => void
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
    connectedAt: new Date().toISOString(),
    legacy: ws.protocol !== TEMPAD_MCP_BRIDGE_SUBPROTOCOL,
    ws
  }
  options.registry.add(extension)
  options.onConnected?.(extension.id)

  const registered: RegisteredMessage = {
    id: extension.id,
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
    supportedProtocolVersions: [...TEMPAD_MCP_BRIDGE_SUPPORTED_PROTOCOL_VERSIONS],
    ...(options.terminalReceiptGeneration
      ? { terminalReceiptGeneration: options.terminalReceiptGeneration }
      : {}),
    type: 'registered'
  }
  ws.send(JSON.stringify(extension.legacy ? { type: 'registered', id: extension.id } : registered))
  options.onStateChange()
  scheduleAutoActivation(options)

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    // Policy rejection starts a closing handshake; queued frames may still arrive.
    if (ws.readyState !== WebSocket.OPEN) return
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

    const parseResult = (
      extension.legacy ? LegacyMessageFromExtensionSchema : MessageFromExtensionSchema
    ).safeParse(parsedJson)
    if (!parseResult.success) {
      if (
        parsedJson &&
        typeof parsedJson === 'object' &&
        'type' in parsedJson &&
        parsedJson.type === 'toolResult' &&
        'id' in parsedJson &&
        typeof parsedJson.id === 'string'
      )
        options.onToolError(parsedJson.id, extension.id, {
          code: 'EXTENSION_DISCONNECTED',
          message:
            'The extension returned an invalid result. A canvas write may have completed; inspect the canvas before retrying.'
        })
      options.onProtocolWarning?.({
        error: parseResult.error.flatten(),
        extensionId: extension.id,
        kind: 'schema'
      })
      return
    }

    const message = parseResult.data
    if (
      !extension.legacy &&
      !extension.runtime &&
      (message.type === 'sessions' ||
        message.type === 'designAction' ||
        message.type === 'toolCompletion')
    ) {
      ws.close(1008, 'Runtime handshake required.')
      return
    }
    switch (message.type) {
      case 'toolCompletion': {
        if (!extension.runtime?.terminalReceipts) {
          ws.close(1008, 'Terminal receipts were not negotiated.')
          return
        }
        const accepted = options.onToolCompletion?.(message, extension) ?? false
        try {
          ws.send(JSON.stringify({ ...message, type: 'toolCompletionAck', accepted }))
        } catch (error) {
          options.onSocketError?.(
            extension.id,
            error instanceof Error ? error : new Error(String(error))
          )
        }
        break
      }
      case 'sessions':
        if (
          options.registry
            .list()
            .some(
              (peer) =>
                peer.id !== extension.id &&
                peer.sessions?.sessions.some((session) =>
                  message.sessions.some((incoming) => incoming.sessionId === session.sessionId)
                )
            )
        ) {
          ws.close(1008, 'Figma session is already registered.')
          return
        }
        extension.sessions = message
        options.onSessions?.(extension)
        break
      case 'designAction':
        options.onDesignAction?.(extension, message.sessionId, message.action)
        break
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
      case 'runtimeHello': {
        if (message.terminalReceipts && !options.terminalReceiptGeneration) {
          ws.close(1008, 'Terminal receipts are unavailable.')
          return
        }
        const protocolVersion = message.protocolVersion ?? 13
        if (!TEMPAD_MCP_BRIDGE_SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
          ws.close(1008, 'Unsupported extension bridge protocol.')
          break
        }
        if (
          extension.runtime &&
          (extension.runtime.version !== message.extensionVersion ||
            extension.runtime.fingerprint !== message.extensionRuntimeFingerprint ||
            extension.runtime.protocolVersion !== protocolVersion ||
            extension.runtime.terminalReceipts !== message.terminalReceipts)
        ) {
          options.onProtocolWarning?.({
            error: new Error('Extension changed runtime identity on an open connection.'),
            extensionId: extension.id,
            kind: 'schema'
          })
          ws.close(1008, 'Extension changed runtime identity.')
          break
        }
        extension.runtime = {
          protocolVersion,
          version: message.extensionVersion,
          fingerprint: message.extensionRuntimeFingerprint,
          ...(message.terminalReceipts ? { terminalReceipts: true as const } : {})
        }
        options.onRuntimeHello?.(extension)
        break
      }
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
