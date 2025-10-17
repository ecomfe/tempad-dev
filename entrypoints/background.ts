import { RULES_URL } from '@/rewrite/shared'
import rules from '@/public/rules/figma.json'
import type { Rules } from '../types/rewrite'

const SYNC_ALARM = 'sync-rules'
const SYNC_INTERVAL_MINUTES = 10

async function fetchRules() {
  try {
    let newRules: Rules

    if (import.meta.env.DEV) {
      newRules = rules as Rules
      console.log('[tempad-dev] Loaded local rules (dev).')
    } else {
      const res = await fetch(RULES_URL, { cache: 'no-store' })
      if (!res.ok) {
        console.error('[tempad-dev] Failed to fetch rules:', res.statusText)
        return
      }

      newRules = (await res.json()) as Rules
    }

    const oldIds = (await browser.declarativeNetRequest.getDynamicRules()).map(({ id }) => id)

    await browser.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ['figma']
    })

    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldIds,
      addRules: newRules
    })
    console.log(`[tempad-dev] Updated ${newRules.length} rule${newRules.length === 1 ? '' : 's'}.`)
  } catch (error) {
    console.error('[tempad-dev] Error fetching rules:', error)
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(fetchRules)

  browser.runtime.onStartup.addListener(fetchRules)

  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES })
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === SYNC_ALARM) {
      fetchRules()
    }
  })
})
