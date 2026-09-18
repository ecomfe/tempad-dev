import '@/entrypoints/ui/style.css'
import type { DesignTask } from '@tempad-dev/shared'

import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, ref, toRaw, useTemplateRef } from 'vue'

import DesignTaskStatus from '@/components/DesignTaskStatus.vue'
import Panel from '@/components/Panel.vue'
import { options } from '@/ui/state'

import { mount, unmountAll } from './mount'

// Panel only needs the scrollbar composable, not the host integrations in the barrel.
vi.mock('@/composables', () => import('@/composables/scrollbar'))

const originalOptions = structuredClone(toRaw(options.value))
afterEach(() => {
  unmountAll()
  options.value = structuredClone(originalOptions)
  vi.unstubAllGlobals()
})

it('layers feedback popovers above the main panel while keeping canvas controls below it and native tooltips above both', async () => {
  await page.viewport(900, 700)
  // Supply the same Vue auto-imports as the extension build.
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('useTemplateRef', useTemplateRef)
  options.value.panelPosition = { left: 100, top: 100, width: 500 }
  options.value.minimized = false

  const root = document.createElement('div')
  root.id = 'fullscreen-root'
  root.innerHTML = '<div class="gpu-view-content"><canvas></canvas></div>'
  const canvas = root.querySelector('canvas')!
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '80px',
    top: '20px',
    width: '600px',
    height: '500px'
  })
  document.body.append(root)
  const nativePage = {
    id: 'page-a',
    name: 'Page',
    type: 'PAGE',
    parent: null,
    selection: [] as SceneNode[]
  }
  const anchor = {
    id: 'node-a',
    name: 'Settings',
    type: 'FRAME',
    removed: false,
    parent: nativePage,
    absoluteBoundingBox: { x: 100, y: 180, width: 120, height: 60 }
  } as unknown as SceneNode
  vi.stubGlobal('figma', {
    fileKey: 'file-a',
    root: { name: 'Product' },
    currentPage: nativePage,
    getNodeByIdAsync: async () => anchor,
    viewport: { bounds: { x: 0, y: 0, width: 600, height: 500 }, zoom: 1 }
  })
  const task: DesignTask = {
    taskId: 'task-a',
    title: 'Design',
    status: 'active',
    operation: null,
    expiresAt: 300000,
    revision: 1,
    client: { kind: 'codex-app', name: 'Codex App', sessionId: 'thread-a' },
    target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Product', pageId: 'page-a' }
  }
  const panelClick = vi.fn()
  const stop = vi.fn()
  const host = mount(
    defineComponent(
      () => () =>
        h(
          Panel,
          {
            class: 'tp-main',
            style: { height: '220px' }
          },
          {
            header: () => 'TemPad Dev',
            default: () => [
              h(
                'button',
                {
                  style: { position: 'absolute', inset: '0' },
                  onClick: panelClick
                },
                'Panel action'
              ),
              h(DesignTaskStatus, {
                task,
                anchor,
                sessionId: 'tab-a',
                onStop: stop,
                requestDrafts: async () => ({ items: [] })
              })
            ]
          }
        )
    ),
    { tag: 'tempad', tokens: { '--color-bg': '#fff' } }
  )

  const panel = host.querySelector<HTMLElement>('.tp-panel')!
  const action = page.getByRole('button', { name: 'Panel action' })
  const stopButton = page.getByRole('button', { name: 'Stop design task' })
  await expect.element(stopButton).toBeVisible()
  const point = () => {
    const rect = stopButton.element().getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  await expect
    .poll(() => {
      const { x, y } = point()
      return document.elementFromPoint(x, y)
    })
    .toBe(action.element())
  const actionRect = action.element().getBoundingClientRect()
  await action.click({
    position: { x: point().x - actionRect.left, y: point().y - actionRect.top }
  })
  expect(panelClick).toHaveBeenCalledOnce()
  expect(stop).not.toHaveBeenCalled()

  const tooltip = document.createElement('div')
  tooltip.className = 'web_stacking--nonStaticLayer-test'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.textContent = 'Native tooltip'
  Object.assign(tooltip.style, {
    position: 'fixed',
    left: `${point().x - 30}px`,
    top: `${point().y - 10}px`,
    width: '60px',
    height: '20px',
    background: '#000'
  })
  root.append(tooltip)
  expect(document.elementFromPoint(point().x, point().y)).toBe(tooltip)
  const tooltipClick = vi.fn()
  tooltip.addEventListener('click', tooltipClick)
  await page.getByRole('tooltip').click()
  expect(tooltipClick).toHaveBeenCalledOnce()
  expect(panelClick).toHaveBeenCalledOnce()

  tooltip.remove()
  panel.style.visibility = 'hidden'
  await stopButton.click()
  expect(stop).toHaveBeenCalledOnce()

  async function expectPopoverAbovePanel(name: string): Promise<void> {
    const input = page.getByRole('textbox', { name, exact: true })
    await expect.element(input).toBeVisible()
    const rect = input.element().getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    Object.assign(panel.style, {
      left: `${rect.left - 10}px`,
      top: `${rect.top - 10}px`,
      visibility: 'visible'
    })
    await expect.poll(() => document.elementFromPoint(x, y)).toBe(input.element())
    await input.click()
    expect(document.activeElement).toBe(input.element())

    Object.assign(tooltip.style, { left: `${x - 30}px`, top: `${y - 10}px` })
    root.append(tooltip)
    expect(document.elementFromPoint(x, y)).toBe(tooltip)
    tooltip.remove()
    panel.style.visibility = 'hidden'
  }

  await page.getByRole('button', { name: 'Review comments', exact: true }).click()
  await expectPopoverAbovePanel('General comment')
  await userEvent.keyboard('{Escape}')
  nativePage.selection = [anchor]
  await page.elementLocator(canvas).hover({ position: { x: 160, y: 210 } })
  await page.getByRole('button', { name: 'Add comment to Settings' }).click()
  await expectPopoverAbovePanel('Element comment')
})
