import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Rules } from '@/types/rewrite'

const mocks = vi.hoisted(() => ({ loadRules: vi.fn(), start: vi.fn() }))
vi.mock('@/mcp/broker/service-worker', () => ({
  McpServiceWorkerBroker: class {
    start = mocks.start
  }
}))
vi.mock('@/rewrite/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/rewrite/shared')>()),
  loadRules: mocks.loadRules
}))

beforeEach(() => {
  vi.stubEnv('DEV', false)
  vi.clearAllMocks()
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('rewrite rule migration', () => {
  it('migrates persistent remote redirects before fetching and keeps the last matching pattern offline', async () => {
    let installed: Rules = [
      {
        id: 2,
        action: { type: 'redirect', redirect: { url: 'https://example.test/legacy.js' } },
        condition: { regexFilter: 'previous-pattern', resourceTypes: ['script'] }
      }
    ] as Rules
    const onInstalled = vi.fn()
    const updateDynamicRules = vi.fn(async ({ addRules }: { addRules: Rules }) => {
      installed = addRules
    })
    vi.stubGlobal('defineBackground', (callback: () => void) => callback)
    vi.stubGlobal('browser', {
      declarativeNetRequest: {
        getDynamicRules: async () => installed,
        updateDynamicRules,
        updateEnabledRulesets: vi.fn().mockResolvedValue(undefined)
      },
      runtime: { onInstalled: { addListener: onInstalled }, onStartup: { addListener: vi.fn() } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } }
    })
    mocks.loadRules.mockImplementation(async () => {
      expect(installed.find((rule) => rule.id === 2)?.action.redirect).toEqual({
        extensionPath: '/figma.js'
      })
      return null
    })
    const background = (await import('@/entrypoints/background')).default as unknown as () => void
    background()
    await onInstalled.mock.calls[0][0]()
    expect(installed.find((rule) => rule.id === 2)?.condition.regexFilter).toBe('previous-pattern')
    expect(installed.find((rule) => rule.id === 3)?.action.type).toBe('allow')
    expect(updateDynamicRules).toHaveBeenCalledTimes(1)
    expect(mocks.loadRules).toHaveBeenCalledTimes(1)
  })
})
