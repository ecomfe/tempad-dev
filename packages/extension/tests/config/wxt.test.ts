import type { ConfigEnv, Wxt, WxtHooks } from 'wxt'

import { afterEach, describe, expect, it, vi } from 'vitest'

import config, { extensionRuntimeProfile, getPluginSandboxCsp } from '../../wxt.config'

const env = (command: ConfigEnv['command']): ConfigEnv => ({
  browser: 'chrome',
  command,
  manifestVersion: 3,
  mode: command === 'serve' ? 'development' : 'production'
})

afterEach(() => vi.unstubAllEnvs())

describe('WXT plugin sandbox configuration', () => {
  it.each([false, true])('only packages release profiles (checkout: %s)', async (checkout) => {
    vi.stubEnv(
      'TEMPAD_MCP_DEV_CHECKOUT',
      checkout ? new URL('../../../../', import.meta.url).pathname : undefined
    )
    // WXT runs zip with command "build", including programmatic zip() calls.
    const wxt = { config: { command: 'build' }, logger: { info: vi.fn() } } as unknown as Wxt
    const hooks = config.hooks as Partial<WxtHooks>
    await hooks['build:before']!(wxt)
    expect(wxt.logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`TemPad MCP profile: ${checkout ? 'checkout' : 'release'}`)
    )
    const zip = () => hooks['zip:start']!(wxt)
    if (checkout) expect(zip).toThrow('Unset TEMPAD_MCP_DEV_CHECKOUT')
    else {
      expect(zip).not.toThrow()
      const vite = await config.vite?.(env('build'))
      expect(JSON.parse(vite!.define!.__TEMPAD_RUNTIME_PROFILE__)).toEqual({ kind: 'release' })
    }
  })

  it('separates release, development serving and explicitly pinned production builds', () => {
    expect(extensionRuntimeProfile('build')).toEqual({ kind: 'release' })
    const checkout = new URL('../../../../', import.meta.url).pathname
    expect(extensionRuntimeProfile('build', checkout)).toEqual(extensionRuntimeProfile('serve'))
    expect(extensionRuntimeProfile('serve').kind).toBe('checkout')
    expect(() => extensionRuntimeProfile('build', '/')).toThrow('does not belong')
  })
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
