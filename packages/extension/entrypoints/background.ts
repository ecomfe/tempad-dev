import rules from '@/public/rules/figma.json'
import { isRules, loadRules, RULES_URL } from '@/rewrite/shared'
import { logger } from '@/utils/log'

import type { Rules } from '../types/rewrite'

const SYNC_ALARM = 'sync-rules'
const SYNC_INTERVAL_MINUTES = 10

async function syncRules() {
  try {
    let newRules: Rules

    if (import.meta.env.DEV) {
      if (!isRules(rules)) {
        logger.error('Bundled rewrite rules are invalid.')
        return
      }
      newRules = rules
      logger.log('Loaded local rules (dev).')
    } else {
      const remoteRules = await loadRules(RULES_URL, { cache: 'no-store' })
      if (!remoteRules) {
        logger.error('Failed to fetch rewrite rules.')
        return
      }
      newRules = remoteRules
    }

    const oldIds = (await browser.declarativeNetRequest.getDynamicRules()).map(({ id }) => id)

    await browser.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ['figma']
    })

    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldIds,
      addRules: newRules
    })
    logger.log(`Updated ${newRules.length} rule${newRules.length === 1 ? '' : 's'}.`)
  } catch (error) {
    logger.error('Error fetching rules:', error)
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(syncRules)

  browser.runtime.onStartup.addListener(syncRules)

  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES })
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === SYNC_ALARM) {
      syncRules()
    }
  })
})
