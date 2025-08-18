import { GROUPS } from '@/rewrite/config'
import { applyGroups, groupMatches } from '@/rewrite/shared'
import { chromium } from 'playwright-chromium'
import rules from '../public/rules/figma.json'

const redirectRule = rules.find((rule) => rule.action.type === 'redirect')
const ASSETS_PATTERN = new RegExp(redirectRule?.condition?.regexFilter || /a^/)
const MAX_RETRIES = 3

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
      console.log(`Captured script: <${url}>.`)
    })

    try {
      await page.goto('https://www.figma.com/login', { timeout: 10000 })
      console.log('Logging in...')
    } catch {
      console.error('Failed to load the login page. Please check your internet connection.')
      return false
    }

    await page.fill('input[name="email"]', process.env.FIGMA_EMAIL || '')
    await page.fill('input[name="password"]', process.env.FIGMA_PASSWORD || '')
    await page.click('button[type="submit"]')

    try {
      await page.waitForURL(/^(?!.*login).*$/, { timeout: 10000 })
      console.log('Logged in successfully.')
    } catch {
      console.error('Login failed. Please check your credentials.')
      return false
    }

    await page.waitForLoadState('load')
    console.log(`Page loaded at <${page.url()}>.`)

    console.log(
      `Navigating to the design file: <https://www.figma.com/design/${process.env.FIGMA_FILE_KEY}>.`
    )
    await page.goto(`https://www.figma.com/design/${process.env.FIGMA_FILE_KEY}`)
    console.log(`Page loaded at <${page.url()}>.`)

    let matchedCount = 0
    let rewrittenCount = 0
    const notRewritten: string[] = []

    for (const { url, content } of scripts) {
      const matched = GROUPS.some((group) => groupMatches(content, group))
      if (!matched) {
        continue
      }

      matchedCount++
      console.log(`Matched script: <${url}>.`)

      const { changed } = applyGroups(content, GROUPS)
      if (changed) {
        rewrittenCount++
        console.log(`Rewritable (would change): <${url}>.`)
      } else {
        notRewritten.push(url)
        console.log(`Not rewritable (no change produced): <${url}>.`)
      }
    }

    if (matchedCount === 0) {
      console.log('❌ No matched script found.')
      return false
    }

    console.log(`✅ Matched ${matchedCount} script(s).`)

    if (rewrittenCount !== matchedCount) {
      console.log('❌ Some matched scripts would not be rewritten by rules:')
      notRewritten.forEach((url) => console.log(` - <${url}>`))
      return false
    }

    console.log('✅ All matched scripts would be rewritten by rules.')
    return true
  } finally {
    await browser.close()
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`\nRetry attempt ${attempt} of ${MAX_RETRIES}...`)
    }

    const success = await runCheck()
    if (success) {
      process.exit(0)
    }

    if (attempt < MAX_RETRIES) {
      console.log(`Attempt ${attempt} failed. Waiting before retry...`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }

  console.log(`❌ All ${MAX_RETRIES} attempts failed.`)
  process.exit(1)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
