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

function waitForScrollEnd(target: HTMLElement): Promise<void> {
  return new Promise((resolve) =>
    target.addEventListener('scrollend', () => resolve(), { once: true })
  )
}

it.each([1280, 768, 390])(
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
    await page
      .getByRole('button', { name: /Read the canvas skill/ })
      .first()
      .click()
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

    const selector = page.getByRole('combobox', { name: /^Files/ })
    const selectorTop = element(
      '.site-skill-dialog-file-selector [role="combobox"]'
    ).getBoundingClientRect().top
    if (width <= 900) {
      const fileBounds = element(
        '.site-skill-dialog-file-selector [role="combobox"]'
      ).getBoundingClientRect()
      const contentsBounds = element(
        '.site-skill-dialog-mobile-bar [role="combobox"]'
      ).getBoundingClientRect()
      expect(fileBounds.width).toBe(contentsBounds.width)
      expect(fileBounds.height).toBe(contentsBounds.height)
      expect(fileBounds.bottom).toBeLessThan(contentsBounds.top)

      const contents = page.getByRole('combobox', { name: 'Contents', exact: true })
      const contentsButton = element('.site-skill-dialog-mobile-bar [role="combobox"]')
      const fileButton = element('.site-skill-dialog-file-selector [role="combobox"]')
      await contents.click()
      expect(fileButton.getAttribute('aria-expanded')).toBe('false')
      expect(contentsButton.getAttribute('aria-expanded')).toBe('true')
      expect(document.querySelectorAll('.site-reader-select-popover')).toHaveLength(1)
      expect(element('.site-reader-select-popover').getBoundingClientRect().width).toBe(
        contentsBounds.width
      )

      await selector.click()
      expect(contentsButton.getAttribute('aria-expanded')).toBe('false')
      expect(fileButton.getAttribute('aria-expanded')).toBe('true')
      expect(document.querySelectorAll('.site-reader-select-popover')).toHaveLength(1)
      await userEvent.keyboard('{Escape}')
      expect(element<HTMLDialogElement>('dialog').open).toBe(true)

      await contents.click()
      await userEvent.keyboard('{Escape}')
      expect(contentsButton.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(contentsButton)
      expect(element<HTMLDialogElement>('dialog').open).toBe(true)

      await contents.click()
      const headingBounds = element('.site-skill-prose h1').getBoundingClientRect()
      await page.getByRole('heading', { name: 'Design in Figma', exact: true }).click({
        position: { x: headingBounds.width - 4, y: headingBounds.height / 2 }
      })
      expect(contentsButton.getAttribute('aria-expanded')).toBe('false')

      await contents.click()
      await userEvent.keyboard('{Tab}')
      expect(contentsButton.getAttribute('aria-expanded')).toBe('false')

      await contents.click()
      const keyboardScrollEnd = waitForScrollEnd(article)
      await userEvent.keyboard('{End}{Enter}')
      expect(contentsButton.getAttribute('aria-expanded')).toBe('false')
      await keyboardScrollEnd
      await expect.poll(() => article.scrollTop).toBeGreaterThan(0)
      article.scrollTop = 0
    }
    await selector.click()
    const popover = element('.site-reader-select-popover')
    expect(OverlayScrollbars.valid(OverlayScrollbars(popover))).toBe(true)
    expect(popover.scrollHeight).toBeGreaterThan(popover.clientHeight)
    await userEvent.keyboard('{End}{Enter}')
    await expect
      .poll(() =>
        element('.site-skill-dialog-file-selector [role="combobox"]').getAttribute('aria-expanded')
      )
      .toBe('false')
    expect(element('.site-reader-select-value').textContent).not.toBe('SKILL.md')
    expect(
      element('.site-skill-dialog-file-selector [role="combobox"]').getBoundingClientRect().top
    ).toBe(selectorTop)
    expect(article.scrollTop).toBe(0)

    await page.getByRole('button', { name: 'Back to previous file' }).click()
    await expect.poll(() => element('.site-reader-select-value').textContent).toBe('SKILL.md')
    const tocLinks = sidebar.querySelectorAll<HTMLAnchorElement>('.site-skill-dialog-toc-link')
    const headingName = tocLinks[tocLinks.length - 1]!.textContent!.trim()
    const headingScrollEnd = waitForScrollEnd(article)
    if (width <= 900) {
      await page.getByRole('combobox', { name: 'Contents', exact: true }).click()
      await page.getByRole('option', { name: headingName, exact: true }).click()
    } else {
      await page.getByRole('link', { name: headingName, exact: true }).last().click()
    }
    await headingScrollEnd
    expect(article.scrollTop).toBeGreaterThan(0)
    const previousScroll = article.scrollTop

    await selector.click()
    await page
      .getByRole('option', { name: 'references/visual-composition.md', exact: true })
      .click()
    await expect
      .poll(() => element('.site-reader-select-value').textContent)
      .toBe('references/visual-composition.md')
    await page.getByRole('button', { name: 'Back to previous file' }).click()
    await expect.poll(() => article.scrollTop).toBe(previousScroll)

    await selector.click()
    await userEvent.keyboard('{Escape}')
    expect(element<HTMLDialogElement>('dialog').open).toBe(true)
    expect(
      element('.site-skill-dialog-file-selector [role="combobox"]').getAttribute('aria-expanded')
    ).toBe('false')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => element<HTMLDialogElement>('dialog').open).toBe(false)
    expect(OverlayScrollbars(document.body)?.options().overflow.y).toBe('scroll')

    for (const withFileOptions of [false, true]) {
      await page
        .getByRole('button', { name: /Read the canvas skill/ })
        .first()
        .click()
      if (withFileOptions) await page.getByRole('combobox', { name: /^Files/ }).click()
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
