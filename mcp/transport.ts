let currentSocket: WebSocket | null = null

export function setMcpSocket(socket: WebSocket | null): void {
  currentSocket = socket
}

export function getMcpSocket(): WebSocket | null {
  return currentSocket
}

export function requireMcpSocket(): WebSocket {
  if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
    throw new Error('MCP transport is not connected.')
  }
  return currentSocket
}
