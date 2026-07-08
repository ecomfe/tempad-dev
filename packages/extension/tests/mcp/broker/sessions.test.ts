import { describe, expect, it, vi } from 'vitest'

import type { McpBrokerPort } from '@/mcp/broker/sessions'

import { McpSessionRegistry } from '@/mcp/broker/sessions'

function createPort(): McpBrokerPort {
  return { postMessage: vi.fn() } as unknown as McpBrokerPort
}

describe('mcp/broker/sessions', () => {
  it('auto-activates the sole registered session', () => {
    const registry = new McpSessionRegistry()

    registry.register({
      port: createPort(),
      sessionId: 'session-a'
    })

    expect(registry.getActiveId()).toBe('session-a')
    expect(registry.getActive()?.sessionId).toBe('session-a')
  })

  it('keeps explicit active session across multiple sessions', () => {
    const registry = new McpSessionRegistry()

    registry.register({ port: createPort(), sessionId: 'session-a' })
    registry.register({ port: createPort(), sessionId: 'session-b' })

    expect(registry.getActiveId()).toBe('session-a')
    expect(registry.activate('session-b')).toBe(true)
    expect(registry.getActiveId()).toBe('session-b')
    expect(registry.activate('missing')).toBe(false)
  })

  it('recomputes active session after unregister', () => {
    const registry = new McpSessionRegistry()

    registry.register({ port: createPort(), sessionId: 'session-a' })
    registry.register({ port: createPort(), sessionId: 'session-b' })
    registry.unregister('session-a')

    expect(registry.getActiveId()).toBe('session-b')

    registry.unregister('session-b')

    expect(registry.getActiveId()).toBeNull()
  })
})
