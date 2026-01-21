import { chromium } from 'playwright-chromium'

import { GROUPS } from '@/rewrite/config'
import { applyGroups } from '@/rewrite/shared'
import { logger } from '@/utils/log'

import rules from '../public/rules/figma.json'

const redirectRule = rules.find((rule) => rule.action.type === 'redirect')
const ASSETS_PATTERN = new RegExp(redirectRule?.condition?.regexFilter || /a^/)
const MAX_RETRIES = 3

type RewriteGroup = (typeof GROUPS)[number]

function describeReplacement(group: RewriteGroup, groupIndex: number, replacementIndex: number) {
  const pattern = group.replacements[replacementIndex]?.pattern
  const markerText = group.markers?.length ? ` markers: ${group.markers.join(', ')}` : ''
  return `#${groupIndex + 1}.${replacementIndex + 1}${markerText} pattern: ${String(pattern)}`
}

function formatUrls(urls: string[], max = 3) {
  if (urls.length === 0) return 'none'
  const preview = urls.slice(0, max).map((url) => `<${url}>`)
  const suffix = urls.length > max ? ` (+${urls.length - max} more)` : ''
  return `${preview.join(', ')}${suffix}`
}

async function runCheck() {
  const scripts: { url: string; content: string }[] = []

  const browser = await chromium.launch()
  const page = await browser.newPage()

  try {
    page.on('response', async (response) => {
      if (response.request().resourceType() !== 'script') {
        return
      }
      const url = response.url()
      if (!ASSETS_PATTERN.test(url)) {
        return
      }
      const content = await response.text()
      scripts.push({ url, content })
    })

    try {
      await page.goto('https://www.figma.com/login', { timeout: 10000 })
      logger.log('Logging in...')
    } catch {
      logger.error('Failed to load the login page. Please check your internet connection.')
      return false
    }

    await page.fill('input[name="email"]', process.env.FIGMA_EMAIL || '')
    await page.fill('input[name="password"]', process.env.FIGMA_PASSWORD || '')
    await page.click('button[type="submit"]')

    try {
      await page.waitForURL(/^(?!.*login).*$/, { timeout: 10000 })
      logger.log('Logged in successfully.')
    } catch {
      logger.error('Login failed. Please check your credentials.')
      return false
    }

    await page.waitForLoadState('load')
    logger.log(`Page loaded at <${page.url()}>.`)

    logger.log(
      `Navigating to the design file: <https://www.figma.com/design/${process.env.FIGMA_FILE_KEY}>.`
    )
    await page.goto(`https://www.figma.com/design/${process.env.FIGMA_FILE_KEY}`)
    logger.log(`Page loaded at <${page.url()}>.`)

    const replacementStats = GROUPS.map((group) =>
      group.replacements.map(() => ({
        hits: [] as string[],
        noEffect: [] as string[]
      }))
    )

    let matchedCount = 0
    let rewrittenCount = 0
    const notRewritten: string[] = []

    for (const { url, content } of scripts) {
      const {
        changed,
        matchedGroups,
        replacementStats: scriptReplacementStats
      } = applyGroups(content, GROUPS, { logReplacements: false })
      if (matchedGroups.length === 0) {
        continue
      }

      matchedCount++

      if (changed) {
        rewrittenCount++
      } else {
        notRewritten.push(url)
      }

      for (const {
        groupIndex,
        replacementIndex,
        changed: replacementChanged
      } of scriptReplacementStats) {
        const stat = replacementStats[groupIndex][replacementIndex]
        if (replacementChanged) {
          stat.hits.push(url)
        } else {
          stat.noEffect.push(url)
        }
      }
    }

    const missingReplacements = replacementStats.flatMap((groupStats, groupIndex) =>
      groupStats
        .map((stat, replacementIndex) => ({ ...stat, groupIndex, replacementIndex }))
        .filter((stat) => stat.hits.length === 0)
    )

    const totalReplacements = GROUPS.reduce((total, group) => total + group.replacements.length, 0)
    const appliedReplacements = totalReplacements - missingReplacements.length
    const reportLines = ['Rewrite check report']

    reportLines.push(`- Scripts captured: ${scripts.length}`)
    reportLines.push(`- Scripts matched: ${matchedCount}`)
    reportLines.push(`- Scripts rewritable: ${rewrittenCount}`)
    reportLines.push(`- Replacements applied: ${appliedReplacements}/${totalReplacements}`)

    let hasFailure = false
    if (matchedCount === 0) {
      hasFailure = true
      reportLines.push('', 'FAIL: No matched scripts.')
    }

    if (rewrittenCount !== matchedCount) {
      hasFailure = true
      reportLines.push('', 'FAIL: Some matched scripts produced no rewrite.')
      reportLines.push(`- Not rewritable scripts: ${formatUrls(notRewritten)}`)
    }

    if (missingReplacements.length > 0) {
      hasFailure = true
      reportLines.push('', 'FAIL: Some replacements were never applied.')
      missingReplacements.forEach(({ groupIndex, replacementIndex, noEffect }) => {
        const group = GROUPS[groupIndex]
        const statusText =
          noEffect.length > 0 ? `no effect in ${noEffect.length} script(s)` : 'group never matched'
        reportLines.push(
          `- ${describeReplacement(group, groupIndex, replacementIndex)} | ${statusText}`
        )
        if (noEffect.length > 0) {
          reportLines.push(`  Seen in: ${formatUrls(noEffect)}`)
        }
      })
    }

    if (!hasFailure) {
      reportLines.push('', 'PASS: All replacements matched and rewrote successfully.')
    }

    logger.log(reportLines.join('\n'))
    return !hasFailure
  } finally {
    await browser.close()
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      logger.log(`\nRetry attempt ${attempt} of ${MAX_RETRIES}...`)
    }

    const success = await runCheck()
    if (success) {
      process.exit(0)
    }

    if (attempt < MAX_RETRIES) {
      logger.log(`Attempt ${attempt} failed. Waiting before retry...`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }

  logger.log(`❌ All ${MAX_RETRIES} attempts failed.`)
  process.exit(1)
}

main().catch((error) => {
  logger.error('Unexpected error:', error)
  process.exit(1)
})
