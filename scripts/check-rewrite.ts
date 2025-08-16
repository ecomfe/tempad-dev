import { GROUPS } from '@/rewrite/config'
import { analyze } from '@/rewrite/shared'
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
      console.log(`Captured script: ${url}`)
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
    console.log(`Page loaded at ${page.url()}.`)

    let matched: string | null = null
    let rewritable = false

    for (const { url, content } of scripts) {
      const { matched: m, rewritable: r } = analyze(content, GROUPS)
      if (!m) {
        continue
      }
      matched = url
      console.log(`Matched script: ${url}`)
      if (r) {
        rewritable = true
        console.log(`Rewritable script: ${url}`)
        break
      }
    }

    if (!matched) {
      console.log('❌ No matched script found.')
      return false
    }

    console.log(`✅ Matched script: ${matched}`)

    if (!rewritable) {
      console.log('❌ Rewrite pattern not found.')
      return false
    }

    console.log('✅ Rewrite pattern found.')
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
