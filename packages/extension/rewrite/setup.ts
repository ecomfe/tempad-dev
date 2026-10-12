import { logger } from '@/utils/log'

export function startBundledRewriteRules(): void {
  let ready: Promise<void> | undefined

  async function activateRules(): Promise<void> {
    // Previous versions disabled this ruleset and persisted remote rules across updates.
    await browser.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['figma'] })
    const previous = await browser.declarativeNetRequest.getDynamicRules()
    if (previous.length) {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: previous.map(({ id }) => id)
      })
    }
    // Chrome persists alarms across updates; keep access only to remove the old scheduler.
    await browser.alarms.clear('sync-rules')
    await browser.storage.local.remove('rewrite-rules')
  }

  function restoreRules(): Promise<void> {
    return (ready ??= activateRules().catch((error) => {
      ready = undefined
      logger.error('Failed to activate bundled rewrite rules:', error)
    }))
  }

  browser.runtime.onInstalled.addListener(restoreRules)
  browser.runtime.onStartup.addListener(restoreRules)
  void restoreRules()
}
