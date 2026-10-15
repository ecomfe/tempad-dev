// Frozen production rewrite behavior from 2aa22a36b90599cd0e1ef496a635d5af8ff0e85c:
// entrypoints/background.ts and rewrite/shared.ts. Type annotations/imports,
// the DEV-only bundled-rules branch, logging and the unrelated MCP broker are omitted.
// This reconstructs the historical source; it is not a Chrome Web Store artifact.
const browser = globalThis.chrome
const RULES_URL = 'https://ecomfe.github.io/tempad-dev/figma.json'
const SYNC_ALARM = 'sync-rules'
const SYNC_INTERVAL_MINUTES = 10

function isRecord(value) {
  return value !== null && typeof value === 'object'
}

function isRule(value) {
  if (!isRecord(value)) return false
  return typeof value.id === 'number' && isRecord(value.action) && isRecord(value.condition)
}

function isRules(value) {
  return Array.isArray(value) && value.every(isRule)
}

async function loadRules(url, init) {
  try {
    const response = await globalThis.fetch(url, init)
    if (!response.ok) return null
    const payload = await response.json()
    return isRules(payload) ? payload : null
  } catch {
    return null
  }
}

async function syncRules() {
  try {
    const remoteRules = await loadRules(RULES_URL, { cache: 'no-store' })
    if (!remoteRules) return
    const oldIds = (await browser.declarativeNetRequest.getDynamicRules()).map(({ id }) => id)
    await browser.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['figma'] })
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldIds,
      addRules: remoteRules
    })
  } catch {
    // The released worker logs failed downloads or rule updates and retains its state.
  }
}

browser.runtime.onInstalled.addListener(syncRules)
browser.runtime.onStartup.addListener(syncRules)
browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES })
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncRules()
})
