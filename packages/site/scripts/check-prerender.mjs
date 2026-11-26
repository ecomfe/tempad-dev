import assert from 'node:assert/strict'
import { log } from 'node:console'
import { URL } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
const url = `http://127.0.0.1:${server.httpServer.address().port}`
try {
  const browser = await chromium.launch()
  try {
    const staticPage = await browser.newPage({ javaScriptEnabled: false })
    await staticPage.route('https://**', (route) => route.abort())
    await staticPage.goto(url + '/#connect')
    assert.match(await staticPage.locator('h1').innerText(), /Design & dev\./)
    assert.ok(await staticPage.locator('#connect').getByRole('heading').count())
    assert.ok(await staticPage.getByRole('link', { name: 'Read the guide' }).isVisible())
    await staticPage.close()

    const page = await browser.newPage({
      colorScheme: 'light',
      viewport: { width: 390, height: 844 }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (/hydrat/i.test(message.text())) errors.push(message.text())
    })
    await page.route('https://**', (route) => route.abort())
    await page.route('**/_vercel/**', (route) => route.fulfill({ body: '' }))
    await page.addInitScript(() =>
      globalThis.localStorage.setItem('tempad-dev-site-color-mode', 'dark')
    )
    // Keep the JS bundle pending to exercise the static deep link and the pre-paint theme.
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    await page.route('**/assets/index-*.js', async (route) => {
      await held
      await route.continue()
    })
    await page.goto(url + '/#connect', { waitUntil: 'commit' })
    await page.locator('#connect').waitFor()
    assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), true)
    const header = await page.locator('h1').elementHandle()
    release()
    await page.getByRole('button', { name: 'Dark mode' }).waitFor()
    assert.equal(await header.evaluate((el) => el === el.ownerDocument.querySelector('h1')), true)
    assert.equal(new URL(page.url()).hash, '#connect')
    await page.getByRole('tab', { name: 'Hermes Agent' }).click()
    assert.match(await page.getByRole('tabpanel').last().innerText(), /\.hermes\/config\.yaml/)
    await page
      .getByRole('button', { name: /Read the Design in Figma skill/ })
      .first()
      .click()
    const table = page.getByRole('dialog').getByRole('table').first()
    await table.waitFor()
    assert.ok((await table.getByRole('columnheader').count()) >= 2)
    assert.ok((await table.getByRole('cell').count()) >= 2)
    assert.deepEqual(errors, [])
    log(
      'Prerendered content, hash navigation, stored appearance, Vue hydration and skill table passed.'
    )
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
