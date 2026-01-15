import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/mcp-shared'

import { createCodedError } from './errors'

let currentSocket: WebSocket | null = null

export function setMcpSocket(socket: WebSocket | null): void {
  currentSocket = socket
}

export function getMcpSocket(): WebSocket | null {
  return currentSocket
}

export function requireMcpSocket(): WebSocket {
  if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED,
      'MCP transport is not connected.'
    )
  }
  return currentSocket
}
