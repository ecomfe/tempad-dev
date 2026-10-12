import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startBundledRewriteRules } from '@/rewrite/setup'
import { logger } from '@/utils/log'

vi.mock('@/utils/log', () => ({ logger: { error: vi.fn() } }))

const getDynamicRules = vi.fn()
const updateDynamicRules = vi.fn()
const updateEnabledRulesets = vi.fn()
const removeStorage = vi.fn()
const clearAlarm = vi.fn()
const onInstalled = vi.fn()
const onStartup = vi.fn()
const fetchMock = vi.fn()

async function start() {
  startBundledRewriteRules()
  await onStartup.mock.calls[0][0]()
}

beforeEach(() => {
  vi.resetAllMocks()
  getDynamicRules.mockResolvedValue([])
  updateDynamicRules.mockResolvedValue(undefined)
  updateEnabledRulesets.mockResolvedValue(undefined)
  removeStorage.mockResolvedValue(undefined)
  clearAlarm.mockResolvedValue(false)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('browser', {
    runtime: {
      onInstalled: { addListener: onInstalled },
      onStartup: { addListener: onStartup }
    },
    storage: { local: { remove: removeStorage } },
    alarms: { clear: clearAlarm },
    declarativeNetRequest: { getDynamicRules, updateDynamicRules, updateEnabledRulesets }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('packaged rewrite activation', () => {
  it('activates static rules without downloads or installing dynamic rules', async () => {
    await start()

    expect(updateEnabledRulesets).toHaveBeenCalledExactlyOnceWith({
      enableRulesetIds: ['figma']
    })
    expect(updateDynamicRules).not.toHaveBeenCalled()
    expect(removeStorage).toHaveBeenCalledExactlyOnceWith('rewrite-rules')
    expect(clearAlarm).toHaveBeenCalledExactlyOnceWith('sync-rules')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('removes every persisted dynamic rule after enabling the packaged fallback', async () => {
    getDynamicRules.mockResolvedValue([
      { id: 1 },
      {
        id: 2,
        action: { type: 'redirect', redirect: { url: 'https://rewrite.invalid/figma.js' } }
      },
      { id: 99 }
    ])
    await start()

    expect(updateDynamicRules).toHaveBeenCalledExactlyOnceWith({ removeRuleIds: [1, 2, 99] })
    expect(updateEnabledRulesets.mock.invocationCallOrder[0]).toBeLessThan(
      updateDynamicRules.mock.invocationCallOrder[0]
    )
    expect(removeStorage).toHaveBeenCalledWith('rewrite-rules')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shares activation across worker startup, installation and browser startup', async () => {
    startBundledRewriteRules()
    await Promise.all([onInstalled.mock.calls[0][0](), onStartup.mock.calls[0][0]()])
    await onStartup.mock.calls[0][0]()

    expect(updateEnabledRulesets).toHaveBeenCalledOnce()
    expect(getDynamicRules).toHaveBeenCalledOnce()
    expect(removeStorage).toHaveBeenCalledOnce()
    expect(clearAlarm).toHaveBeenCalledOnce()
  })

  it.each([updateEnabledRulesets, getDynamicRules, updateDynamicRules, clearAlarm, removeStorage])(
    'reports a Chrome API failure and retries activation on the next lifecycle event',
    async (failingApi) => {
      getDynamicRules.mockResolvedValue([{ id: 2 }])
      const error = new Error('temporarily unavailable')
      failingApi.mockRejectedValueOnce(error)
      await start()
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        'Failed to activate bundled rewrite rules:',
        error
      )

      await onInstalled.mock.calls[0][0]()
      expect(removeStorage).toHaveBeenCalledWith('rewrite-rules')
      expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [2] })
      expect(logger.error).toHaveBeenCalledOnce()
    }
  )
})
