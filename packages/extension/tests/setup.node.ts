import { afterEach, vi } from 'vitest'

delete process.env.TEMPAD_MCP_DEV_CHECKOUT

afterEach(() => {
  vi.restoreAllMocks()
})
