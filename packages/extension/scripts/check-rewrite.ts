import { pathToFileURL } from 'node:url'
import { chromium, type Page, type Response } from 'playwright'

import { GROUPS } from '@/rewrite/config'
import { REWRITE_TARGET_REGEX } from '@/rewrite/rules'
import { applyGroups } from '@/rewrite/shared'
import { logger } from '@/utils/log'

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

export async function runCheck() {
  const scriptReads: Promise<{ url: string; content: string } | { error: unknown }>[] = []

  const browser = await chromium.launch()
  let page: Page | undefined
  const captureScript = (response: Response) => {
    if (response.request().resourceType() !== 'script') return
    const url = response.url()
    if (!REWRITE_TARGET_REGEX.test(url)) return
    // Observe failures immediately, including when navigation fails before the report.
    scriptReads.push(
      response.text().then(
        (content) => ({ url, content }),
        (error: unknown) => ({ error })
      )
    )
  }

  try {
    page = await browser.newPage()
    page.on('response', captureScript)

    try {
      await page.goto('https://www.figma.com/login', { timeout: 10000 })
      logger.log('Logging in...')
    } catch {
      logger.error('Failed to load the login page. Please check your internet connection.')
      return false
    }

    await page.fill('input[name="email"]', process.env.FIGMA_EMAIL || '')
    await page.fill('input[name="password"]', process.env.FIGMA_PASSWORD || '')
    // A navigation can invalidate the previous document's response bodies.
    await Promise.all(scriptReads)
    await page.click('button[type="submit"]')

    try {
      await page.waitForURL(/^(?!.*login).*$/, { timeout: 10000 })
      logger.log('Logged in successfully.')
    } catch {
      logger.error('Login failed. Please check your credentials.')
      return false
    }

    await page.waitForLoadState('load')
    await Promise.all(scriptReads)
    logger.log(`Page loaded at <${page.url()}>.`)

    logger.log(
      `Navigating to the design file: <https://www.figma.com/design/${process.env.FIGMA_FILE_KEY}>.`
    )
    await page.goto(`https://www.figma.com/design/${process.env.FIGMA_FILE_KEY}`)
    logger.log(`Page loaded at <${page.url()}>.`)
    page.off('response', captureScript)
    // Navigation completion does not await asynchronous response listeners.
    const scripts = await Promise.all(scriptReads)

    const replacementStats = GROUPS.map((group) =>
      group.replacements.map(() => ({
        hits: [] as string[],
        noEffect: [] as string[]
      }))
    )

    let matchedCount = 0
    let rewrittenCount = 0
    const notRewritten: string[] = []

    for (const script of scripts) {
      if ('error' in script) throw script.error
      const { url, content } = script
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
        const stat = replacementStats[groupIndex]![replacementIndex]!
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
        const group = GROUPS[groupIndex]!
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
    page?.off('response', captureScript)
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    logger.error('Unexpected error:', error)
    process.exit(1)
  })
}
