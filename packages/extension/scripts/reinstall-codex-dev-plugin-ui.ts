import type { Page } from 'playwright'

import { threadPageUrl } from './reinstall-codex-dev-plugin-runtime'

const displayName = 'TemPad Dev (Dev)'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function openPlugin(page: Page, reopen = false) {
  // The heading's accessible name also includes its folder-marketplace icon.
  const title = page.getByRole('heading', { level: 1 }).filter({ hasText: /^TemPad Dev \(Dev\)$/ })
  if (!reopen && (await title.isVisible())) return
  const main = page.getByRole('main')
  const search = main.getByRole('textbox', { name: 'Search plugins', exact: true })
  if (!(await search.isVisible())) {
    await page
      .getByRole('button', { name: 'Plugins', exact: true })
      .evaluate((element: HTMLElement) => element.click())
    await page.getByRole('heading', { name: 'Plugins', exact: true }).waitFor({ state: 'visible' })
  }
  // Navigation and debounced search settle separately; transient results can reset the catalog.
  await pause(500)
  await search.evaluate((input: HTMLInputElement, value) => {
    input.blur()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('Could not update the plugin search input.')
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, displayName)
  await pause(500)
  await main
    .getByRole('button')
    .filter({ has: page.getByText(displayName, { exact: true }) })
    .and(page.locator(':not([data-search-result-active])'))
    .or(main.getByRole('link', { name: displayName, exact: true }))
    .evaluate((element: HTMLElement) => element.click())
  await search.waitFor({ state: 'hidden' })
  await title.waitFor({ state: 'visible' })
  await main
    .getByRole('button', { name: 'Install plugin', exact: true })
    .or(main.getByRole('button', { name: 'More actions', exact: true }))
    .first()
    .waitFor({ state: 'visible' })
}

export async function reinstallInApp(
  page: Page,
  version: string,
  afterUninstall: () => Promise<void>
) {
  await openPlugin(page)
  // Detail and sticky-header controls can both render the same plugin action.
  const main = page.getByRole('main')
  const install = main.getByRole('button', { name: 'Install plugin', exact: true }).first()
  const actions = main.getByRole('button', { name: 'More actions', exact: true }).first()
  if (await actions.isVisible()) {
    await actions.click()
    await page.getByRole('menuitem', { name: 'Uninstall', exact: true }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Uninstall', exact: true })
    await confirm.or(install).first().waitFor({ state: 'visible' })
    if (await confirm.isVisible()) await confirm.click()
    await install.waitFor({ state: 'visible' })
  }
  // Installation must not proceed until disk state AND stable process exit are verified.
  await afterUninstall()
  // A local rebuild can leave the open detail page showing the previous manifest.
  await openPlugin(page, true)
  await main.getByText(version, { exact: true }).waitFor({ state: 'visible' })
  await install.evaluate((element: HTMLElement) => element.click())
  await install.waitFor({ state: 'hidden' })
  // Installing can navigate to a new chat. Reopen the detail page to verify its state.
  await openPlugin(page, true)
  await actions.waitFor({ state: 'visible' })
  await main.getByText(version, { exact: true }).waitFor({ state: 'visible' })
  if (await install.isVisible())
    throw new Error('Codex App still offers installation; reinstall is not confirmed.')
}

export async function resumeThreadInApp(
  page: Page,
  threadId: string,
  message: string,
  beforeSend: () => Promise<void>
): Promise<'sent' | 'already-running'> {
  // A fresh local route avoids relying on whichever task happened to be selected at restart.
  await page.goto(threadPageUrl(page.url(), threadId))
  const composer = page.locator('[data-codex-composer-root]:visible')
  await composer.waitFor({ state: 'visible' })
  const editor = composer.locator('[contenteditable="true"]:visible, textarea:visible')
  await editor.waitFor({ state: 'visible' })
  if (await composer.getByRole('button', { name: 'Stop', exact: true }).isVisible())
    return 'already-running'
  const draft = await editor.evaluate((element) =>
    element instanceof HTMLTextAreaElement ? element.value : element.textContent
  )
  if (draft?.trim())
    throw new Error('The original task has a draft; leaving it intact instead of resuming.')
  const send = composer.getByRole('button', { name: 'Send', exact: true })
  // Empty interrupted tasks offer Resume, and an empty idle composer may offer voice.
  await editor.fill(message)
  await send.waitFor({ state: 'visible' })
  // Persist uncertainty before the single click. A crash must never trigger an automatic retry.
  await beforeSend()
  await send.click()
  // Text locators handle inline links and normalized whitespace in the transcript.
  await page
    .getByText(message, { exact: true })
    .and(page.locator(':not([data-codex-composer-root], [data-codex-composer-root] *)'))
    .waitFor({ state: 'visible' })
  return 'sent'
}
