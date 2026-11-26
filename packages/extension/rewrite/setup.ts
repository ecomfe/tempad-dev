import { logger } from '@/utils/log'

export function startBundledRewriteRules(): void {
  let ready: Promise<void> | undefined

  async function activateRules(): Promise<void> {
    // Chrome restores manifest-enabled static rules on update. Dynamic rules survive it.
    const previous = await browser.declarativeNetRequest.getDynamicRules()
    if (previous.length) {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: previous.map(({ id }) => id)
      })
    }
    // Chrome persists alarms across updates; keep access only to remove the old scheduler.
    await browser.alarms.clear('sync-rules')
  }

  function restoreRules(): Promise<void> {
    return (ready ??= activateRules().catch((error) => {
      ready = undefined
      logger.error('Failed to activate bundled rewrite rules:', error)
    }))
  }

  browser.runtime.onInstalled.addListener(() => void restoreRules())
  browser.runtime.onStartup.addListener(() => void restoreRules())
  void restoreRules()
}
