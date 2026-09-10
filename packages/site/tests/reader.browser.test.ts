import { OverlayScrollbars } from 'overlayscrollbars'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createApp } from 'vue'

import App from '@/App.vue'
import 'overlayscrollbars/styles/overlayscrollbars.css'

import '@/styles.css'

let app: ReturnType<typeof createApp> | undefined
let host: HTMLElement | undefined

afterEach(() => {
  app?.unmount()
  host?.remove()
  window.scrollTo({ top: 0, behavior: 'instant' })
})

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const target = document.querySelector<T>(selector)
  if (!target) throw new Error(`Missing ${selector}`)
  return target
}

it.each([1280, 390])(
  'keeps file selection, scrollbars, anchors, and history working at %ipx',
  async (width) => {
    await page.viewport(width, 900)
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(App)
    app.mount(host)

    await expect.poll(() => OverlayScrollbars.valid(OverlayScrollbars(document.body))).toBe(true)
    window.scrollTo({ top: 500, behavior: 'instant' })
    await expect.poll(() => window.scrollY).toBe(500)
    await page.getByRole('button', { name: /Read the canvas skill/ }).click()
    await expect.poll(() => element<HTMLDialogElement>('dialog').open).toBe(true)
    expect(OverlayScrollbars(document.body)?.options().overflow.y).toBe('hidden')

    const article = element('.site-skill-prose')
    const sidebar = element('.site-skill-dialog-sidebar')
    expect(OverlayScrollbars(article)?.elements().viewport).toBe(article)
    expect(OverlayScrollbars(sidebar)?.elements().viewport).toBe(sidebar)
    expect(article.scrollHeight).toBeGreaterThan(article.clientHeight)
    await expect
      .poll(() =>
        Array.from(article.querySelectorAll<HTMLElement>('pre')).every((block) =>
          OverlayScrollbars.valid(OverlayScrollbars(block))
        )
      )
      .toBe(true)

    const selector = page.getByRole('combobox')
    const selectorTop = element('[role="combobox"]').getBoundingClientRect().top
    await selector.click()
    const listbox = element('[role="listbox"]')
    expect(OverlayScrollbars.valid(OverlayScrollbars(listbox))).toBe(true)
    expect(listbox.scrollHeight).toBeGreaterThan(listbox.clientHeight)
    await userEvent.keyboard('{End}{Enter}')
    await expect
      .poll(() => element('[role="combobox"]').getAttribute('aria-expanded'))
      .toBe('false')
    expect(element('.site-file-select-value').textContent).not.toBe('SKILL.md')
    expect(element('[role="combobox"]').getBoundingClientRect().top).toBe(selectorTop)
    expect(article.scrollTop).toBe(0)

    await page.getByRole('button', { name: 'Back to previous file' }).click()
    await expect.poll(() => element('.site-file-select-value').textContent).toBe('SKILL.md')
    if (width < 900) await page.getByRole('button', { name: 'Contents', exact: true }).click()
    const tocLinks = sidebar.querySelectorAll<HTMLAnchorElement>('.site-skill-dialog-toc-link')
    await page
      .getByRole('link', { name: tocLinks[tocLinks.length - 1]!.textContent!.trim(), exact: true })
      .last()
      .click()
    await expect.poll(() => article.scrollTop).toBeGreaterThan(0)
    const previousScroll = article.scrollTop

    await selector.click()
    await page
      .getByRole('option', { name: 'references/visual-composition.md', exact: true })
      .click()
    await expect
      .poll(() => element('.site-file-select-value').textContent)
      .toBe('references/visual-composition.md')
    await page.getByRole('button', { name: 'Back to previous file' }).click()
    await expect.poll(() => article.scrollTop).toBe(previousScroll)

    await selector.click()
    await userEvent.keyboard('{Escape}')
    expect(element<HTMLDialogElement>('dialog').open).toBe(true)
    expect(element('[role="combobox"]').getAttribute('aria-expanded')).toBe('false')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => element<HTMLDialogElement>('dialog').open).toBe(false)
    expect(OverlayScrollbars(document.body)?.options().overflow.y).toBe('scroll')

    for (const withFileOptions of [false, true]) {
      await page.getByRole('button', { name: /Read the canvas skill/ }).click()
      if (withFileOptions) await page.getByRole('combobox').click()
      const closeButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[aria-label="Close skill preview"]')
      ).find((button) => button.getClientRects().length > 0)!
      const { x, y, width: buttonWidth, height: buttonHeight } = closeButton.getBoundingClientRect()
      expect(
        document.elementFromPoint(x + buttonWidth / 2, y + buttonHeight / 2)?.closest('button')
      ).toBe(closeButton)
      await page.getByRole('button', { name: 'Close skill preview', exact: true }).click()
      await expect.poll(() => element<HTMLDialogElement>('dialog').open).toBe(false)
      expect(OverlayScrollbars(document.body)?.options().overflow.y).toBe('scroll')
    }
  },
  20_000
)
