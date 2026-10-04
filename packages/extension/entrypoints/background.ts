import { McpServiceWorkerBroker } from '@/mcp/broker/service-worker'
import rules from '@/public/rules/figma.json'
import { isRules, loadRules, localizeRules, RULES_URL } from '@/rewrite/shared'
import { logger } from '@/utils/log'

import type { Rules } from '../types/rewrite'

const SYNC_ALARM = 'sync-rules'
const SYNC_INTERVAL_MINUTES = 10

let syncing: Promise<void> | undefined

async function installRules(newRules: Rules) {
  const oldIds = (await browser.declarativeNetRequest.getDynamicRules()).map(({ id }) => id)
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules: newRules
  })
  await browser.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['figma'] })
}

async function updateRules() {
  try {
    if (!isRules(rules)) {
      logger.error('Bundled rewrite rules are invalid.')
      return
    }
    // Migrate persistent legacy redirects before making any network request.
    const previous = await browser.declarativeNetRequest.getDynamicRules()
    await installRules(localizeRules(rules, previous))
    if (import.meta.env.DEV) return
    const remoteRules = await loadRules(RULES_URL, {
      cache: 'no-cache',
      signal: AbortSignal.timeout(5000)
    })
    if (remoteRules) await installRules(localizeRules(rules, remoteRules))
  } catch (error) {
    logger.error('Error fetching rules:', error)
  }
}

function syncRules(): Promise<void> {
  return (syncing ??= updateRules().finally(() => {
    syncing = undefined
  }))
}

export default defineBackground(() => {
  new McpServiceWorkerBroker().start()

  browser.runtime.onInstalled.addListener(syncRules)

  browser.runtime.onStartup.addListener(syncRules)

  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES })
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === SYNC_ALARM) {
      syncRules()
    }
  })
})
