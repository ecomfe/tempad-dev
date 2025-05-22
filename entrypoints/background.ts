const RULE_URL =
  'https://raw.githubusercontent.com/ecomfe/tempad-dev/refs/heads/main/public/rules/figma.json'

const SYNC_ALARM = 'sync-rules'
const SYNC_INTERVAL_MINUTES = 10

async function fetchRules() {
  const res = await fetch(RULE_URL, { cache: 'no-store' })
  if (!res.ok) {
    console.error('[tempad-dev] Failed to fetch rules:', res.statusText)
  }

  const newRules = await res.json()
  const oldIds = (await browser.declarativeNetRequest.getDynamicRules()).map(({ id }) => id)

  await browser.declarativeNetRequest.updateEnabledRulesets({
    disableRulesetIds: ['figma']
  })

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules: newRules
  })

  console.log(`[tempad-dev] Updated ${newRules.length} rule${newRules.length === 1 ? '' : 's'}.`)
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
