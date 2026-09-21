import '@/entrypoints/ui/style.css'
import type { DesignTask } from '@tempad-dev/shared'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import DesignTaskStatus from '@/components/DesignTaskStatus.vue'

import { mount, unmountAll } from './mount'

function fixture(
  sendFeedback?: InstanceType<typeof DesignTaskStatus>['$props']['sendFeedback'],
  requestDrafts?: InstanceType<typeof DesignTaskStatus>['$props']['requestDrafts'],
  closeReview?: InstanceType<typeof DesignTaskStatus>['$props']['closeReview']
) {
  const root = document.createElement('div')
  root.id = 'fullscreen-root'
  const content = document.createElement('div')
  content.className = 'gpu-view-content'
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '80px',
    top: '20px',
    width: '600px',
    height: '500px'
  })
  content.append(canvas)
  root.append(content)
  document.body.append(root)
  const api = {
    notify: vi.fn(() => ({ cancel: vi.fn() })),
    currentPage: { id: 'page-a', selection: [] as SceneNode[] },
    viewport: {
      bounds: { x: -100, y: -50, width: 300, height: 250 },
      zoom: 2,
      scrollAndZoomIntoView: vi.fn()
    }
  }
  vi.stubGlobal('figma', api)
  const task = shallowRef<DesignTask | null>(null)
  const initial: DesignTask = {
    taskId: 'task-a',
    title: 'Settings design',
    target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Product', pageId: 'page-a' },
    status: 'active',
    operation: null,
    expiresAt: 300000,
    revision: 1
  }
  const node = {
    id: 'node-a',
    type: 'FRAME',
    removed: false,
    absoluteBoundingBox: { x: 20, y: 40, width: 200, height: 100 },
    parent: { id: 'page-a', type: 'PAGE', parent: null }
  }
  const anchor = shallowRef<SceneNode | null>(null)
  const restored = shallowRef(false)
  const stop = vi.fn()
  const done = vi.fn()
  const host = mount(
    defineComponent(
      () => () =>
        h(DesignTaskStatus, {
          task: task.value,
          anchor: anchor.value,
          sessionId: 'tab-a',
          restored: restored.value,
          sendFeedback,
          requestDrafts,
          closeReview,
          onStop: stop,
          onDone: done
        })
    ),
    {
      tag: 'tempad',
      tokens: {
        '--color-border': '#ddd',
        '--color-text': '#222',
        '--color-text-secondary': '#666',
        '--elevation-200-canvas': '0 2px 6px #0003',
        '--color-bg-brand': '#0d99ff'
      }
    }
  )
  return {
    api,
    task,
    initial,
    restored,
    anchor,
    node,
    stop,
    done,
    host,
    panel: host.firstElementChild as HTMLElement,
    canvas
  }
}

function overlayVisible() {
  const overlay = document.querySelector<HTMLElement>('.tp-design-overlay')
  return !!overlay && getComputedStyle(overlay).display !== 'none'
}

function toolbarVisible() {
  if (!overlayVisible()) return false
  const bar = document.querySelector<HTMLElement>('.tp-design-feedback')
  if (!bar || getComputedStyle(bar).display === 'none') return false
  const rect = bar.getBoundingClientRect()
  const clip = document.querySelector('.tp-design-overlay')!.getBoundingClientRect()
  return (
    rect.left < clip.right &&
    rect.right > clip.left &&
    rect.top < clip.bottom &&
    rect.bottom > clip.top
  )
}

