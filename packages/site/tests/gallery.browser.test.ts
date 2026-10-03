import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createApp } from 'vue'

import HeroFigure from '@/components/HeroFigure.vue'
import { INSPECTION_SLIDES } from '@/content/landing'
import '@/styles.css'

let app: ReturnType<typeof createApp> | undefined
let host: HTMLElement | undefined

afterEach(() => {
  app?.unmount()
  host?.remove()
})

it('lets readers browse every example and restores focus after viewing an image', async () => {
  await page.viewport(390, 844)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(HeroFigure)
  app.mount(host)
  const caption = () => host!.querySelector('.site-inspection-caption')!.textContent
  for (const slide of INSPECTION_SLIDES) {
    await expect.poll(caption).toContain(slide.caption)
    await page.getByRole('button', { name: 'Next example', exact: true }).click()
  }
  await expect.poll(caption).toContain('Code view')
  await page.getByRole('button', { name: 'Previous example', exact: true }).click()
  await expect.poll(caption).toContain('Units and scale')
  await userEvent.keyboard('{Home}')
  await expect.poll(caption).toContain('Code view')
  const trigger = page.getByRole('button', { name: 'Enlarge Code view' })
  await trigger.click()
  await expect.poll(() => document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true)
  expect(document.body.style.overflow).toBe('hidden')
  await page.getByRole('button', { name: 'Zoom image', exact: true }).click()
  const media = document.querySelector<HTMLElement>('.site-image-viewer-media')!
  expect(media.scrollWidth).toBeGreaterThan(media.clientWidth)
  await page.getByRole('button', { name: 'Fit image', exact: true }).click()
  await userEvent.keyboard('{ArrowRight}')
  await expect
    .poll(() => document.querySelector('#image-viewer-title')!.textContent)
    .toBe('Plugin output')
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false)
  // The native dialog queues its close event after clearing the open state.
  await expect.poll(() => document.body.style.overflow).not.toBe('hidden')
  await expect.poll(() => document.activeElement).toBe(host.querySelector('.site-inspection-image'))
  expect(host.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})

it('accepts a horizontal swipe without turning vertical scrolling into navigation', async () => {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(HeroFigure)
  app.mount(host)
  const preview = host.querySelector('.site-inspection-preview')!
  function swipe(x: number, y: number): void {
    const touch = (clientX: number, clientY: number) =>
      new Touch({ identifier: 1, target: preview, clientX, clientY })
    preview.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(200, 200)] }))
    preview.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(x, y)] }))
  }
  swipe(190, 100)
  await expect
    .poll(() => host!.querySelector('.site-inspection-caption')!.textContent)
    .toContain('Code view')
  swipe(100, 205)
  await expect
    .poll(() => host!.querySelector('.site-inspection-caption')!.textContent)
    .toContain('Plugin output')
  ;(host.querySelector('.site-inspection-image') as HTMLButtonElement).click()
  expect(document.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false)
})
