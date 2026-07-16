import type { ConfigEnv } from 'wxt'

import { describe, expect, it } from 'vitest'

import config, { getPluginSandboxCsp } from '../../wxt.config'

const env = (command: ConfigEnv['command']): ConfigEnv => ({
  browser: 'chrome',
  command,
  manifestVersion: 3,
  mode: command === 'serve' ? 'development' : 'production'
})

describe('WXT plugin sandbox configuration', () => {
  it('allows only the local Vite server required during development', async () => {
    const csp = getPluginSandboxCsp(true)
    const vite = await config.vite?.(env('serve'))

    expect(csp).toContain("script-src 'self' blob:")
    expect(csp).toContain('connect-src ws://localhost:* ws://127.0.0.1:*')
    expect(vite?.server?.cors).toBe(true)
  })

  it('keeps production network access disabled', async () => {
    const csp = getPluginSandboxCsp(false)
    const vite = await config.vite?.(env('build'))

    expect(csp).toContain("script-src 'self' blob:")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).not.toContain('localhost')
    expect(vite?.server).toBeUndefined()
  })
})