afterEach(() => {
  unmountAll()
  window.sessionStorage.removeItem('tempad-dev:design-status-position')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('design task status and canvas overlay', () => {
  it('expands and collapses the panel entry in document flow with contextual text before an anchor exists', async () => {
    const f = fixture()
    const following = document.createElement('div')
    following.textContent = 'Selection details'
    f.panel.append(following)
    const originalTop = following.getBoundingClientRect().top
    f.task.value = f.initial
    await nextTick()
    const section = f.panel.querySelector<HTMLElement>('.tp-design-task-section')!
    const heightTransition = () =>
      section
        .getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === 'height'
        )
    await expect.poll(heightTransition).toBeDefined()
    const enter = heightTransition()!
    enter.pause()
    enter.currentTime = 100
    expect(section.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(section.getBoundingClientRect().height).toBeLessThan(40)
    enter.finish()
    await expect.poll(() => section.classList.contains('tp-section-enter-active')).toBe(false)
    expect(following.getBoundingClientRect().top - originalTop).toBe(40)
    expect(section.querySelector('svg')).toBeNull()
    expect(section.textContent?.replace(/\s/g, '')).toBe('TheagentisdesigningStop')
    expect(overlayVisible()).toBe(false)
    expect(section.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)

    f.task.value = { ...f.initial, status: 'completed' }
    await nextTick()
    expect(f.panel.querySelector('.tp-section-leave-active')).toBeNull()
    document.querySelector<HTMLButtonElement>('.tp-design-done')!.click()
    await expect.poll(heightTransition).toBeDefined()
    const leave = heightTransition()!
    leave.pause()
    leave.currentTime = 100
    expect(section.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(section.getBoundingClientRect().height).toBeLessThan(40)
    expect(getComputedStyle(section).pointerEvents).toBe('none')
    leave.finish()
    await expect.poll(() => f.panel.querySelector('.tp-design-task-section')).toBeNull()
    expect(following.getBoundingClientRect().top).toBe(originalTop)
  })

  it.each(['paused', 'expired', 'interrupted', 'completed'] as const)(
    'keeps unanchored %s task controls available and restores Locate when its anchor becomes valid',
    async (status) => {
      const f = fixture()
      f.task.value = { ...f.initial, status }
      await nextTick()
      expect(
        f.panel.querySelector(status === 'completed' ? '.tp-design-done' : '.tp-design-stop')
      ).not.toBeNull()
      expect(overlayVisible()).toBe(false)
      f.node.absoluteBoundingBox.x = NaN
      f.anchor.value = f.node as unknown as SceneNode
      await nextTick()
      expect(
        f.panel.querySelector(status === 'completed' ? '.tp-design-done' : '.tp-design-stop')
      ).not.toBeNull()
      f.node.absoluteBoundingBox.x = 20
      await expect.poll(overlayVisible).toBe(true)
      const locate = f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!
      expect(locate.disabled).toBe(false)
      locate.click()
      expect(f.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledExactlyOnceWith([f.node])
      if (status !== 'completed') {
        expect(locate.textContent).toBe("The agent's design task is paused")
        document.querySelector<HTMLButtonElement>('.tp-design-stop')!.click()
        expect(f.stop).toHaveBeenCalledOnce()
      } else expect(document.querySelector('.tp-design-done')).not.toBeNull()
      f.node.removed = true
      await expect
        .poll(() =>
          f.panel.querySelector(status === 'completed' ? '.tp-design-done' : '.tp-design-stop')
        )
        .not.toBeNull()
      expect(overlayVisible()).toBe(false)
      expect(f.done).not.toHaveBeenCalled()
      f.task.value = f.initial
      await expect.poll(() => f.panel.querySelector('.tp-design-stop')).not.toBeNull()
    }
  )

  it('uses a plain panel surface and adds the locate hint only when a target is available', async () => {
    const f = fixture()
    f.task.value = f.initial
    await nextTick()
    const section = f.panel.querySelector<HTMLElement>('.tp-design-task-section')!
    const entry = f.panel.querySelector<HTMLElement>('.tp-design-locate')!
    expect(entry.getAttribute('data-tooltip')).toBe('Settings design')
    const textColor = getComputedStyle(section).color
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    for (const status of ['active', 'paused', 'expired', 'interrupted', 'completed'] as const) {
      f.task.value = { ...f.initial, status }
      await nextTick()
      expect(getComputedStyle(section).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(section).color).toBe(textColor)
      expect(entry.getAttribute('data-tooltip')).toBe('Settings design · Click to locate')
    }
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    expect(entry.getAttribute('data-tooltip')).toBe('Settings design · Click to locate')
    expect(entry.getBoundingClientRect().height).toBe(16)
    expect(entry.getBoundingClientRect().width).toBeCloseTo(
      entry.firstElementChild!.getBoundingClientRect().width + 8,
      1
    )
    expect(getComputedStyle(entry).cursor).toBe('default')
  })

  it('keeps a completed result locatable across pages without notification state', async () => {
    const f = fixture()
    const target = {
      ...f.node,
      parent: { id: 'page-b', type: 'PAGE', parent: null }
    } as unknown as SceneNode
    f.anchor.value = target
    f.task.value = { ...f.initial, status: 'completed' }
    await nextTick()
    expect(overlayVisible()).toBe(false)
    const button = f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!
    expect(button.getAttribute('data-tooltip')).toBe('Settings design · Click to locate')
    expect(f.panel.querySelector('.tp-design-unseen')).toBeNull()
    button.click()
    expect(f.api.currentPage.id).toBe('page-b')
    expect(f.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledExactlyOnceWith([target])
  })

  it('uses the reported client name in one sentence for the existing activity signals', async () => {
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = {
      ...f.initial,
      client: { kind: 'codex-app', name: 'My Design Client' },
      operation: 'writing'
    }
    await nextTick()
    const label = () => document.querySelector('.tp-design-anchor-label')!.textContent
    expect(label()).toBe('My Design Client is updating the design')
    const panelText = f.panel.querySelector<HTMLElement>('.tp-design-locate > span')!
    expect(panelText.textContent).toBe('My Design Client is designing')
    expect(getComputedStyle(panelText).animationIterationCount).toBe('infinite')
    expect(getComputedStyle(panelText).backgroundClip).toBe('text')
    expect(document.querySelector('.tp-design-client')).toBeNull()
    expect(document.querySelector('.tp-design-source')).toBeNull()
    f.task.value = { ...f.task.value, operation: 'reading' }
    await nextTick()
    expect(label()).toBe('My Design Client is reviewing the design')
    f.task.value = { ...f.task.value, operation: null }
    await nextTick()
    expect(label()).toBe('My Design Client is working on the design')
    f.task.value = { ...f.task.value, status: 'paused' }
    await nextTick()
    expect(getComputedStyle(panelText).animationName).toBe('none')
  })

  it('keeps one canvas control surface and only a locate entry in the panel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = fixture()
    expect(f.panel.querySelector('button')).toBeNull()
    expect(document.querySelector('.tp-design-feedback')).toBeNull()
    f.task.value = f.initial
    await nextTick()
    expect(f.panel.querySelectorAll('button')).toHaveLength(2)
    expect(overlayVisible()).toBe(false)
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    expect(f.panel.querySelectorAll('button')).toHaveLength(1)
    expect(f.panel.textContent).toBe('The agent is designing')
    expect(f.panel.querySelector('.tp-design-stop')).toBeNull()
    expect(f.panel.querySelector('.tp-feedback-toggle')).toBeNull()
    expect(document.querySelector('.tp-design-anchor')).not.toBeNull()
    expect(document.querySelector('.tp-design-feedback')?.textContent).toContain(
      'The agent is working on the design'
    )
    document.querySelector<HTMLButtonElement>('.tp-design-stop')!.click()
    expect(f.stop).toHaveBeenCalledOnce()
    f.task.value = { ...f.initial, status: 'stopping', operation: 'writing' }
    await nextTick()
    expect(document.querySelector('.tp-design-stop')!.getAttribute('aria-label')).toBe(
      'Stopping design task'
    )
    expect(document.querySelector<HTMLButtonElement>('.tp-design-stop')!.disabled).toBe(true)
    f.task.value = { ...f.initial, status: 'cancelled' }
    await nextTick()
    expect(document.querySelector('.tp-design-feedback')?.textContent).toContain(
      "The agent's design task has stopped"
    )
    expect(document.querySelector('.tp-design-done')).toBeNull()
    await nextTick()
    // Vue starts the height transition after two browser frames; its fallback uses our clock.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    await vi.advanceTimersByTimeAsync(720)
    expect(f.done).toHaveBeenCalledExactlyOnceWith('task-a')
    expect(f.panel.querySelector('button')).toBeNull()
    expect(overlayVisible()).toBe(false)
  })

  it('drags the bar relative to its output and restores that offset after remounting', async () => {
    await page.viewport(900, 700)
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = f.initial
    await expect.poll(toolbarVisible).toBe(true)
    const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
    bar.getAnimations().forEach((animation) => animation.finish())
    const label = bar.querySelector<HTMLElement>('.tp-design-anchor-label')!
    const original = bar.getBoundingClientRect()
    expect(
      document.querySelector('.tp-design-anchor')!.getBoundingClientRect().top - original.bottom
    ).toBe(28)
    expect(bar.hasAttribute('data-tooltip')).toBe(false)
    expect(label.hasAttribute('title')).toBe(false)
    const handle = label.getBoundingClientRect()
    const target = document.createElement('div')
    Object.assign(target.style, {
      position: 'fixed',
      width: '2px',
      height: '2px',
      left: `${handle.left + handle.width / 2 - 81}px`,
      top: `${handle.top + handle.height / 2 + 99}px`
    })
    document.body.append(target)
    await userEvent.dragAndDrop(label, target)
    expect(bar.getBoundingClientRect().left - original.left).toBeCloseTo(-80, 0)
    expect(bar.getBoundingClientRect().top - original.top).toBeCloseTo(100, 0)
    expect(document.activeElement).not.toBe(bar)
    expect(bar.hasAttribute('data-tooltip')).toBe(false)
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.api.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled()
    const saved = JSON.parse(window.sessionStorage.getItem('tempad-dev:design-status-position')!)
    expect(saved.x).toBeCloseTo(-40, 1)
    expect(saved.y).toBeCloseTo(50, 1)
    const moved = { left: bar.style.left, top: bar.style.top }
    for (const status of ['completed', 'active'] as const) {
      f.task.value = { ...f.initial, status, epoch: status === 'active' ? 1 : 0 }
      await nextTick()
      expect(toolbarVisible()).toBe(true)
      expect({ left: bar.style.left, top: bar.style.top }).toEqual(moved)
      expect(f.done).not.toHaveBeenCalled()
    }
    f.api.viewport.zoom = 1
    f.api.viewport.bounds.x = 0
    f.api.viewport.bounds.y = 0
    await expect.poll(() => parseFloat(bar.style.left)).toBeCloseTo(-20, 1)
    expect(bar.style.top).toBe('26px')
    f.node.absoluteBoundingBox.x = 80
    await expect.poll(() => parseFloat(bar.style.left)).toBeCloseTo(40, 1)
    unmountAll()
    const reopened = fixture()
    reopened.anchor.value = reopened.node as unknown as SceneNode
    reopened.task.value = {
      ...reopened.initial,
      status: 'completed',
      target: { ...reopened.initial.target, sessionId: 'before-refresh' }
    }
    reopened.restored.value = true
    await expect
      .poll(() =>
        parseFloat(document.querySelector<HTMLElement>('.tp-design-feedback')!.style.left)
      )
      .toBeCloseTo(160, 1)
    expect(document.querySelector<HTMLElement>('.tp-design-feedback')?.style.top).toBe('216px')
    reopened.task.value = { ...reopened.initial, taskId: 'task-b' }
    await expect
      .poll(() => document.querySelector<HTMLElement>('.tp-design-feedback')?.style.left)
      .toBe('240px')
    expect(document.querySelector<HTMLElement>('.tp-design-feedback')?.style.top).toBe('116px')
  })

  it.each(['capture transferred', 'release intercepted', 'Escape', 'pointercancel'] as const)(
    'finishes the drag correctly after %s',
    async (interruption) => {
      await page.viewport(900, 700)
      const f = fixture()
      f.anchor.value = f.node as unknown as SceneNode
      f.task.value = f.initial
      await expect.poll(toolbarVisible).toBe(true)
      const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
      bar.getAnimations().forEach((animation) => animation.finish())
      const label = bar.querySelector<HTMLElement>('.tp-design-anchor-label')!
      const original = bar.getBoundingClientRect()
      const handle = label.getBoundingClientRect()
      const target = document.createElement('div')
      Object.assign(target.style, {
        position: 'fixed',
        width: '2px',
        height: '2px',
        left: `${handle.left + handle.width / 2 - 81}px`,
        top: `${handle.top + handle.height / 2 + 99}px`
      })
      document.body.append(target)
      let interrupted = false
      const interrupt = (event: PointerEvent) => {
        if (interrupted || (event.type === 'pointermove' && !event.buttons)) return
        if (interruption === 'capture transferred') {
          target.setPointerCapture(event.pointerId)
        } else if (interruption === 'release intercepted') event.stopPropagation()
        else if (interruption === 'Escape')
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        else window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: event.pointerId }))
        interrupted = true
      }
      const cancelled = interruption === 'Escape' || interruption === 'pointercancel'
      const eventType = interruption === 'release intercepted' ? 'pointerup' : 'pointermove'
      const eventTarget = interruption === 'release intercepted' ? document : window
      eventTarget.addEventListener(eventType, interrupt as EventListener, true)
      try {
        await userEvent.dragAndDrop(label, target)
        expect(interrupted).toBe(true)
        expect(bar.getBoundingClientRect().left - original.left).toBeCloseTo(cancelled ? 0 : -80, 0)
        expect(bar.getBoundingClientRect().top - original.top).toBeCloseTo(cancelled ? 0 : 100, 0)
        const saved = JSON.parse(
          window.sessionStorage.getItem('tempad-dev:design-status-position')!
        )
        if (cancelled) expect(saved).toBeNull()
        else {
          expect(saved.x).toBeCloseTo(-40, 1)
          expect(saved.y).toBeCloseTo(50, 1)
        }
        // A later cancellation must not undo an already completed drop.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        expect(bar.getBoundingClientRect().top - original.top).toBeCloseTo(cancelled ? 0 : 100, 0)
      } finally {
        eventTarget.removeEventListener(eventType, interrupt as EventListener, true)
        target.remove()
      }
    }
  )

  it('resets with a double click without focusing the bar or stealing button actions', async () => {
    await page.viewport(900, 700)
    window.sessionStorage.setItem(
      'tempad-dev:design-status-position',
      JSON.stringify({ key: JSON.stringify(['file-a', 'task-a', 'node-a']), x: -40, y: 50 })
    )
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = f.initial
    await expect.poll(toolbarVisible).toBe(true)
    const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
    bar.getAnimations().forEach((animation) => animation.finish())
    expect(bar.style.left).toBe('160px')
    expect(bar.style.top).toBe('216px')
    expect(bar.hasAttribute('tabindex')).toBe(false)
    expect(bar.hasAttribute('data-tooltip')).toBe(false)
    const label = bar.querySelector<HTMLElement>('.tp-design-anchor-label')!
    await userEvent.dblClick(label)
    expect(document.activeElement).not.toBe(bar)
    expect(bar.hasAttribute('data-tooltip')).toBe(false)
    expect(bar.style.left).toBe('240px')
    expect(bar.style.top).toBe('116px')
    await page.getByRole('button', { name: 'Stop design task', exact: true }).click()
    expect(f.stop).toHaveBeenCalledOnce()
    expect(bar.style.left).toBe('240px')
    expect(f.api.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled()
  })

  it('clips the toolbar at the canvas edges without changing its anchor offset or width', async () => {
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = f.initial
    await expect.poll(toolbarVisible).toBe(true)
    const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
    bar.getAnimations().forEach((animation) => animation.finish())
    f.api.viewport.bounds.x = 40
    f.api.viewport.bounds.y = 25
    await expect.poll(() => bar.style.left).toBe('-40px')
    expect(bar.style.top).toBe('-34px')
    expect(toolbarVisible()).toBe(true)
    expect(bar.getBoundingClientRect().width).toBe(360)
    expect(bar.contains(document.elementFromPoint(60, 30))).toBe(false)
    f.canvas.style.width = '200px'
    await expect
      .poll(() => document.querySelector('.tp-design-overlay')!.getBoundingClientRect().width)
      .toBe(200)
    expect(bar.style.left).toBe('-40px')
    expect(bar.style.top).toBe('-34px')
    expect(bar.getBoundingClientRect().width).toBe(360)
    expect(bar.contains(document.elementFromPoint(300, 30))).toBe(false)
    f.api.viewport.bounds.y = 50
    await expect.poll(toolbarVisible).toBe(false)
    expect(bar.style.top).toBe('-84px')
    expect(getComputedStyle(bar).display).not.toBe('none')
  })

  it('enters from the logo and shimmers only during activity', async () => {
    const f = fixture()
    f.task.value = f.initial
    await nextTick()
    expect(overlayVisible()).toBe(false)
    expect(document.querySelector('.tp-design-feedback')!.getAnimations()).toHaveLength(0)
    f.anchor.value = f.node as unknown as SceneNode
    await expect.poll(overlayVisible).toBe(true)
    const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
    const animations = bar.getAnimations()
    expect(animations).toHaveLength(2)
    animations.forEach((animation) => animation.pause())
    animations[0]!.currentTime = 0
    animations[1]!.currentTime = 0
    expect(getComputedStyle(bar).width).toBe('36px')
    expect(getComputedStyle(bar).opacity).toBe('0')
    animations.forEach((animation) => animation.finish())
    expect(getComputedStyle(bar).width).toBe('360px')
    expect(getComputedStyle(f.panel.querySelector('.tp-design-locate')!).borderBottomWidth).toBe(
      '0px'
    )
    const label = document.querySelector<HTMLElement>('.tp-design-label-text')!
    expect(getComputedStyle(label).animationIterationCount).toBe('infinite')
    expect(getComputedStyle(label).backgroundClip).toBe('text')
    f.task.value = { ...f.initial, status: 'completed' }
    await nextTick()
    expect(getComputedStyle(label).animationName).toBe('none')
    expect(document.querySelector('.tp-design-done')).not.toBeNull()
  })

  it('follows pan, zoom, and resize in CSS pixels and keeps labels at screen size', async () => {
    const f = fixture()
    f.task.value = { ...f.initial, operation: 'writing' }
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    const element = () => document.querySelector<HTMLElement>('.tp-design-anchor')!
    await expect.poll(() => element()?.getBoundingClientRect().left).toBe(320)
    expect(element().getBoundingClientRect()).toMatchObject({ top: 200, width: 400, height: 200 })
    expect(getComputedStyle(document.querySelector('.tp-design-overlay')!).pointerEvents).toBe(
      'none'
    )
    expect(getComputedStyle(document.querySelector('.tp-design-overlay')!).overflow).toBe('hidden')
    const fontSize = getComputedStyle(document.querySelector('.tp-design-anchor-label')!).fontSize
    f.api.viewport.zoom = 1
    f.api.viewport.bounds.x = 0
    await expect.poll(() => element()?.getBoundingClientRect().left).toBe(100)
    expect(element().getBoundingClientRect()).toMatchObject({ width: 200, height: 100 })
    expect(getComputedStyle(document.querySelector('.tp-design-anchor-label')!).fontSize).toBe(
      fontSize
    )
    f.canvas.style.width = '450px'
    await expect
      .poll(() => document.querySelector('.tp-design-overlay')?.getBoundingClientRect().width)
      .toBe(450)
  })

  it('recovers an offscreen or off-page toolbar through the single panel entry', async () => {
    const f = fixture()
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    f.api.viewport.bounds.x = 2000
    await expect.poll(toolbarVisible).toBe(false)
    f.api.viewport.scrollAndZoomIntoView.mockImplementation(() => {
      f.api.viewport.bounds.x = -100
    })
    f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!.click()
    await expect.poll(toolbarVisible).toBe(true)
    f.api.currentPage = { id: 'page-b', selection: [] }
    await expect.poll(overlayVisible).toBe(false)
    f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!.click()
    await expect.poll(overlayVisible).toBe(true)
    expect(f.api.currentPage.id).toBe('page-a')
    expect(f.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledTimes(2)
  })

  it('leaves the toolbar above the anchor when the target fills the canvas', async () => {
    const f = fixture()
    f.node.absoluteBoundingBox = { ...f.api.viewport.bounds }
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await expect.poll(overlayVisible).toBe(true)
    const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
    bar.getAnimations().forEach((animation) => animation.finish())
    expect(bar.style.left).toBe('0px')
    expect(bar.style.top).toBe('-64px')
    expect(toolbarVisible()).toBe(false)
    expect(f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!.disabled).toBe(false)
  })

  it.each([
    { name: 'tall design', width: 300, height: 900, x: 0, y: 0 },
    { name: 'wide design', width: 900, height: 300, x: 0, y: 0 },
    { name: 'bar wider than the design', width: 40, height: 900, x: 0, y: 0 },
    { name: 'bar dragged above and left', width: 300, height: 900, x: -500, y: -600 },
    { name: 'bar dragged below and right', width: 300, height: 900, x: 900, y: 1500 }
  ])(
    'Locate fits the full status bar and $name, including from another page',
    async ({ width, height, x, y }) => {
      window.sessionStorage.setItem(
        'tempad-dev:design-status-position',
        JSON.stringify({ key: JSON.stringify(['file-a', 'task-a', 'node-a']), x, y })
      )
      const f = fixture()
      f.node.absoluteBoundingBox = { x: 20, y: 40, width, height }
      const original = { ...f.node.absoluteBoundingBox }
      // Model native center/zoom in document coordinates; the real DOM overlay supplies assertions.
      const centerOn = (center: { x: number; y: number }) => {
        const canvas = f.canvas.getBoundingClientRect()
        const width = canvas.width / f.api.viewport.zoom
        const height = canvas.height / f.api.viewport.zoom
        f.api.viewport.bounds = { x: center.x - width / 2, y: center.y - height / 2, width, height }
      }
      Object.defineProperty(f.api.viewport, 'center', { set: centerOn })
      f.api.viewport.scrollAndZoomIntoView.mockImplementation(() => {
        const canvas = f.canvas.getBoundingClientRect()
        f.api.viewport.zoom = Math.min(canvas.width / width, canvas.height / height)
        centerOn({ x: original.x + width / 2, y: original.y + height / 2 })
      })
      f.api.currentPage = { id: 'page-b', selection: [] }
      f.task.value = f.initial
      f.anchor.value = f.node as unknown as SceneNode
      const locate = () => f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!
      await expect.poll(() => locate()?.disabled).toBe(false)
      expect(overlayVisible()).toBe(false)
      locate().click()
      await expect.poll(overlayVisible).toBe(true)
      const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
      bar.getAnimations().forEach((animation) => animation.finish())
      await expect
        .poll(() => {
          const canvas = f.canvas.getBoundingClientRect()
          return [bar, document.querySelector('.tp-design-anchor')!].every((element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.left >= canvas.left + 7.9 &&
              rect.top >= canvas.top + 7.9 &&
              rect.right <= canvas.right - 7.9 &&
              rect.bottom <= canvas.bottom - 7.9
            )
          })
        })
        .toBe(true)
      const design = document.querySelector('.tp-design-anchor')!.getBoundingClientRect()
      expect(bar.getBoundingClientRect().left - design.left).toBeCloseTo(x * f.api.viewport.zoom, 1)
      expect(bar.getBoundingClientRect().top - design.top).toBeCloseTo(
        y * f.api.viewport.zoom - 64,
        1
      )
      expect(f.node.absoluteBoundingBox).toEqual(original)
      expect(f.api.currentPage.id).toBe('page-a')
      expect(f.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledExactlyOnceWith([f.node])
    }
  )

  it('locates the anchor and offers stop outside the design without intercepting its content', async () => {
    const f = fixture()
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!.click()
    expect(f.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([f.node])
    const feedback = document.querySelector<HTMLElement>('.tp-design-feedback')!
    const anchor = document.querySelector<HTMLElement>('.tp-design-anchor')!
    expect(feedback.textContent).not.toContain('TemPad Dev')
    expect(
      feedback.querySelector<HTMLButtonElement>('.tp-design-stop')!.getAttribute('aria-label')
    ).toBe('Stop design task')
    expect(feedback.textContent).toContain('The agent is working on the design')
    expect(feedback.getBoundingClientRect().bottom).toBeLessThan(anchor.getBoundingClientRect().top)
    expect(getComputedStyle(anchor).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(anchor).pointerEvents).toBe('none')
    expect(getComputedStyle(feedback).pointerEvents).toBe('auto')
    feedback.querySelector<HTMLButtonElement>('.tp-design-stop')!.click()
    expect(f.stop).toHaveBeenCalledOnce()
    f.task.value = { ...f.initial, status: 'stopping' }
    await nextTick()
    expect(feedback.querySelector<HTMLButtonElement>('.tp-design-stop')!.disabled).toBe(true)
  })

  it('waits for durable Done and retains controls when closing fails', async () => {
    let reject!: (error: Error) => void
    const close = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail
        })
    )
    const f = fixture(undefined, undefined, close)
    f.task.value = { ...f.initial, status: 'completed' }
    await nextTick()
    document.querySelector<HTMLButtonElement>('.tp-design-done')!.click()
    await expect.poll(() => close.mock.calls.length).toBe(1)
    expect(f.done).not.toHaveBeenCalled()
    expect(document.querySelector('.tp-design-done')).not.toBeNull()
    reject(new Error('Storage unavailable'))
    await expect.poll(() => f.api.notify.mock.calls.length).toBe(1)
    expect(f.api.notify).toHaveBeenCalledWith('Storage unavailable')
    expect(f.done).not.toHaveBeenCalled()
    expect(document.querySelector('.tp-design-done')).not.toBeNull()
  })

  it('keeps the completed panel row visible until Done is clicked', async () => {
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.initial.client = { kind: 'codex-app', name: 'Codex', sessionId: 'thread-a' }
    f.task.value = f.initial
    await expect.poll(overlayVisible).toBe(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    f.task.value = { ...f.initial, status: 'completed' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.panel.querySelector('.tp-design-task-section')).not.toBeNull()
    expect(f.panel.querySelector('.tp-section-leave-active')).toBeNull()
    expect(overlayVisible()).toBe(true)
    expect(document.querySelector('.tp-design-done')).not.toBeNull()
    expect(document.querySelector('.tp-feedback-toggle')).not.toBeNull()
    expect(f.done).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('.tp-design-done')!.click()
    await expect.poll(() => f.panel.querySelector('.tp-section-leave-active')).not.toBeNull()
    f.task.value = { ...f.initial, taskId: 'task-b' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.panel.querySelector('.tp-design-locate')).not.toBeNull()
    expect(f.panel.querySelector('.tp-section-leave-active')).toBeNull()
  })

  it('returns controls to the panel for invalid geometry and hides another file without losing recovery', async () => {
    const f = fixture()
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await expect.poll(overlayVisible).toBe(true)
    f.node.absoluteBoundingBox.x = NaN
    await expect.poll(() => f.panel.querySelector('.tp-design-stop')).not.toBeNull()
    expect(overlayVisible()).toBe(false)
    f.node.absoluteBoundingBox.x = 20
    await expect.poll(overlayVisible).toBe(true)
    Object.assign(f.api, { fileKey: 'another-file' })
    await expect.poll(() => f.panel.querySelector('.tp-design-task-section')).toBeNull()
    expect(overlayVisible()).toBe(false)
    Object.assign(f.api, { fileKey: 'file-a' })
    await expect.poll(overlayVisible).toBe(true)
    await expect.poll(() => f.panel.querySelector('.tp-design-locate')).not.toBeNull()
  })

  it('keeps comments on the active canvas and preserves edits when its anchor becomes unavailable', async () => {
    await page.viewport(900, 700)
    const requestDrafts = vi.fn(async (request) => ({
      items: [],
      ...(request.operation === 'clear' ? {} : { comment: request.comment ?? 'Saved comment' })
    }))
    const f = fixture(vi.fn(), requestDrafts)
    f.task.value = {
      ...f.initial,
      client: { kind: 'codex', name: 'Codex', sessionId: 'thread-a' },
      capabilities: { interrupt: false, queue: false, steer: false, continue: false }
    }
    await nextTick()
    expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
    expect(f.panel.querySelector('.tp-design-stop')).not.toBeNull()
    f.anchor.value = f.node as unknown as SceneNode
    await expect.element(page.getByRole('button', { name: 'Review comments' })).toBeVisible()
    expect(f.panel.querySelector('.tp-feedback-toggle')).toBeNull()
    await page.getByRole('button', { name: 'Review comments' }).click()
    const comment = () => document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')
    await expect.poll(() => comment()?.value).toBe('Saved comment')
    await page.getByRole('textbox', { name: 'General comment' }).fill('Keep this revision')
    f.node.removed = true
    await expect.poll(() => document.querySelector('.tp-feedback-toggle')).toBeNull()
    expect(document.querySelector('.tp-element-feedback')).toBeNull()
    f.task.value = { ...f.task.value, status: 'expired' }
    await expect.poll(() => f.panel.querySelector('.tp-design-stop')).not.toBeNull()
    expect(f.done).not.toHaveBeenCalled()
    expect(requestDrafts.mock.calls.some(([request]) => request.operation === 'clear')).toBe(false)
    f.node.removed = false
    await expect.poll(overlayVisible).toBe(true)
    await expect.element(page.getByRole('button', { name: 'Review comments' })).toBeVisible()
    f.task.value = { ...f.task.value, status: 'active' }
    await expect.poll(() => comment()?.value).toBe('Keep this revision')
    expect(f.panel.querySelector('.tp-feedback-toggle')).toBeNull()
    f.task.value = { ...f.task.value, status: 'completed' }
    await expect.element(page.getByRole('button', { name: 'Review comments' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Done' })).toBeEnabled()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.poll(() => f.done.mock.calls.length).toBe(1)
    expect(requestDrafts.mock.calls.some(([request]) => request.operation === 'clear')).toBe(true)
  })

  it('saves pending comments before dismissing a cancelled task without an anchor', async () => {
    await page.viewport(900, 700)
    let finishSave!: () => void
    const requestDrafts = vi.fn(async (request) => {
      if (request.operation === 'comment') {
        await new Promise<void>((resolve) => {
          finishSave = resolve
        })
        return { items: [], comment: request.comment }
      }
      return { items: [] }
    })
    const f = fixture(vi.fn(), requestDrafts)
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = {
      ...f.initial,
      client: { kind: 'codex', name: 'Codex', sessionId: 'thread-a' }
    }
    await page.getByRole('button', { name: 'Review comments' }).click()
    await page.getByRole('textbox', { name: 'General comment' }).fill('Keep the latest edit')
    f.node.removed = true
    f.task.value = { ...f.task.value, status: 'cancelled' }
    await expect.poll(() => finishSave).toBeTypeOf('function')
    await expect.poll(() => f.panel.querySelector('.tp-design-task-section')).toBeNull()
    expect(f.done).not.toHaveBeenCalled()
    expect(overlayVisible()).toBe(false)
    finishSave()
    await expect.poll(() => f.done.mock.calls).toEqual([['task-a']])
    expect(
      requestDrafts.mock.calls.some(
        ([request]) => request.operation === 'comment' && request.comment === 'Keep the latest edit'
      )
    ).toBe(true)
    expect(requestDrafts.mock.calls.some(([request]) => request.operation === 'clear')).toBe(false)
  })

  it('keeps comments available while the design task is paused and resumes delivery when available', async () => {
    const requestDrafts = vi.fn().mockResolvedValue({ items: [], comment: 'Saved guidance' })
    const sendFeedback = vi.fn()
    const f = fixture(sendFeedback, requestDrafts)
    f.anchor.value = f.node as unknown as SceneNode
    const capabilities = { interrupt: false, queue: false, steer: false, continue: false }
    f.task.value = f.initial
    await expect.poll(overlayVisible).toBe(true)
    expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
    f.task.value = {
      ...f.initial,
      client: { kind: 'other', name: 'Claude Code', sessionId: 'thread-a' },
      capabilities: { ...capabilities, queue: true }
    }
    await nextTick()
    expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
    expect(document.querySelector('.tp-element-feedback')).toBeNull()
    expect(requestDrafts).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('.tp-design-stop')!.click()
    expect(f.stop).toHaveBeenCalledOnce()

    for (const kind of ['claude', 'codex-cli'] as const) {
      f.task.value = {
        ...f.initial,
        client: { kind, name: 'Custom workspace', sessionId: 'thread-a' },
        capabilities: { ...capabilities, queue: true, steer: true }
      }
      await nextTick()
      expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
      expect(requestDrafts).not.toHaveBeenCalled()
    }
    f.task.value = {
      ...f.initial,
      client: { kind: 'codex-app', name: 'Custom workspace', sessionId: 'thread-a' },
      capabilities: { ...capabilities, queue: true }
    }
    await expect.poll(() => requestDrafts.mock.calls.length).toBe(1)
    const trigger = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
    trigger.click()
    const comment = () => document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')
    await expect.poll(() => comment()?.value).toBe('Saved guidance')
    f.task.value = { ...f.task.value, status: 'paused', capabilities }
    await nextTick()
    await expect.element(page.getByRole('button', { name: 'Review comments' })).toBeVisible()
    await expect.poll(() => comment()?.value).toBe('Saved guidance')
    f.task.value = { ...f.task.value, status: 'active' }
    await expect.poll(() => comment()?.value).toBe('Saved guidance')
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
    await expect
      .element(page.getByRole('button', { name: 'Copy comments' }))
      .not.toBeInTheDocument()
    expect(requestDrafts).toHaveBeenCalledOnce()
    expect(sendFeedback).not.toHaveBeenCalled()
  })

  it('automatically collapses after cancellation with a bounce and exits around the centered logo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    f.task.value = { ...f.initial, status: 'stopping', operation: 'writing' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(5000)
    expect(document.querySelector('.tp-design-feedback')!.textContent).toContain(
      "The agent's design task is stopping…"
    )
    f.task.value = { ...f.initial, status: 'cancelled' }
    f.anchor.value = null
    await nextTick()
    const feedback = document.querySelector('.tp-design-feedback')!
    expect(feedback.textContent).toContain("The agent's design task has stopped")
    expect(feedback.querySelector('.tp-design-done')).toBeNull()
    expect(document.querySelector('.tp-design-anchor')).toBeNull()
    const logo = feedback.querySelector<SVGSVGElement>('.tp-design-logo')!
    await nextTick()
    await expect.poll(() => feedback.classList.contains('tp-design-collapsing')).toBe(true)
    const collapse = feedback.getAnimations()[0]!
    collapse.pause()
    collapse.currentTime = 0
    const logoLeft = logo.getBoundingClientRect().left
    for (const time of [0, 200, 331.2, 370, 404.8, 440, 460]) {
      collapse.currentTime = time
      const bounds = feedback.getBoundingClientRect()
      expect(bounds.width).toBeGreaterThanOrEqual(bounds.height)
    }
    collapse.currentTime = 460
    expect(feedback.getBoundingClientRect().width).toBeCloseTo(36, 1)
    expect(logo.getBoundingClientRect().left).toBeCloseTo(logoLeft, 1)
    expect(logo.getBoundingClientRect().width).toBe(20)
    const box = feedback.getBoundingClientRect()
    const icon = logo.getBoundingClientRect()
    expect(icon.left - box.left).toBe(8)
    expect(box.right - icon.right).toBe(8)
    expect(icon.top - box.top).toBe(8)
    expect(box.bottom - icon.bottom).toBe(8)
    await vi.advanceTimersByTimeAsync(460)
    expect(feedback.classList.contains('tp-design-exiting')).toBe(true)
    await vi.advanceTimersByTimeAsync(260)
    expect(overlayVisible()).toBe(false)
    expect(f.panel.querySelector('[role="status"]')).toBeNull()
  })

  it('does not let an old dismissal timer hide a replacement task', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = fixture()
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    f.task.value = { ...f.initial, status: 'cancelled' }
    await nextTick()
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)
    f.task.value = { ...f.initial, taskId: 'task-b', title: 'New task' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(2400)
    expect(f.panel.querySelector('.tp-design-locate')?.getAttribute('data-tooltip')).toContain(
      'New task'
    )
    expect(document.querySelector('.tp-design-feedback')!.textContent).toContain(
      'The agent is working on the design'
    )
    expect(f.done).not.toHaveBeenCalled()
  })

  it('changes the L-shaped area as overlap grows, preserving the gap and rounded source at rest', async () => {
    const f = fixture()
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    const svg = document.querySelector<SVGSVGElement>('.tp-design-logo')!
    const paths = [...svg.querySelectorAll<SVGPathElement>('.tp-logo-plane')]
    const animations = paths.map((path) => path.getAnimations()[0]!)
    expect(animations).toHaveLength(2)
    const restingPaths = paths.map((path) => path.getAttribute('d'))

    async function pixelsAt(time: number) {
      animations.forEach((animation) => {
        animation.pause()
        animation.currentTime = time
      })
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('width', '512')
      clone.setAttribute('height', '512')
      clone.removeAttribute('class')
      const clones = [...clone.querySelectorAll<SVGPathElement>('.tp-logo-plane')]
      clones.forEach((path, index) => {
        const renderedPath = getComputedStyle(paths[index]!).d
        expect(renderedPath.startsWith('path("')).toBe(true)
        path.setAttribute('d', renderedPath.slice(6, -2))
        path.removeAttribute('class')
      })
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
      )
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 512
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, 512, 512).data
        let area = 0
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 200) area++
        expect(pixels[(256 * 512 + 256) * 4 + 3]).toBe(0)
        return area
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    const thick = await pixelsAt(0)
    const thin = await pixelsAt(1000)
    expect(thick).toBeGreaterThan(thin * 1.35)
    expect(thin).toBeGreaterThan(0)
    expect(paths[0]!.getAttribute('transform')).toBe('translate(-10 0)')
    expect(paths[1]!.getAttribute('transform')).toBe('translate(10 0) rotate(180 256 320)')
    f.task.value = { ...f.initial, status: 'stopping' }
    await nextTick()
    expect(paths[0]!.getAnimations()).toHaveLength(1)
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(restingPaths)
  })

  it('hides on another page, retains reachable controls after removal, and stops activity on completion', async () => {
    const f = fixture()
    f.task.value = f.initial
    f.anchor.value = f.node as unknown as SceneNode
    await nextTick()
    expect(document.querySelector('.tp-design-overlay')).not.toBeNull()
    f.api.currentPage.id = 'page-b'
    await expect.poll(overlayVisible).toBe(false)
    f.api.currentPage.id = 'page-a'
    await expect.poll(overlayVisible).toBe(true)
    f.node.removed = true
    await expect.poll(() => f.panel.querySelector('.tp-design-stop')).not.toBeNull()
    expect(overlayVisible()).toBe(false)
    expect(f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!.disabled).toBe(true)
    f.task.value = { ...f.initial, status: 'completed' }
    await nextTick()
    expect(f.panel.querySelector('.tp-design-done')).not.toBeNull()
    expect(overlayVisible()).toBe(false)
    expect(document.querySelector('.tp-design-shimmer')).toBeNull()
    expect(f.done).not.toHaveBeenCalled()
  })

  it.each([
    ['active', 'Codex is working in another tab'],
    ['stopping', "Codex's design task is stopping…"]
  ] as const)(
    'shows the %s task state when its page session no longer matches',
    async (status, text) => {
      const f = fixture()
      f.task.value = {
        ...f.initial,
        client: { kind: 'codex-app', name: 'Codex' },
        status,
        target: { ...f.initial.target, sessionId: 'before-reload' }
      }
      await nextTick()
      const entry = f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!
      expect(entry.textContent).toBe(text)
      expect(entry.getAttribute('data-tooltip')).toBe('Settings design')
      expect(entry.getAttribute('aria-label')).toBe(text)
      expect(entry.disabled).toBe(true)
      expect(overlayVisible()).toBe(false)
    }
  )

  it.each(['paused', 'expired', 'interrupted', 'completed', 'cancelled'] as const)(
    'hides a %s task from the pre-refresh session and shows a fresh local task',
    async (status) => {
      const f = fixture()
      f.task.value = {
        ...f.initial,
        client: { kind: 'codex-app', name: 'Codex' },
        status,
        target: { ...f.initial.target, sessionId: 'before-reload' }
      }
      await expect.poll(() => f.panel.querySelector('.tp-design-task-section')).toBeNull()
      expect(f.panel.querySelector('.tp-design-locate')).toBeNull()
      expect(document.querySelector('.tp-design-overlay')).toBeNull()
      expect(document.querySelector('.tp-element-feedback')).toBeNull()
      f.task.value = { ...f.initial, taskId: 'fresh-task' }
      f.anchor.value = f.node as unknown as SceneNode
      await expect.poll(() => f.panel.querySelector('.tp-design-locate')).not.toBeNull()
      await expect.poll(() => overlayVisible()).toBe(true)
    }
  )

  it.each(['paused', 'expired', 'interrupted', 'completed'] as const)(
    'restores the tab-owned %s task controls after refresh',
    async (status) => {
      await page.viewport(900, 700)
      const f = fixture()
      f.restored.value = true
      f.anchor.value = f.node as unknown as SceneNode
      f.task.value = {
        ...f.initial,
        status,
        target: { ...f.initial.target, sessionId: 'before-reload' }
      }
      await expect.poll(overlayVisible).toBe(true)
      await page.getByRole('button', { name: 'Locate agent status on canvas' }).click()
      expect(f.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledExactlyOnceWith([f.node])
      expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
      if (status === 'completed') {
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        await expect.poll(() => f.done.mock.calls).toEqual([['task-a']])
      } else {
        await page.getByRole('button', { name: 'Stop design task' }).click()
        expect(f.stop).toHaveBeenCalledOnce()
      }
    }
  )

  it('shows inactive and other-tab tasks without an animated local placeholder', async () => {
    const f = fixture()
    f.anchor.value = f.node as unknown as SceneNode
    f.task.value = { ...f.initial, target: { ...f.initial.target, sessionId: 'tab-b' } }
    await nextTick()
    expect(f.panel.textContent).toBe('The agent is working in another tab')
    expect(f.panel.querySelector('.tp-design-locate')!.getAttribute('data-tooltip')).toBe(
      'Settings design'
    )
    expect(f.panel.querySelector<HTMLButtonElement>('.tp-design-locate')!.disabled).toBe(true)
    expect(overlayVisible()).toBe(false)
    f.task.value = { ...f.initial, status: 'expired' }
    await nextTick()
    expect(document.querySelector('.tp-design-feedback')?.textContent).toContain(
      "The agent's design task is paused"
    )
    expect(document.querySelector('.tp-design-logo')?.classList.contains('tp-logo-loading')).toBe(
      false
    )
    expect(f.panel.querySelector('.tp-design-stop')).toBeNull()
    expect(f.panel.querySelector('.tp-design-spinner')).toBeNull()
  })
})
