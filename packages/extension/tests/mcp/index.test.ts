import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {
    MCP_SERVER: {
      name: 'tempad-dev'
    }
  },
  runtime: {
    MCP_TOOL_HANDLERS: {
      get_code: vi.fn()
    }
  }
}))

vi.mock('@/mcp/config', () => mocks.config)
vi.mock('@/mcp/runtime', () => mocks.runtime)

describe('mcp/index', () => {
  it('re-exports MCP config and runtime contracts', async () => {
    const mcp = await import('@/mcp')

    expect(mcp.MCP_SERVER).toBe(mocks.config.MCP_SERVER)
    expect(mcp.MCP_TOOL_HANDLERS).toBe(mocks.runtime.MCP_TOOL_HANDLERS)
  })
})
