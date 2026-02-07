import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it } from 'vitest'

import { getMcpSocket, requireMcpSocket, setMcpSocket } from '@/mcp/transport'

afterEach(() => {
  setMcpSocket(null)
})

describe('mcp/transport', () => {
  it('stores and returns current socket', () => {
    const socket = { readyState: WebSocket.OPEN } as WebSocket
    setMcpSocket(socket)

    expect(getMcpSocket()).toBe(socket)
  })

  it('throws coded error when socket is missing', () => {
    setMcpSocket(null)

    expect(() => requireMcpSocket()).toThrowError('MCP transport is not connected.')
    try {
      requireMcpSocket()
    } catch (error) {
      expect((error as { code?: string }).code).toBe(TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED)
    }
  })

  it('throws coded error when socket is not open', () => {
    const socket = { readyState: WebSocket.CLOSING } as WebSocket
    setMcpSocket(socket)

    expect(() => requireMcpSocket()).toThrowError('MCP transport is not connected.')
  })

  it('returns socket when connection is open', () => {
    const socket = { readyState: WebSocket.OPEN } as WebSocket
    setMcpSocket(socket)

    expect(requireMcpSocket()).toBe(socket)
  })
})
