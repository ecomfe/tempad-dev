import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startBundledRewriteRules } from '@/rewrite/setup'
import { logger } from '@/utils/log'

vi.mock('@/utils/log', () => ({ logger: { error: vi.fn() } }))

const state = {
  dynamicRules: [] as { id: number }[],
  alarms: new Set<string>()
}
const onInstalled = vi.fn<(callback: () => void) => void>()
const onStartup = vi.fn<(callback: () => void) => void>()
const getDynamicRules = vi.fn(async () => state.dynamicRules)
const updateDynamicRules = vi.fn(async ({ removeRuleIds }: { removeRuleIds: number[] }) => {
  state.dynamicRules = state.dynamicRules.filter(({ id }) => !removeRuleIds.includes(id))
})
const clearAlarm = vi.fn(async (name: string) => state.alarms.delete(name))
const fetchMock = vi.fn()

async function expectActive() {
  await vi.waitFor(() => {
    expect(state.dynamicRules).toEqual([])
    expect(state.alarms.has('sync-rules')).toBe(false)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.dynamicRules = []
  state.alarms = new Set(['sync-rules', 'unrelated'])
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('browser', {
    runtime: { onInstalled: { addListener: onInstalled }, onStartup: { addListener: onStartup } },
    alarms: { clear: clearAlarm },
    declarativeNetRequest: { getDynamicRules, updateDynamicRules }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('packaged rewrite activation', () => {
  it('leaves manifest-managed rules untouched on a clean profile', async () => {
    startBundledRewriteRules()
    await expectActive()
    expect(updateDynamicRules).not.toHaveBeenCalled()
  })

  it('removes persisted dynamic redirects and the old alarm without downloads', async () => {
    state.dynamicRules = [{ id: 1 }, { id: 2 }, { id: 99 }]
    startBundledRewriteRules()
    await expectActive()
    expect(state.alarms).toEqual(new Set(['unrelated']))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shares one activation across simultaneous lifecycle events', async () => {
    startBundledRewriteRules()
    expect(onInstalled).toHaveBeenCalledOnce()
    expect(onStartup).toHaveBeenCalledOnce()
    onInstalled.mock.calls[0]![0]()
    onStartup.mock.calls[0]![0]()
    await expectActive()
    expect(getDynamicRules).toHaveBeenCalledOnce()
  })

  it.each([getDynamicRules, updateDynamicRules, clearAlarm])(
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
      onStartup.mock.calls[0]![0]()
      await expectActive()
      expect(logger.error).toHaveBeenCalledOnce()
    }
  )
})
