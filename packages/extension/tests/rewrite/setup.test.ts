import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startBundledRewriteRules } from '@/rewrite/setup'
import { logger } from '@/utils/log'

vi.mock('@/utils/log', () => ({ logger: { error: vi.fn() } }))

const state = {
  enabled: new Set<string>(),
  dynamicRules: [] as { id: number }[],
  alarms: new Set<string>(),
  storage: new Set<string>()
}
const onInstalled = vi.fn<(callback: () => void) => void>()
const onStartup = vi.fn<(callback: () => void) => void>()
const getDynamicRules = vi.fn(async () => state.dynamicRules)
const updateDynamicRules = vi.fn(async ({ removeRuleIds }: { removeRuleIds: number[] }) => {
  // Keep a working replacement before removing a persisted redirect.
  expect(state.enabled.has('figma')).toBe(true)
  state.dynamicRules = state.dynamicRules.filter(({ id }) => !removeRuleIds.includes(id))
})
const updateEnabledRulesets = vi.fn(
  async ({ enableRulesetIds }: { enableRulesetIds: string[] }) => {
    for (const id of enableRulesetIds) state.enabled.add(id)
  }
)
const removeStorage = vi.fn(async (key: string) => {
  state.storage.delete(key)
})
const clearAlarm = vi.fn(async (name: string) => state.alarms.delete(name))
const fetchMock = vi.fn()

async function expectActive() {
  await vi.waitFor(() => {
    expect(state.enabled).toEqual(new Set(['figma']))
    expect(state.dynamicRules).toEqual([])
    expect(state.alarms.has('sync-rules')).toBe(false)
    expect(state.storage.has('rewrite-rules')).toBe(false)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.enabled.clear()
  state.dynamicRules = []
  state.alarms = new Set(['sync-rules', 'unrelated'])
  state.storage = new Set(['rewrite-rules', 'preferences'])
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('browser', {
    runtime: { onInstalled: { addListener: onInstalled }, onStartup: { addListener: onStartup } },
    storage: { local: { remove: removeStorage } },
    alarms: { clear: clearAlarm },
    declarativeNetRequest: { getDynamicRules, updateDynamicRules, updateEnabledRulesets }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('packaged rewrite activation', () => {
  it('enables packaged rules and removes only obsolete persistence without downloads', async () => {
    startBundledRewriteRules()
    await expectActive()
    expect(state.alarms).toEqual(new Set(['unrelated']))
    expect(state.storage).toEqual(new Set(['preferences']))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('removes old dynamic redirects after enabling the packaged fallback', async () => {
    state.dynamicRules = [{ id: 1 }, { id: 2 }, { id: 99 }]
    startBundledRewriteRules()
    await expectActive()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shares one activation across simultaneous lifecycle events', async () => {
    startBundledRewriteRules()
    expect(onInstalled).toHaveBeenCalledOnce()
    expect(onStartup).toHaveBeenCalledOnce()
    onInstalled.mock.calls[0]![0]()
    onStartup.mock.calls[0]![0]()
    await expectActive()
    expect(updateEnabledRulesets).toHaveBeenCalledOnce()
  })

  it.each([updateEnabledRulesets, getDynamicRules, updateDynamicRules, clearAlarm, removeStorage])(
    'recovers the final rule state after a Chrome API failure',
    async (failingApi) => {
      state.dynamicRules = [{ id: 2 }]
      const error = new Error('temporarily unavailable')
      failingApi.mockRejectedValueOnce(error)
      startBundledRewriteRules()
      await vi.waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to activate bundled rewrite rules:',
          error
        )
      )
      expect(onInstalled).toHaveBeenCalledOnce()
      onInstalled.mock.calls[0]![0]()
      await expectActive()
      expect(logger.error).toHaveBeenCalledOnce()
    }
  )
})
