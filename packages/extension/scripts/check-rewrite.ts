import { chromium } from 'playwright-chromium'

import { GROUPS } from '@/rewrite/config'
import { applyGroups } from '@/rewrite/shared'
import { logger } from '@/utils/log'

import rules from '../public/rules/figma.json'

const redirectRule = rules.find((rule) => rule.action.type === 'redirect')
const ASSETS_PATTERN = new RegExp(redirectRule?.condition?.regexFilter || /a^/)
const MAX_RETRIES = 3

type RewriteGroup = (typeof GROUPS)[number]

function describeGroup(group: RewriteGroup, index: number) {
  if (group.markers?.length) {
    return `#${index + 1} markers: ${group.markers.join(', ')}`
  }
  if (group.replacements[0]) {
    return `#${index + 1} pattern: ${String(group.replacements[0].pattern)}`
  }
  return `#${index + 1}`
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
      logger.log(`Captured script: <${url}>.`)
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

    const groupStats = GROUPS.map(() => ({
      matched: [] as string[],
      rewritten: [] as string[],
      notRewritten: [] as string[]
    }))

    let matchedCount = 0
    let rewrittenCount = 0
    const notRewritten: string[] = []

    for (const { url, content } of scripts) {
      const { changed, matchedGroups, rewrittenGroups } = applyGroups(content, GROUPS)
      if (matchedGroups.length === 0) {
        continue
      }

      matchedCount++
      logger.log(`Matched script: <${url}>.`)

      if (changed) {
        rewrittenCount++
        logger.log(`Rewritable (would change): <${url}>.`)
      } else {
        notRewritten.push(url)
        logger.log(`Not rewritable (no change produced): <${url}>.`)
      }

      const rewrittenSet = new Set(rewrittenGroups)
      for (const index of matchedGroups) {
        groupStats[index].matched.push(url)
        if (rewrittenSet.has(index)) {
          groupStats[index].rewritten.push(url)
        } else {
          groupStats[index].notRewritten.push(url)
        }
      }
    }

    const missingGroups = groupStats
      .map((stat, index) => (stat.matched.length === 0 ? index : -1))
      .filter((index) => index !== -1)

    const noRewriteGroups = groupStats
      .map((stat, index) => (stat.matched.length > 0 && stat.rewritten.length === 0 ? index : -1))
      .filter((index) => index !== -1)

    if (matchedCount === 0) {
      logger.log('❌ No matched script found.')
    } else {
      logger.log(`✅ Matched ${matchedCount} script(s).`)
    }

    if (rewrittenCount !== matchedCount) {
      logger.log('❌ Some matched scripts would not be rewritten by rules:')
      notRewritten.forEach((url) => logger.log(` - <${url}>`))
      return false
    }

    if (missingGroups.length > 0) {
      logger.log('❌ Some rewrite groups were not matched by any script:')
      missingGroups.forEach((index) => logger.log(` - ${describeGroup(GROUPS[index], index)}`))
      return false
    }

    if (noRewriteGroups.length > 0) {
      logger.log('❌ Some rewrite groups matched scripts but produced no rewrite:')
      noRewriteGroups.forEach((index) => {
        const urls = groupStats[index].matched
        logger.log(` - ${describeGroup(GROUPS[index], index)} (matched ${urls.length} script(s))`)
        urls.forEach((url) => logger.log(`   - <${url}>`))
      })
      return false
    }

    logger.log('✅ All matched scripts would be rewritten by rules.')
    logger.log(`✅ All ${GROUPS.length} rewrite groups matched and rewrote successfully.`)
    return true
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
