import '@/entrypoints/ui/style.css'
import type {
  DesignActionResult,
  DesignFeedback,
  DesignTask,
  FeedbackDraftScope
} from '@tempad-dev/shared'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import DesignTaskStatus from '@/components/DesignTaskStatus.vue'
import { FeedbackDraftStore } from '@/mcp/broker/feedback-drafts'
import { getContainingPage } from '@/mcp/local-resources'

import { mount, unmountAll } from './mount'

const scope: FeedbackDraftScope = {
  taskId: 'task-a',
  fileKey: 'file-a',
  clientKind: 'codex-app',
  conversationId: 'thread-a'
}
function storageFixture() {
  const data: Record<string, unknown> = {}
  return {
    async get(key: string) {
      return { [key]: structuredClone(data[key]) }
    },
    async set(values: Record<string, unknown>) {
      Object.assign(data, structuredClone(values))
    },
    async remove(key: string) {
      delete data[key]
    }
  }
}

function fixture(storage = storageFixture(), sessionId = 'tab-a') {
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
  const pageA = {
    id: 'page-a',
    type: 'PAGE',
    name: 'Settings',
    parent: null,
    selection: [] as unknown[]
  }
  const pageB = {
    id: 'page-b',
    type: 'PAGE',
    name: 'Access',
    parent: null,
    selection: [] as unknown[]
  }
  const nodes = ['Heading', 'Button', 'Footer'].map((name, index) => ({
    id: `node-${index}`,
    type: 'FRAME',
    name,
    visible: true,
    removed: false,
    absoluteBoundingBox: { x: 40 + index * 180, y: 80 + index * 80, width: 120, height: 60 },
    parent: pageA
  }))
  const api = {
    notify: vi.fn(() => ({ cancel: vi.fn() })),
    fileKey: 'file-a',
    root: { name: 'Product' },
    currentPage: pageA,
    getNodeByIdAsync: vi.fn(
      async (id: string) => nodes.find((node) => node.id === id && !node.removed) ?? null
    ),
    viewport: {
      bounds: { x: 0, y: 0, width: 600, height: 500 },
      zoom: 1,
      scrollAndZoomIntoView: vi.fn()
    }
  }
  vi.stubGlobal('figma', api)
  const store = new FeedbackDraftStore(storage)
  const send = vi.fn<(feedback: DesignFeedback) => Promise<DesignActionResult>>(
    async (feedback) => {
      await store.recordSubmission(scope, feedback)
      await store.settle(feedback.id, 'delivered')
      return { requestId: feedback.id, taskId: 'task-a', status: 'delivered', message: 'Sent' }
    }
  )
  const requestDrafts = vi.fn(store.request.bind(store))
  const actionResult = shallowRef<DesignActionResult | null>(null)
  const restored = shallowRef(false)
  const task = shallowRef<DesignTask>({
    taskId: 'task-a',
    title: 'Settings design',
    status: 'active',
    operation: 'writing',
    expiresAt: 300000,
    revision: 1,
    target: { sessionId, fileKey: 'file-a', fileName: 'Product', pageId: 'page-a' },
    client: { kind: 'codex-app', name: 'Codex App', sessionId: 'thread-a' },
    capabilities: { interrupt: true, queue: true, continue: false, steer: true }
  })
  const anchor = shallowRef<SceneNode | null>(nodes[0] as unknown as SceneNode)
  const host = mount(
    defineComponent(
      () => () =>
        h(DesignTaskStatus, {
          task: task.value,
          sessionId,
          anchor: anchor.value,
          restored: restored.value,
          sendFeedback: send,
          requestDrafts,
          actionResult: actionResult.value
        })
    ),
    {
      tag: 'tempad',
      tokens: {
        '--spacer-1': '4px',
        '--spacer-2': '8px',
        '--spacer-4': '24px',
        '--radius-medium': '5px',
        '--radius-large': '13px',
        '--color-bg': '#fff',
        '--color-border': '#ddd',
        '--color-text': '#222',
        '--color-text-secondary': '#666',
        '--color-icon-brand': '#0d99ff',
        '--color-bg-brand': '#0d99ff',
        '--color-icon-onbrand': '#fff',
        '--elevation-200-canvas': '0 2px 6px #0003'
      }
    }
  )
  return {
    api,
    task,
    host,
    panel: host.firstElementChild as HTMLElement,
    nodes,
    pageA,
    pageB,
    send,
    storage,
    store,
    requestDrafts,
    canvas,
    actionResult,
    restored,
    anchor
  }
}

const markers = () => [...document.querySelectorAll<HTMLButtonElement>('.tp-feedback-marker-draft')]
function click(selector: string) {
  document.querySelector<HTMLButtonElement>(selector)!.click()
}
async function openBatch() {
  const trigger = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
  await expect.poll(() => trigger.disabled).toBe(false)
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
  await expect.poll(() => document.querySelector('.tp-feedback-review')).not.toBeNull()
}
function acceptNextBatch(f: ReturnType<typeof fixture>) {
  f.send.mockImplementationOnce(async (feedback) => {
    await f.store.recordSubmission(scope, feedback)
    return { requestId: feedback.id, taskId: 'task-a', status: 'accepted', message: 'Queued' }
  })
}
async function sendBatch() {
  await openBatch()
  click('.tp-feedback-send')
}
async function writeComment(text: string) {
  await openBatch()
  const input = document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function save(f: ReturnType<typeof fixture>, index: number, text: string) {
  const node = f.nodes[index]!
  f.api.currentPage = getContainingPage(node as unknown as SceneNode) as unknown as typeof f.pageA
  f.api.currentPage.selection = [node]
  await expect
    .poll(() => document.querySelector(`[aria-label="Add comment to ${node.name}"]`))
    .not.toBeNull()
  click(`[aria-label="Add comment to ${node.name}"]`)
  await expect.poll(() => document.querySelector('.tp-feedback-editor textarea')).not.toBeNull()
  const input = document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')!
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  click('.tp-feedback-editor [type="submit"]')
  await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
}

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

describe('element feedback drafts', () => {
  it.each(
    ['Meta', 'Control'].flatMap((modifier) =>
      ['Enter', 'click'].map((action) => ({ modifier, action }))
    )
  )(
    'queues the entire batch from the element editor with $modifier+$action and closes after acceptance',
    async ({ modifier, action }) => {
      await page.viewport(900, 700)
      const f = fixture()
      await save(f, 0, 'Previously saved element')
      await writeComment('General guidance')
      await expect
        .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
        .toBe('General guidance')
      f.api.currentPage.selection = [f.nodes[1]!]
      await expect
        .poll(() => document.querySelector('[aria-label="Add comment to Button"]'))
        .not.toBeNull()
      click('[aria-label="Add comment to Button"]')
      await page
        .getByRole('textbox', { name: 'Element comment', exact: true })
        .fill('Current element edit')
      let saved!: () => void
      f.requestDrafts.mockImplementation(async (request) => {
        if (request.operation === 'save')
          await new Promise<void>((resolve) => {
            saved = resolve
          })
        return f.store.request(request)
      })
      let accepted!: (result: DesignActionResult) => void
      f.send.mockImplementation(async (feedback) => {
        await f.store.recordSubmission(scope, feedback)
        return new Promise<DesignActionResult>((resolve) => {
          accepted = resolve
        })
      })
      const submitButton = document.querySelector<HTMLButtonElement>(
        '.tp-feedback-editor [type="submit"]'
      )!
      expect(submitButton.getAttribute('data-tooltip')).toBe('Save comment')
      await userEvent.keyboard(`{${modifier}>}`)
      expect(submitButton.getAttribute('data-tooltip')).toBe('Save & Queue')
      if (action === 'click' && modifier === 'Control') {
        // Native macOS Ctrl-click opens a context menu; use the Windows primary-click event.
        submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
      } else if (action === 'click')
        await page.getByRole('button', { name: 'Save & Queue' }).click()
      else await userEvent.keyboard('{Enter}')
      await userEvent.keyboard(`{/${modifier}}`)
      await expect.poll(() => typeof saved).toBe('function')
      expect(f.send).not.toHaveBeenCalled()
      const button = document.querySelector<HTMLButtonElement>(
        '.tp-feedback-editor [type="submit"]'
      )!
      expect(button.getAttribute('aria-busy')).toBe('true')
      expect(button.querySelector('.tp-feedback-spinner')).toBeNull()
      expect(button.querySelector('svg')).not.toBeNull()
      expect(button.getAttribute('data-tooltip')).toBe('Save comment')
      button.click()
      saved()
      await expect.poll(() => typeof accepted).toBe('function')
      expect(f.send).toHaveBeenCalledOnce()
      const feedback = f.send.mock.calls[0]![0]
      expect(feedback).toMatchObject({
        mode: 'queue',
        comment: 'General guidance',
        items: [
          { nodeId: 'node-0', text: 'Previously saved element' },
          { nodeId: 'node-1', text: 'Current element edit' }
        ]
      })
      expect(button.querySelector('.tp-feedback-spinner')).toBeNull()
      expect(button.querySelector('svg')).not.toBeNull()
      const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
      expect(toggle.disabled).toBe(true)
      expect(toggle.querySelector('.tp-feedback-spinner')).not.toBeNull()
      expect(toggle.getAttribute('data-tooltip')).toBe('Sending comments…')
      expect(document.querySelector('.tp-feedback-editor')!.textContent).not.toMatch(
        /Loading|Waiting|Queued|Sending/
      )
      accepted({ requestId: feedback.id, taskId: 'task-a', status: 'accepted', message: 'Queued' })
      await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
      expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(2)
    }
  )

  it.each(['element', 'general'] as const)(
    'uses the click modifier without a preceding keydown in the %s composer',
    async (composer) => {
      const f = fixture()
      if (composer === 'element') {
        await save(f, 0, 'Original comment')
        markers()[0]!.click()
        await page
          .getByRole('textbox', { name: 'Element comment', exact: true })
          .fill('Revised comment')
      } else await writeComment('General guidance')
      const button = document.querySelector<HTMLButtonElement>(
        composer === 'element' ? '.tp-feedback-editor [type="submit"]' : '.tp-feedback-send'
      )!
      button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
      )
      await expect.poll(() => f.send.mock.calls.length).toBe(1)
      expect(f.send.mock.calls[0]![0]).toMatchObject(
        composer === 'element'
          ? { mode: 'queue', items: [{ text: 'Revised comment' }] }
          : { mode: 'steer', comment: 'General guidance' }
      )
    }
  )

  it('retains an element edit and does not queue other drafts when Save & Queue cannot save', async () => {
    const f = fixture()
    await save(f, 0, 'Original comment')
    await writeComment('General guidance')
    markers()[0]!.click()
    const input = page.getByRole('textbox', { name: 'Element comment', exact: true })
    await input.fill('Revised comment')
    f.requestDrafts.mockImplementation(async (request) => {
      if (request.operation === 'save') throw new Error('Could not save the comment.')
      return f.store.request(request)
    })
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Could not save the comment.']])
    await expect.element(input).toHaveValue('Revised comment')
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Original comment'
    )
    expect(f.send).not.toHaveBeenCalled()
  })

  it('shows submission progress only on the status-bar entry, retains failures, and closes a successful retry', async () => {
    const f = fixture()
    await writeComment('Retain this guidance')
    let finish!: (result: DesignActionResult) => void
    f.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const button = document.querySelector<HTMLButtonElement>('.tp-feedback-send')!
    expect(button.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24')
    button.click()
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
    expect(toggle.disabled).toBe(true)
    expect(toggle.querySelector('.tp-feedback-spinner')).not.toBeNull()
    expect(toggle.querySelector('svg:not(.tp-feedback-spinner)')).toBeNull()
    expect(toggle.getAttribute('data-tooltip')).toBe('Sending comments…')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('.tp-feedback-spinner')).toBeNull()
    expect(button.querySelector('svg')).not.toBeNull()
    button.click()
    const feedback = f.send.mock.calls[0]![0]
    expect(feedback.mode).toBe('queue')
    finish({ requestId: feedback.id, taskId: 'task-a', status: 'failed', message: 'Disconnected' })
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Disconnected']])
    expect(toggle.disabled).toBe(false)
    expect(toggle.querySelector('.tp-feedback-spinner')).toBeNull()
    expect(toggle.getAttribute('data-tooltip')).toBe('Review comments')
    expect(document.querySelector('.tp-feedback-review')).not.toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.value).toBe(
      'Retain this guidance'
    )
    expect(button.getAttribute('aria-busy')).toBe('false')
    button.click()
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(f.send.mock.calls[1]![0].id).toBe(feedback.id)
  })

  it('keeps the open composer and element comments across completed review passes with new epochs', async () => {
    const f = fixture()
    await save(f, 0, 'Keep this element comment')
    await writeComment('Keep this general comment')
    for (const [status, epoch] of [
      ['completed', 0],
      ['active', 1],
      ['completed', 1],
      ['active', 2]
    ] as const) {
      f.task.value = { ...f.task.value, status, epoch }
      await nextTick()
      expect(document.querySelector('.tp-feedback-review')).not.toBeNull()
      expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.value).toBe(
        'Keep this general comment'
      )
      expect(markers()).toHaveLength(1)
      expect(document.querySelector('.tp-feedback-review')!.textContent).toContain(
        'Keep this element comment'
      )
    }
    expect(f.send).not.toHaveBeenCalled()
  })

  it('starts a new task with empty feedback and ignores the previous task delivery', async () => {
    const f = fixture()
    await save(f, 0, 'Original note')
    await writeComment('Original guidance')
    let finish!: () => Promise<void>
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      return new Promise((resolve) => {
        finish = async () => {
          await f.store.settle(feedback.id, 'delivered')
          resolve({
            requestId: feedback.id,
            taskId: scope.taskId,
            status: 'delivered',
            message: 'Sent'
          })
        }
      })
    })
    await sendBatch()
    await expect.poll(() => typeof finish).toBe('function')
    f.task.value = { ...f.task.value, taskId: 'task-b' }
    await expect.poll(() => markers().length).toBe(0)
    await openBatch()
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.value).toBe('')
    await save(f, 0, 'New task note')
    await writeComment('New task guidance')
    const nextScope = { ...scope, taskId: 'task-b' }
    await expect
      .poll(async () => (await f.store.request({ operation: 'load', scope: nextScope })).comment)
      .toBe('New task guidance')
    await finish()
    await nextTick()
    expect(markers()).toHaveLength(1)
    expect(markers()[0]!.classList.contains('tp-feedback-marker-sent')).toBe(false)
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.value).toBe(
      'New task guidance'
    )
    expect((await f.store.request({ operation: 'load', scope: nextScope })).items[0]!.text).toBe(
      'New task note'
    )
    expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [] })
  })

  it('reveals a flat brand add button near the selected frame and leaves the native agent entry clickable', async () => {
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    expect(getComputedStyle(add).opacity).toBe('0')
    expect(getComputedStyle(add).pointerEvents).toBe('none')

    // The 2× reference shows a 32px button, 8px below the top, and a 16px gap
    // beyond the selection outline: 16px size, 4px top, 9px from the node edge in CSS.
    const native = document.createElement('button')
    native.textContent = 'Figma agent'
    Object.assign(native.style, {
      position: 'fixed',
      left: '249px',
      top: '104px',
      width: '16px',
      height: '16px'
    })
    f.canvas.parentElement!.append(native)
    const nativeClick = vi.fn()
    native.addEventListener('click', nativeClick)
    f.canvas.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 120 })
    )
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    expect(getComputedStyle(add).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(add).boxShadow).toBe('none')
    expect(getComputedStyle(add).color).toBe('rgb(13, 153, 255)')
    expect(add.getBoundingClientRect()).toMatchObject({ width: 16, height: 16 })
    expect(add.querySelector('svg')!.getBoundingClientRect()).toMatchObject({
      width: 12,
      height: 12
    })
    const commentBounds = add.getBoundingClientRect()
    const nativeBounds = native.getBoundingClientRect()
    expect(commentBounds).toMatchObject({ left: 249, top: 128 })
    expect(commentBounds.left).toBe(nativeBounds.left)
    expect(commentBounds.top - nativeBounds.bottom).toBe(8)
    // Leave the frame's dimension row clear, including its bottom-right resize handle.
    expect(document.elementFromPoint(180, 176)).toBe(f.canvas)
    expect(document.elementFromPoint(240, 160)).toBe(f.canvas)
    expect(getComputedStyle(add.querySelector('svg')!).fill).toBe('none')
    expect(getComputedStyle(add.querySelector('path')!).strokeWidth).toBe('1.6px')
    expect(getComputedStyle(add).borderTopLeftRadius).toBe('8px')
    expect(document.elementFromPoint(256, 116)).toBe(native)
    await page.getByRole('button', { name: 'Figma agent', exact: true }).click()
    expect(nativeClick).toHaveBeenCalledOnce()
    await page.elementLocator(f.canvas).hover({ position: { x: 120, y: 100 } })
    const nativeLeave = vi.fn()
    const nativeDown = vi.fn()
    f.canvas.addEventListener('pointerleave', nativeLeave)
    f.canvas.addEventListener('pointerdown', nativeDown)
    await page.getByRole('button', { name: 'Add comment to Heading', exact: true }).hover()
    await expect.poll(() => getComputedStyle(add).backgroundColor).toBe('rgb(13, 153, 255)')
    expect(getComputedStyle(add).pointerEvents).toBe('auto')
    expect(add.contains(document.elementFromPoint(257, 136))).toBe(true)
    expect(nativeLeave).toHaveBeenCalledOnce()
    expect(getComputedStyle(add).color).toBe('rgb(13, 153, 255)')
    expect(getComputedStyle(add.querySelector('path')!).stroke).toBe('rgb(13, 153, 255)')
    expect(getComputedStyle(add.querySelector('path')!).fill).toBe('rgb(255, 255, 255)')
    const innerStroke = add.querySelectorAll('path')[1]!
    expect(getComputedStyle(innerStroke).stroke).toBe('rgb(255, 255, 255)')
    expect(innerStroke.getAttribute('clip-path')).toBe(`url(#${add.querySelector('clipPath')!.id})`)
    expect(getComputedStyle(add).getPropertyValue('corner-shape')).toBe('superellipse(2)')
    await page.getByRole('button', { name: 'Add comment to Heading', exact: true }).click()
    const editor = document.querySelector<HTMLElement>('.tp-feedback-editor')!
    expect(getComputedStyle(editor).boxShadow).toBe('rgba(0, 0, 0, 0.2) 0px 2px 6px 0px')
    expect(nativeDown).not.toHaveBeenCalled()
  })

  it('keeps markers below native tooltips and does not capture clicks through them', async () => {
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    await page.elementLocator(f.canvas).hover({ position: { x: 120, y: 100 } })
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    const tooltip = document.createElement('div')
    tooltip.setAttribute('role', 'tooltip')
    tooltip.textContent = 'Figma agent tooltip'
    Object.assign(tooltip.style, {
      position: 'fixed',
      left: '249px',
      top: '128px',
      width: '110px',
      height: '28px',
      background: '#222',
      zIndex: '1',
      pointerEvents: 'none'
    })
    f.canvas.parentElement!.append(tooltip)
    await expect.poll(() => getComputedStyle(add.parentElement!).display).toBe('none')
    expect(getComputedStyle(document.querySelector('.tp-feedback-markers')!).zIndex).toBe('0')
    const nativeClick = vi.fn()
    f.canvas.addEventListener('click', nativeClick)
    await page.elementLocator(f.canvas).click({ position: { x: 177, y: 116 } })
    expect(nativeClick).toHaveBeenCalledOnce()
    expect(document.querySelector('.tp-feedback-editor')).toBeNull()
    tooltip.style.opacity = '0'
    await expect.poll(() => getComputedStyle(add.parentElement!).display).not.toBe('none')
    tooltip.style.opacity = '1'
    await expect.poll(() => getComputedStyle(add.parentElement!).display).toBe('none')
    tooltip.remove()
    await expect.poll(() => getComputedStyle(add.parentElement!).display).not.toBe('none')
    await page.elementLocator(f.canvas).hover({ position: { x: 120, y: 100 } })
    await page.getByRole('button', { name: 'Add comment to Heading' }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).not.toBeNull()
    expect(nativeClick).toHaveBeenCalledOnce()
  })

  it('does not finish a marker click after the task lease changes', async () => {
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    await page.elementLocator(f.canvas).hover({ position: { x: 120, y: 100 } })
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    const event = {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      button: 0,
      clientX: 257,
      clientY: 136
    }
    const nativeDown = vi.fn()
    f.canvas.addEventListener('pointerdown', nativeDown)
    add.dispatchEvent(new PointerEvent('pointerdown', event))
    expect(nativeDown).not.toHaveBeenCalled()
    f.task.value = { ...f.task.value, epoch: 1 }
    await nextTick()
    expect(add.isConnected).toBe(false)
    expect(document.querySelector('.tp-feedback-marker-add')).not.toBe(add)
    f.canvas.dispatchEvent(new PointerEvent('pointerup', event))
    expect(document.querySelector('.tp-feedback-editor')).toBeNull()
  })

  it.each(['cancelled', 'stopping'] as const)(
    'hides comment entry points for a %s task while retaining saved drafts',
    async (status) => {
      const f = fixture()
      await save(f, 0, 'Keep this comment')
      f.task.value = { ...f.task.value, status }
      await expect.poll(() => document.querySelector('.tp-feedback-toggle')).toBeNull()
      expect(document.querySelector('.tp-element-feedback')).toBeNull()
      expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
        'Keep this comment'
      )
      expect(f.send).not.toHaveBeenCalled()
    }
  )

  it.each(['paused', 'expired', 'interrupted', 'completed'] as const)(
    'allows further element and general comments on an open %s task',
    async (status) => {
      const f = fixture()
      await save(f, 0, 'First comment')
      f.task.value = { ...f.task.value, status }
      await expect.element(page.getByRole('button', { name: 'Review 1 comments' })).toBeVisible()
      await save(f, 1, 'Follow-up comment')
      await writeComment('Review these changes')
      await expect
        .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
        .toBe('Review these changes')
      expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(2)
      expect(f.send).not.toHaveBeenCalled()
      await sendBatch()
      await expect.poll(() => f.send.mock.calls.length).toBe(1)
    }
  )

  it.each(['original', 'refreshed'])(
    'reports an unsuccessful send while %s, retains completed comments, and permits retry',
    async (connection) => {
      await page.viewport(900, 700)
      const f = fixture()
      await save(f, 0, 'First comment')
      f.restored.value = connection === 'refreshed'
      f.task.value = {
        ...f.task.value,
        status: 'completed',
        target: {
          ...f.task.value.target,
          sessionId: connection === 'refreshed' ? 'before-refresh' : 'tab-a'
        }
      }
      await save(f, 1, 'Follow-up comment')
      await writeComment('Another round of feedback')
      await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
      expect(page.getByRole('button', { name: /continue/i }).elements()).toEqual([])
      expect(document.querySelector('.tp-feedback-review')?.textContent).not.toMatch(
        /Copy|Continue|Retry loading/
      )
      f.send.mockRejectedValueOnce(new Error('The agent connection is unavailable.'))
      await sendBatch()
      await expect
        .poll(() => f.api.notify.mock.calls)
        .toEqual([['The agent connection is unavailable.']])
      expect(f.send).toHaveBeenCalledOnce()
      expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(2)
      f.task.value = {
        ...f.task.value,
        target: { ...f.task.value.target, sessionId: 'tab-a' }
      }
      await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
      await sendBatch()
      await expect.poll(() => f.send.mock.calls.length).toBe(2)
      expect(f.send.mock.calls[1]![0]).toMatchObject({
        comment: 'Another round of feedback',
        items: [
          expect.objectContaining({ text: 'First comment' }),
          expect.objectContaining({ text: 'Follow-up comment' })
        ]
      })
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await expect.poll(() => document.querySelector('.tp-design-overlay')).toBeNull()
      expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [] })
    }
  )

  it('reveals only inside the frame, then retains the entry through its expanded hover area', async () => {
    await page.viewport(900, 700)
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    const move = async (clientX: number, clientY: number) => {
      await page.elementLocator(f.canvas).hover({
        position: { x: clientX - 80, y: clientY - 20 },
        force: true
      })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    }
    const entry = add.getBoundingClientRect()
    await move(entry.x + 10, entry.y + 10)
    expect(add.classList.contains('tp-feedback-marker-revealed')).toBe(false)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await move(116, 120)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await move(200, 120)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    await move(244, 140)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    await move(entry.x + 10, entry.y + 10)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    await move(entry.right + 12, entry.bottom + 12)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await move(entry.x + 10, entry.y + 10)
    expect(add.classList.contains('tp-feedback-marker-revealed')).toBe(false)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await move(200, 120)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    f.api.currentPage.selection = [f.nodes[1]!]
    await expect
      .element(page.getByRole('button', { name: 'Add comment to Button', exact: true }))
      .toBeInTheDocument()
    await expect
      .poll(() => getComputedStyle(document.querySelector('.tp-feedback-marker-add')!).opacity)
      .toBe('0')
  })

  it('does not reveal a partly offscreen selection while the pointer is over the side panel', async () => {
    const f = fixture()
    f.nodes[0]!.absoluteBoundingBox.x = -60
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 120 }))
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    expect(getComputedStyle(document.querySelector('.tp-feedback-marker-add')!).opacity).toBe('0')
  })

  it('waits 100ms before hiding and cancels the exit when the pointer returns', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    const move = async (clientX: number, clientY: number) => {
      await page.elementLocator(f.canvas).hover({
        position: { x: clientX - 80, y: clientY - 20 },
        force: true
      })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    }
    await move(200, 120)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    await move(400, 400)
    now = 1099
    await move(400, 400)
    expect(add.classList.contains('tp-feedback-marker-revealed')).toBe(true)
    expect(getComputedStyle(add).pointerEvents).toBe('auto')
    // Reentry through the travel corridor cancels the pending exit.
    await move(244, 140)
    now = 1200
    await move(244, 140)
    expect(add.classList.contains('tp-feedback-marker-revealed')).toBe(true)
    await move(400, 400)
    now = 1299
    await move(400, 400)
    expect(add.classList.contains('tp-feedback-marker-revealed')).toBe(true)
    now = 1300
    await move(400, 400)
    expect(add.classList.contains('tp-feedback-marker-revealed')).toBe(false)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
  })

  it('retains a tall selection through the triangular corridor and hides outside its sloping edge', async () => {
    const f = fixture()
    f.nodes[0]!.absoluteBoundingBox.height = 360
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    const move = (clientX: number, clientY: number) =>
      page.elementLocator(f.canvas).hover({
        position: { x: clientX - 80, y: clientY - 20 },
        force: true
      })
    await move(200, 200)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    // Passive travel retention leaves both the selection and gap on the native canvas.
    expect(document.elementFromPoint(121, 260)).toBe(f.canvas)
    await move(244, 300)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    expect(document.elementFromPoint(244, 300)).toBe(f.canvas)
    await move(256, 400)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await move(244, 300)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await move(200, 200)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    await move(276, 116)
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
  })

  it('keeps the add button reachable by keyboard and hides it when the pointer leaves the frame', async () => {
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const add = document.querySelector<HTMLButtonElement>('.tp-feedback-marker-add')!
    f.canvas.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 120 })
    )
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    window.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }))
    await expect.poll(() => getComputedStyle(add).opacity).toBe('0')
    await userEvent.keyboard('{Tab}')
    add.focus()
    await expect.poll(() => getComputedStyle(add).opacity).toBe('1')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).not.toBeNull()
  })

  it('keeps the add entry inside the canvas at its right edge', async () => {
    const f = fixture()
    const selected = f.nodes[0]!
    selected.absoluteBoundingBox = { x: 500, y: 80, width: 100, height: 60 }
    f.api.currentPage.selection = [selected]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const rect = document.querySelector('.tp-feedback-marker-add')!.getBoundingClientRect()
    expect(rect.right).toBe(f.canvas.getBoundingClientRect().right - 8)
    expect(rect.left).toBeGreaterThanOrEqual(f.canvas.getBoundingClientRect().left)
  })

  it('unlocks review after acceptance while the submitted batch waits for delivery', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      capabilities: {
        interrupt: false,
        continue: false,
        queue: true,
        steer: true,
        queueDelivery: 'turn-end',
        steerDelivery: 'next-tool'
      }
    }
    f.send.mockImplementation(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      return {
        requestId: feedback.id,
        taskId: f.task.value.taskId,
        status: 'accepted',
        message: 'Queued'
      }
    })
    await save(f, 0, 'Increase spacing')
    await sendBatch()
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('aria-busy'))
      .toBe('true')
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('data-tooltip')).toBe('Comments queued. Waiting for Codex App…')
    expect(toggle.getAttribute('aria-label')).toBe('Review 1 comments')
    expect(toggle.querySelector('.tp-feedback-spinner')).not.toBeNull()
    expect(toggle.querySelector('svg:not(.tp-feedback-spinner)')).toBeNull()
    await openBatch()
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('.tp-feedback-remove')!.disabled).toBe(true)
    const submit = document.querySelector<HTMLButtonElement>('.tp-feedback-send')!
    expect(submit.disabled).toBe(true)
    expect(submit.querySelector('.tp-feedback-spinner')).toBeNull()
    expect(submit.querySelector('svg')).not.toBeNull()
    submit.click()
    expect(f.send).toHaveBeenCalledOnce()
    expect(markers()).toHaveLength(1)
    await expect
      .element(page.getByRole('button', { name: 'Queue comments', exact: true }))
      .toBeDisabled()
    const feedback = f.send.mock.calls[0]![0]
    expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(1)
    f.actionResult.value = {
      requestId: 'another-feedback',
      taskId: f.task.value.taskId,
      status: 'delivered',
      message: 'Collected'
    }
    await nextTick()
    expect(toggle.disabled).toBe(false)
    expect(markers()).toHaveLength(1)
    await f.store.settle(feedback.id, 'delivered')
    f.actionResult.value = {
      requestId: feedback.id,
      taskId: f.task.value.taskId,
      status: 'delivered',
      message: 'Collected'
    }
    await expect.poll(() => markers().length).toBe(0)
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('aria-busy')).toBe('false')
    expect(toggle.getAttribute('data-tooltip')).toBe('Review comments')
    expect(toggle.querySelector('.tp-feedback-spinner')).toBeNull()
    await openBatch()
    await expect.element(page.getByText('Queued for the next response')).not.toBeInTheDocument()
  })

  it('tracks the next feedback independently while the agent is executing the delivered one', async () => {
    const f = fixture()
    await writeComment('First feedback')
    await sendBatch()
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    const first = f.send.mock.calls[0]![0]
    await openBatch()
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toBeEnabled()
    expect((await f.store.request({ operation: 'load', scope })).comment).toBeUndefined()
    expect(f.task.value.status).toBe('active')

    acceptNextBatch(f)
    await writeComment('Second feedback')
    await sendBatch()
    await expect.poll(() => f.send.mock.calls.length).toBe(2)
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    const second = f.send.mock.calls[1]![0]
    expect(second.id).not.toBe(first.id)
    const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
    expect(toggle.disabled).toBe(false)
    expect(toggle.querySelector('.tp-feedback-spinner')).not.toBeNull()
    expect(toggle.getAttribute('data-tooltip')).toBe('Comments queued. Waiting for Codex App…')
    await openBatch()
    const input = document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!
    expect(input.value).toBe('Second feedback')
    expect(input.disabled).toBe(true)
    expect(document.querySelector('.tp-feedback-send .tp-feedback-spinner')).toBeNull()

    f.actionResult.value = {
      requestId: first.id,
      taskId: 'task-a',
      status: 'delivered',
      message: 'First already delivered'
    }
    await nextTick()
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    expect(input.value).toBe('Second feedback')
    expect((await f.store.request({ operation: 'load', scope })).submission?.id).toBe(second.id)

    await f.store.settle(second.id, 'delivered')
    f.actionResult.value = {
      requestId: second.id,
      taskId: 'task-a',
      status: 'delivered',
      message: 'Second delivered'
    }
    await expect.poll(() => input.disabled).toBe(false)
    expect(toggle.querySelector('.tp-feedback-spinner')).toBeNull()
    expect(toggle.getAttribute('aria-busy')).toBe('false')
    expect(input.value).toBe('')
    expect(f.task.value.status).toBe('active')
    expect(f.send).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['delivered', 'accepted'],
    ['failed', 'accepted'],
    ['delivered', 'rejected'],
    ['failed', 'rejected']
  ] as const)(
    'keeps an early %s receipt final when the initial request is later %s',
    async (status, response) => {
      const f = fixture()
      let resolve!: (result: DesignActionResult) => void
      let reject!: (error: Error) => void
      f.send.mockImplementationOnce(async (feedback) => {
        await f.store.recordSubmission(scope, feedback)
        return new Promise((finish, fail) => {
          resolve = finish
          reject = fail
        })
      })
      await writeComment('Keep the delivery identity')
      await sendBatch()
      await expect.poll(() => typeof resolve).toBe('function')
      const feedback = f.send.mock.calls[0]![0]
      await f.store.settle(feedback.id, status)
      f.actionResult.value = {
        requestId: feedback.id,
        taskId: 'task-a',
        status,
        message: status === 'failed' ? 'Delivery failed' : 'Collected'
      }
      await nextTick()
      if (response === 'accepted')
        resolve({ requestId: feedback.id, taskId: 'task-a', status: 'accepted', message: 'Queued' })
      else reject(new Error('Transport timed out'))
      const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
      await expect.poll(() => toggle.getAttribute('aria-busy')).toBe('false')
      expect(toggle.disabled).toBe(false)
      expect(toggle.getAttribute('data-tooltip')).toBe('Review comments')
      expect(f.api.notify.mock.calls).toEqual(status === 'failed' ? [['Delivery failed']] : [])
      // A duplicate terminal receipt or delayed acceptance cannot replace the final outcome.
      f.actionResult.value = { ...f.actionResult.value!, status: 'accepted' }
      await nextTick()
      expect(toggle.getAttribute('data-tooltip')).toBe('Review comments')
      expect((await f.store.request({ operation: 'load', scope })).comment).toBe(
        status === 'failed' ? feedback.comment : undefined
      )
      if (status === 'failed') {
        await openBatch()
        expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled).toBe(
          false
        )
        expect(document.querySelector<HTMLButtonElement>('.tp-feedback-send')!.disabled).toBe(false)
      }
      expect(f.send).toHaveBeenCalledOnce()
    }
  )

  it('unlocks on native admission and keeps a new batch busy when the old request resolves late', async () => {
    const f = fixture()
    const pending: ((result: DesignActionResult) => void)[] = []
    f.send.mockImplementation(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      return new Promise((resolve) => pending.push(resolve))
    })
    await writeComment('First queued batch')
    await sendBatch()
    await expect.poll(() => pending.length).toBe(1)
    const first = f.send.mock.calls[0]![0]
    await f.store.settle(first.id, 'delivered')
    f.actionResult.value = {
      requestId: first.id,
      taskId: 'task-a',
      status: 'delivered',
      message: 'Accepted by the native queue'
    }
    const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
    await expect.poll(() => toggle.getAttribute('aria-busy')).toBe('false')
    expect(toggle.disabled).toBe(false)
    await openBatch()
    await expect
      .poll(() => document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled)
      .toBe(false)
    await writeComment('Second queued batch')
    await sendBatch()
    await expect.poll(() => pending.length).toBe(2)
    const second = f.send.mock.calls[1]![0]
    expect(second.id).not.toBe(first.id)
    expect(second.comment).toBe('Second queued batch')
    pending[0]!({
      requestId: first.id,
      taskId: 'task-a',
      status: 'accepted',
      message: 'Late acceptance'
    })
    await nextTick()
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    expect(toggle.disabled).toBe(true)
    await f.store.settle(second.id, 'delivered')
    f.actionResult.value = {
      requestId: second.id,
      taskId: 'task-a',
      status: 'delivered',
      message: 'Queued'
    }
    await expect.poll(() => toggle.getAttribute('aria-busy')).toBe('false')
    pending[1]!({
      requestId: second.id,
      taskId: 'task-a',
      status: 'accepted',
      message: 'Late acceptance'
    })
    expect(f.send).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    'handles acceptance after a transport timeout with newer edits: %s',
    async (revised) => {
      const f = fixture()
      f.send.mockImplementationOnce(async (feedback) => {
        await f.store.recordSubmission(scope, feedback)
        throw new Error('Transport timed out')
      })
      await writeComment('Original guidance')
      await sendBatch()
      await expect.poll(() => f.api.notify.mock.calls).toEqual([['Transport timed out']])
      const feedback = f.send.mock.calls[0]![0]
      if (revised) {
        await writeComment('New guidance')
        await expect
          .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
          .toBe('New guidance')
      }
      f.actionResult.value = {
        requestId: feedback.id,
        taskId: 'task-a',
        status: 'accepted',
        message: 'Queued'
      }
      await nextTick()
      const toggle = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
      expect(toggle.disabled).toBe(false)
      expect(!!toggle.querySelector('.tp-feedback-spinner')).toBe(!revised)
      expect(toggle.getAttribute('data-tooltip')).toBe(
        revised ? 'Review comments' : 'Comments queued. Waiting for Codex App…'
      )
      expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled).toBe(
        !revised
      )
      await f.store.settle(feedback.id, 'delivered')
      f.actionResult.value = {
        requestId: feedback.id,
        taskId: 'task-a',
        status: 'delivered',
        message: 'Collected'
      }
      await expect
        .poll(() => document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')?.disabled)
        .toBe(false)
      expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.value).toBe(
        revised ? 'New guidance' : ''
      )
      expect((await f.store.request({ operation: 'load', scope })).comment).toBe(
        revised ? 'New guidance' : undefined
      )
      expect(f.send).toHaveBeenCalledOnce()
    }
  )

  it.each(['delivered', 'failed'] as const)(
    'keeps native Queue pending when an unrelated control receipt is %s',
    async (status) => {
      const f = fixture()
      f.task.value = {
        ...f.task.value,
        capabilities: {
          interrupt: false,
          queue: true,
          steer: false,
          continue: false,
          queueDelivery: 'native'
        }
      }
      acceptNextBatch(f)
      await save(f, 0, 'Keep the queued comment')
      await sendBatch()
      await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
      await openBatch()
      const original = f.send.mock.calls[0]![0]
      expect(page.getByRole('button', { name: 'Steer now' }).elements()).toEqual([])
      expect(document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!.disabled).toBe(false)
      expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled).toBe(
        true
      )
      f.actionResult.value = {
        requestId: 'old-steer-control',
        taskId: 'task-a',
        status,
        message: 'Unrelated result'
      }
      await nextTick()
      expect(f.send).toHaveBeenCalledOnce()
      expect(markers()).toHaveLength(1)
      expect((await f.store.request({ operation: 'load', scope })).submission?.id).toBe(original.id)
      expect(document.querySelector<HTMLButtonElement>('.tp-feedback-send')!.disabled).toBe(true)
      expect(f.api.notify).not.toHaveBeenCalled()
      await f.store.settle(original.id, 'delivered')
      f.actionResult.value = {
        requestId: original.id,
        taskId: 'task-a',
        status: 'delivered',
        message: 'Sent'
      }
      await expect.poll(() => markers().length).toBe(0)
    }
  )

  it('does not restore a pending batch after interruption beats acceptance', async () => {
    const f = fixture()
    let finish!: (result: DesignActionResult) => void
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    await writeComment('Retain interrupted guidance')
    await sendBatch()
    await expect.poll(() => typeof finish).toBe('function')
    const feedback = f.send.mock.calls[0]![0]
    f.task.value = { ...f.task.value, status: 'interrupted' }
    await nextTick()
    finish({ requestId: feedback.id, taskId: 'task-a', status: 'accepted', message: 'Queued' })
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    await openBatch()
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled).toBe(
      false
    )
    expect(page.getByRole('button', { name: 'Steer now' }).elements()).toEqual([])
    expect((await f.store.request({ operation: 'load', scope })).comment).toBe(feedback.comment)
  })

  it.each(
    (['paused', 'expired', 'completed', 'interrupted'] as const).flatMap((status) =>
      (['delivered', 'failed'] as const).map((receipt) => ({ status, receipt }))
    )
  )(
    'settles queued feedback with $receipt after the task becomes $status',
    async ({ status, receipt }) => {
      const f = fixture()
      acceptNextBatch(f)
      await save(f, 0, 'Preserve this revision')
      await sendBatch()
      await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
      f.task.value = { ...f.task.value, status }
      await nextTick()
      await openBatch()
      expect(document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!.disabled).toBe(false)
      expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.disabled).toBe(
        status !== 'interrupted'
      )
      if (status === 'completed')
        expect(document.querySelector<HTMLButtonElement>('.tp-design-done')!.disabled).toBe(true)
      const feedback = f.send.mock.calls[0]![0]
      await f.store.settle(feedback.id, receipt)
      f.actionResult.value = {
        requestId: feedback.id,
        taskId: 'task-a',
        status: receipt,
        message: receipt
      }
      await expect
        .poll(() => document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')?.disabled)
        .toBe(false)
      expect(markers()).toHaveLength(receipt === 'delivered' ? 0 : 1)
      expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(
        receipt === 'delivered' ? 0 : 1
      )
      if (status === 'completed')
        expect(document.querySelector<HTMLButtonElement>('.tp-design-done')!.disabled).toBe(false)
      expect(f.send).toHaveBeenCalledOnce()
    }
  )

  it('saves comments with Enter, expands on Shift+Enter, and only offers Delete after saving', async () => {
    await page.viewport(900, 700)
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    click('.tp-feedback-marker-add')
    await expect
      .element(page.getByRole('textbox', { name: 'Element comment', exact: true }))
      .toBeVisible()
    expect(document.querySelector('.tp-feedback-composer')).not.toBeNull()
    expect(document.activeElement).toBe(document.querySelector('#tp-element-feedback-text'))
    expect(document.querySelector('.tp-feedback-editor header')).toBeNull()
    await page.getByRole('textbox', { name: 'Element comment', exact: true }).fill('First line')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(document.querySelector('.tp-feedback-delete')).toBeNull()
    await userEvent.keyboard('Second line')
    await expect
      .poll(() => {
        const input = document.querySelector('#tp-element-feedback-text')!.getBoundingClientRect()
        return (
          document.querySelector('.tp-feedback-editor [type=submit]')!.getBoundingClientRect().top >
          input.bottom
        )
      })
      .toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'First line\nSecond line'
    )
    expect(f.send).not.toHaveBeenCalled()
    markers()[0]!.click()
    await expect.element(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Element comment', exact: true }).fill('Unsaved change')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'First line\nSecond line'
    )
    markers()[0]!.click()
    await expect
      .element(page.getByRole('textbox', { name: 'Element comment', exact: true }))
      .toHaveValue('First line\nSecond line')
  })

  it('hides only the edited badge and reuses the new comment position until the editor closes', async () => {
    const f = fixture()
    await save(f, 1, 'Keep the button')
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    const addPosition = document.querySelector('.tp-feedback-marker-add')!.getBoundingClientRect()
    click('.tp-feedback-marker-add')
    await expect
      .element(page.getByRole('textbox', { name: 'Element comment', exact: true }))
      .toBeVisible()
    const initial = document.querySelector('.tp-feedback-editor')!.getBoundingClientRect()
    expect(initial).toMatchObject({ x: addPosition.x, y: addPosition.y })
    expect(document.querySelector<HTMLElement>('.tp-feedback-marker-add')!.checkVisibility()).toBe(
      false
    )
    await page
      .getByRole('textbox', { name: 'Element comment', exact: true })
      .fill('Keep this heading')
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    const badge = page.getByRole('button', { name: 'Edit comment 2 for Heading', exact: true })
    await expect.element(badge).toBeVisible()
    expect(badge.element().getBoundingClientRect()).toMatchObject({
      x: addPosition.x,
      y: addPosition.y,
      width: 16,
      height: 16
    })
    expect(document.querySelector('.tp-feedback-marker-add')).toBeNull()
    await badge.click({ force: true })
    await expect
      .poll(() =>
        document
          .querySelector<HTMLElement>('[aria-label="Edit comment 2 for Heading"]')
          ?.checkVisibility()
      )
      .toBe(false)
    await expect
      .element(page.getByRole('button', { name: 'Edit comment 1 for Button', exact: true }))
      .toBeVisible()
    await expect
      .poll(() => {
        const edited = document.querySelector('.tp-feedback-editor')!.getBoundingClientRect()
        return { left: edited.left, top: edited.top }
      })
      .toEqual({ left: initial.left, top: initial.top })
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    await expect.element(badge).toBeVisible()
    expect(
      (await f.store.request({ operation: 'load', scope })).items.map((item) => item.text)
    ).toEqual(['Keep the button', 'Keep this heading'])
  })

  it('warns once before discarding an unsaved edit on outside click, and resets the warning after typing', async () => {
    await page.viewport(900, 700)
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    click('.tp-feedback-marker-add')
    await expect
      .element(page.getByRole('textbox', { name: 'Element comment', exact: true }))
      .toBeVisible()
    const outside = document.createElement('button')
    outside.textContent = 'Outside editor'
    Object.assign(outside.style, { position: 'fixed', left: '0', top: '0' })
    f.host.append(outside)
    await page.getByRole('button', { name: 'Outside editor', exact: true }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    click('.tp-feedback-marker-add')
    await page
      .getByRole('textbox', { name: 'Element comment', exact: true })
      .fill('Unsaved thought')
    await page.getByRole('button', { name: 'Outside editor', exact: true }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor-warned')).not.toBeNull()
    const editor = document.querySelector<HTMLElement>('.tp-feedback-editor')!
    expect(getComputedStyle(editor).transformOrigin.startsWith('24px ')).toBe(true)
    expect(getComputedStyle(editor).animationDuration).toBe('0.42s')
    expect(editor.textContent).not.toContain('Unsaved comment')
    await page
      .getByRole('textbox', { name: 'Element comment', exact: true })
      .fill('Revised thought')
    await expect.poll(() => document.querySelector('.tp-feedback-editor-warned')).toBeNull()
    await page.getByRole('button', { name: 'Outside editor', exact: true }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor-warned')).not.toBeNull()
    await page.getByRole('button', { name: 'Outside editor', exact: true }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    click('.tp-feedback-marker-add')
    await expect
      .element(page.getByRole('textbox', { name: 'Element comment', exact: true }))
      .toHaveValue('')
    expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(0)
    expect(f.send).not.toHaveBeenCalled()
  })

  it('replaces the entry in place and flips upward while keeping its corner attached', async () => {
    const f = fixture()
    const node = f.nodes[0]!
    node.absoluteBoundingBox.x = 151
    f.api.currentPage.selection = [node]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    click('.tp-feedback-marker-add')
    const popup = () => document.querySelector('.tp-feedback-editor')!.getBoundingClientRect()
    await expect.poll(() => ({ x: popup().x, y: popup().y })).toEqual({ x: 360, y: 128 })
    node.absoluteBoundingBox.y = 430
    await expect.poll(() => popup().bottom).toBe(494)
    expect(popup().left).toBe(360)
    await page
      .getByRole('textbox', { name: 'Element comment', exact: true })
      .fill('One\nTwo\nThree')
    await expect.poll(() => popup().height).toBeGreaterThan(100)
    await expect.poll(() => popup().bottom).toBe(494)
  })

  it('shifts the element popup inside the canvas while following its trigger, including an offscreen target', async () => {
    await page.viewport(900, 700)
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    click('.tp-feedback-marker-add')
    await page
      .getByRole('textbox', { name: 'Element comment', exact: true })
      .fill('Line one\nLine two\nLine three')
    const popup = () => document.querySelector('.tp-feedback-editor')!.getBoundingClientRect()
    await expect.poll(() => popup().height).toBeGreaterThan(100)
    const initial = popup()
    f.api.viewport.bounds.x = -240
    f.api.viewport.bounds.y = -280
    await expect.poll(() => popup().left).not.toBe(initial.left)
    await expect.poll(() => popup().top).toBeGreaterThan(initial.top)
    const inside = () => {
      const rect = popup()
      const canvas = f.canvas.getBoundingClientRect()
      return (
        rect.left >= canvas.left + 8 &&
        rect.top >= canvas.top + 8 &&
        rect.right <= canvas.right - 8 &&
        rect.bottom <= canvas.bottom - 8
      )
    }
    await expect.poll(inside).toBe(true)
    f.api.viewport.bounds.x = 1500
    f.api.viewport.bounds.y = 1500
    await expect.poll(() => popup().left).toBe(88)
    expect(inside()).toBe(true)
    f.canvas.style.width = '260px'
    f.canvas.style.height = '180px'
    await expect.poll(() => popup().width).toBe(244)
    await expect.poll(inside).toBe(true)
  })

  it('disables only empty sends and attempts the requested mode despite stale capabilities', async () => {
    const f = fixture()
    await openBatch()
    const button = () => document.querySelector<HTMLButtonElement>('.tp-feedback-send')!
    const assertDisabled = () => {
      expect(button().disabled).toBe(true)
      expect(button().querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(button().getAttribute('aria-label')).toBe('Queue comments')
    }
    assertDisabled()
    await userEvent.keyboard('{Meta>}')
    assertDisabled()
    await userEvent.keyboard('{Enter}{/Meta}')
    await writeComment('Preserve this guidance')
    f.task.value = {
      ...f.task.value,
      capabilities: { interrupt: false, queue: false, steer: true, continue: false }
    }
    await nextTick()
    expect(button().disabled).toBe(false)
    f.send.mockRejectedValueOnce(new Error('The agent connection is unavailable.'))
    button().click()
    await expect
      .poll(() => f.api.notify.mock.calls)
      .toEqual([['The agent connection is unavailable.']])
    expect(button().disabled).toBe(false)
    expect(button().getAttribute('data-tooltip')).not.toBe('Waiting for the agent connection…')
    const input = page.getByRole('textbox', { name: 'General comment' })
    await expect.element(input).toBeEnabled()
    ;(input.element() as HTMLTextAreaElement).focus()
    await userEvent.keyboard('{Meta>}')
    expect(button().disabled).toBe(false)
    expect(button().getAttribute('aria-label')).toBe('Steer now')
    await userEvent.keyboard('{Enter}{/Meta}')
    await expect.poll(() => f.send.mock.calls.length).toBe(2)
    expect(f.send.mock.calls.map(([feedback]) => feedback.mode)).toEqual(['queue', 'steer'])
  })

  it('keeps saved overall guidance accessible without a notification dot', async () => {
    const f = fixture()
    await expect.poll(() => document.querySelector('.tp-feedback-toggle')).not.toBeNull()
    const trigger = document.querySelector<HTMLElement>('.tp-feedback-toggle')!
    const width = trigger.offsetWidth
    await writeComment('Saved guidance')
    expect(trigger.offsetWidth).toBe(width)
    trigger.click()
    await nextTick()
    await openBatch()
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!.value).toBe(
      'Saved guidance'
    )
    expect(f.send).not.toHaveBeenCalled()
  })

  it.each(
    ['Meta', 'Control'].flatMap((modifier) =>
      ['click', 'Enter'].map((action) => ({ modifier, action }))
    )
  )(
    'steers guidance with $modifier+$action and keeps the arrow on release',
    async ({ modifier, action }) => {
      const f = fixture()
      f.send.mockImplementation(async (feedback) => {
        await f.store.recordSubmission(scope, feedback)
        return { requestId: feedback.id, taskId: 'task-a', status: 'accepted', message: 'Accepted' }
      })
      await writeComment('Make this change next')
      const input = document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!
      input.focus()
      const button = document.querySelector<HTMLButtonElement>('.tp-feedback-send')!
      expect(button.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(button.getAttribute('data-tooltip')).toBe('Queue comments')
      await userEvent.keyboard(`{${modifier}>}`)
      await expect.element(page.getByRole('button', { name: 'Steer now' })).toBeEnabled()
      expect(button.getAttribute('data-tooltip')).toBe('Steer now')
      expect(button.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24')
      if (action === 'click' && modifier === 'Control') {
        // macOS turns a native Ctrl-click into a context menu. Exercise the Windows
        // primary-click event here; native Windows input still needs host verification.
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
      } else if (action === 'click') {
        await page.getByRole('button', { name: 'Steer now' }).click()
      } else await userEvent.keyboard('{Enter}')
      await userEvent.keyboard(`{/${modifier}}`)
      await expect.poll(() => f.send.mock.calls.length).toBe(1)
      expect(f.send.mock.calls[0]![0]).toMatchObject({
        mode: 'steer',
        comment: 'Make this change next',
        items: []
      })
      await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
      await expect.element(page.getByText('Waiting for the agent…')).not.toBeInTheDocument()
      expect((await f.store.request({ operation: 'load', scope })).comment).toBe(
        'Make this change next'
      )
      f.actionResult.value = {
        requestId: f.send.mock.calls[0]![0].id,
        taskId: 'task-a',
        status: 'failed',
        message: 'Disconnected'
      }
      await openBatch()
      await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeVisible()
    }
  )

  it('queues an inline edit despite stale capabilities and allows a general-composer Steer after failure', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      capabilities: {
        interrupt: false,
        queue: false,
        steer: true,
        continue: false,
        queueDelivery: 'native'
      }
    }
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    click('.tp-feedback-marker-add')
    const input = page.getByRole('textbox', { name: 'Element comment', exact: true })
    await input.fill('Increase the heading size')
    await userEvent.keyboard('{Meta>}')
    await expect.element(page.getByRole('button', { name: 'Save & Queue' })).toBeEnabled()
    f.send.mockRejectedValueOnce(new Error('Queue is unavailable.'))
    await userEvent.keyboard('{Enter}{/Meta}')
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Queue is unavailable.']])
    expect(f.send.mock.calls[0]![0].mode).toBe('queue')
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Increase the heading size'
    )
    await openBatch()
    await userEvent.keyboard('{Meta>}')
    f.task.value = {
      ...f.task.value,
      capabilities: { interrupt: false, queue: false, steer: true, continue: false }
    }
    await expect.element(page.getByRole('button', { name: 'Steer now' })).toBeEnabled()
    await userEvent.keyboard('{Enter}{/Meta}')
    await expect.poll(() => f.send.mock.calls.length).toBe(2)
    expect(f.send.mock.calls[1]![0]).toMatchObject({
      mode: 'steer',
      items: [{ nodeId: 'node-0', text: 'Increase the heading size' }]
    })
  })

  it('saves the latest local edit after Stop and closes comment controls without sending', async () => {
    const f = fixture()
    await save(f, 0, 'Saved note')
    markers()[0]!.click()
    await page.getByRole('textbox', { name: 'Element comment', exact: true }).fill('Unsaved change')
    f.task.value = { ...f.task.value, status: 'cancelled' }
    await nextTick()
    expect(document.querySelector('.tp-design-done')).toBeNull()
    expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
    expect(document.querySelector('.tp-element-feedback')).toBeNull()
    await expect.poll(() => document.querySelector('.tp-design-overlay')).toBeNull()
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Unsaved change'
    )
    expect(f.send).not.toHaveBeenCalled()
  })

  it('ignores IME confirmation and queues overall guidance with Enter while Shift+Enter adds a line', async () => {
    const f = fixture()
    await writeComment('First line')
    const input = document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true
      })
    )
    await nextTick()
    expect(f.send).not.toHaveBeenCalled()
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.keyboard('Second line')
    await expect
      .poll(() => {
        const input = document.querySelector('#tp-feedback-comment')!.getBoundingClientRect()
        return (
          document.querySelector('.tp-feedback-send')!.getBoundingClientRect().top > input.bottom
        )
      })
      .toBe(true)
    expect(f.send).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    expect(f.send.mock.calls[0]![0]).toMatchObject({
      mode: 'queue',
      comment: 'First line\nSecond line',
      items: []
    })
  })

  it('automatically recovers a failed initial draft load without enabling edits over missing saved data', async () => {
    const storage = storageFixture()
    const get = vi
      .spyOn(storage, 'get')
      .mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
    const f = fixture(storage)
    await openBatch()
    await expect
      .element(page.getByText('Loading comments…', { exact: true }))
      .not.toBeInTheDocument()
    expect(f.api.notify).not.toHaveBeenCalled()
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toBeDisabled()
    await expect
      .element(page.getByRole('button', { name: 'Retry loading comments' }))
      .not.toBeInTheDocument()
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toBeEnabled()
    expect(get).toHaveBeenCalledTimes(2)
    expect(f.send).not.toHaveBeenCalled()
  })

  it('keeps automatic loading recovery out of errors and user repair controls when visibility changes', async () => {
    const storage = storageFixture()
    vi.spyOn(storage, 'get').mockRejectedValue(new Error('Storage unavailable'))
    const f = fixture(storage)
    await openBatch()
    expect(f.api.notify).not.toHaveBeenCalled()
    expect(document.querySelector('.tp-feedback-review [role="alert"]')).toBeNull()
    expect(document.querySelector('.tp-feedback-review')?.textContent).not.toContain(
      'Storage unavailable'
    )
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('data-tooltip'))
      .toBe('Review comments')
    for (const status of ['paused', 'completed', 'active'] as const) {
      f.task.value = { ...f.task.value, status }
      if (status === 'active') f.nodes[0]!.removed = true
      if (status === 'active')
        await expect.poll(() => document.querySelector('.tp-feedback-toggle')).toBeNull()
      else expect(f.api.notify).not.toHaveBeenCalled()
      expect(f.panel.querySelector('[role="alert"]')).toBeNull()
      expect(f.panel.textContent).not.toContain('Storage unavailable')
    }
    f.nodes[0]!.removed = false
    expect(f.api.notify).not.toHaveBeenCalled()
    expect(f.panel.querySelector('[role="alert"]')).toBeNull()
  })

  it('hides feedback without a client and disables it until a supported conversation is bound', async () => {
    const f = fixture()
    f.task.value = { ...f.task.value, client: undefined }
    await nextTick()
    expect(document.querySelector('.tp-feedback-toggle')).toBeNull()
    f.task.value = { ...f.task.value, client: { kind: 'codex-app', name: 'Codex' } }
    await nextTick()
    await expect
      .element(page.getByRole('button', { name: 'Review comments', exact: true }))
      .toBeDisabled()
  })

  it('keeps drafts and releases the pending state when the host fails to collect feedback', async () => {
    const f = fixture()
    f.send.mockImplementation(async (feedback) => ({
      requestId: feedback.id,
      taskId: f.task.value.taskId,
      status: 'accepted',
      message: 'Queued'
    }))
    await save(f, 0, 'Increase spacing')
    await sendBatch()
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('aria-busy'))
      .toBe('true')
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    await expect.element(page.getByText('Queued for the next response')).not.toBeInTheDocument()
    const feedback = f.send.mock.calls[0]![0]
    f.actionResult.value = {
      requestId: feedback.id,
      taskId: f.task.value.taskId,
      status: 'failed',
      message: 'The host disconnected. Drafts are retained.'
    }
    await expect
      .poll(() => f.api.notify.mock.calls)
      .toEqual([['The host disconnected. Drafts are retained.']])
    await openBatch()
    await expect
      .element(page.getByRole('button', { name: 'Queue comments', exact: true }))
      .toBeEnabled()
    expect(markers()).toHaveLength(1)
  })

  it('clips the fixed-width toolbar in a narrow canvas without rearranging its controls', async () => {
    const f = fixture()
    expect(document.querySelector('.tp-design-stop')?.textContent?.trim()).toBe('Stop')
    await save(f, 0, 'Check spacing')
    const bar = document.querySelector<HTMLElement>('.tp-design-feedback')!
    bar.getAnimations().forEach((animation) => animation.finish())
    const original = bar.getBoundingClientRect()
    for (const width of [200, 240, 360]) {
      f.canvas.style.width = `${width}px`
      await expect
        .poll(() => document.querySelector('.tp-design-overlay')!.getBoundingClientRect().width)
        .toBe(width)
      expect(bar.getBoundingClientRect()).toMatchObject({
        left: original.left,
        top: original.top,
        width: 360
      })
      const stop = document.querySelector('.tp-design-stop')!.getBoundingClientRect()
      const feedback = document.querySelector('.tp-feedback-toggle')!.getBoundingClientRect()
      expect(stop.left).toBeGreaterThanOrEqual(feedback.right)
      expect(stop.right).toBeGreaterThan(f.canvas.getBoundingClientRect().right)
    }
    f.canvas.style.width = '600px'
    await openBatch()
    expect(
      [...document.querySelectorAll('.tp-feedback-send')].map((button) =>
        button.getAttribute('aria-label')
      )
    ).toEqual(['Queue comments'])
    expect(document.querySelector('.tp-feedback-review select')).toBeNull()
  })

  it.each([true, false])(
    'offers only Queue before submission when Steer support is %s',
    async (steer) => {
      const f = fixture()
      f.task.value = {
        ...f.task.value,
        capabilities: { interrupt: false, queue: true, steer, continue: false }
      }
      await save(f, 0, 'Improve the heading')
      await openBatch()
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.tp-feedback-send')]
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Queue comments'])
      expect(buttons[0]!.getBoundingClientRect().height).toBe(24)
      expect(page.getByRole('button', { name: 'Steer now' }).elements()).toEqual([])
      buttons[0]!.click()
      await expect.poll(() => f.send.mock.calls.length).toBe(1)
      expect(f.send.mock.calls[0]![0].mode).toBe('queue')
    }
  )

  it('ignores legacy Continue capability and retains comments until delivery connects', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      capabilities: { interrupt: true, queue: false, steer: false, continue: true }
    }
    await save(f, 0, 'Keep this saved note')
    await openBatch()
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
    expect(page.getByRole('button', { name: /continue/i }).elements()).toEqual([])
    await expect
      .element(page.getByRole('button', { name: 'Copy comments' }))
      .not.toBeInTheDocument()
    expect(document.querySelector('.tp-feedback-review')?.textContent).toContain(
      'Keep this saved note'
    )
    expect(document.querySelector('.tp-design-stop')?.getAttribute('aria-label')).toBe(
      'Stop design task'
    )
    expect(f.send).not.toHaveBeenCalled()
  })

  it('starts guidance at one line and grows and shrinks with its content', async () => {
    const f = fixture()
    await save(f, 0, 'Check spacing')
    await openBatch()
    const input = document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')!
    expect(input.rows).toBe(1)
    expect(input.placeholder).toBe('Add a general comment…')
    expect(getComputedStyle(input).getPropertyValue('field-sizing')).toBe('content')
    expect(getComputedStyle(input).resize).toBe('none')
    const height = input.getBoundingClientRect().height
    expect(height).toBe(28)
    input.value = 'First change\nSecond change\nThird change'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => input.getBoundingClientRect().height).toBeGreaterThan(height)
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => input.getBoundingClientRect().height).toBe(height)
  })

  it('keeps a neutral icon without a zero count, and allows local notes without agent delivery', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      capabilities: { interrupt: false, queue: false, steer: false, continue: false }
    }
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.textContent?.trim())
      .toBe('')
    await save(f, 0, 'Retain this note')
    expect(f.send).not.toHaveBeenCalled()
    unmountAll()
    const reopened = fixture(f.storage)
    reopened.task.value = { ...reopened.task.value, capabilities: f.task.value.capabilities }
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.textContent)
      .toContain('1')
    await openBatch()
    expect(document.querySelector('.tp-feedback-review')?.textContent).toContain('Retain this note')
    expect(page.getByRole('button', { name: /continue/i }).elements()).toEqual([])
    await expect
      .element(page.getByRole('button', { name: 'Copy comments' }))
      .not.toBeInTheDocument()
    click('.tp-feedback-remove')
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.textContent?.trim())
      .toBe('')
    expect(document.querySelector('.tp-feedback-review')).not.toBeNull()
  })

  it('keeps Queue enabled as host capabilities change', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      capabilities: {
        interrupt: false,
        queue: false,
        steer: false,
        continue: false,
        reason: 'Native comment delivery is currently unavailable.'
      }
    }
    await save(f, 0, 'Keep the exact target')
    await openBatch()
    const continuation = page.getByRole('link', { name: 'Continue in Codex' })
    await expect.element(continuation).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
    expect(f.send).not.toHaveBeenCalled()
    expect((await f.store.request({ operation: 'load', scope })).items).toHaveLength(1)
    f.task.value = {
      ...f.task.value,
      status: 'active',
      capabilities: {
        interrupt: false,
        queue: true,
        steer: true,
        continue: false,
        queueDelivery: 'turn-end',
        steerDelivery: 'next-tool'
      }
    }
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
    await expect.element(continuation).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Queue comments' }).click()
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    expect(f.send.mock.calls[0]![0]).toMatchObject({
      mode: 'queue',
      items: [expect.objectContaining({ nodeId: f.nodes[0]!.id, text: 'Keep the exact target' })]
    })
  })

  it.each(['codex-app', 'codex'] as const)(
    'reports failed delivery for %s on click and retains comments without manual handoff',
    async (kind) => {
      const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      const f = fixture()
      f.task.value = {
        ...f.task.value,
        client: { kind, name: kind, sessionId: 'thread-a' },
        capabilities: { interrupt: false, queue: false, steer: false, continue: false }
      }
      await save(f, 0, 'Increase this heading')
      await writeComment('Make the whole design calmer')
      expect(page.getByRole('button', { name: /continue/i }).elements()).toEqual([])
      await expect
        .element(page.getByRole('button', { name: 'Copy comments' }))
        .not.toBeInTheDocument()
      await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
      ;(
        page.getByRole('textbox', { name: 'General comment' }).element() as HTMLTextAreaElement
      ).focus()
      f.send.mockRejectedValueOnce(new Error('Sending is unavailable.'))
      await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
      await expect.poll(() => f.api.notify.mock.calls).toEqual([['Sending is unavailable.']])
      expect(copied).not.toHaveBeenCalled()
      expect(f.send).toHaveBeenCalledOnce()
      await expect
        .poll(
          async () =>
            (await f.store.request({ operation: 'load', scope: { ...scope, clientKind: kind } }))
              .comment
        )
        .toBe('Make the whole design calmer')
      const saved = await f.store.request({
        operation: 'load',
        scope: { ...scope, clientKind: kind }
      })
      expect(saved.items).toHaveLength(1)
      expect(saved.comment).toBe('Make the whole design calmer')
      expect(saved.submission).toBeUndefined()
    }
  )

  it('prevents empty or unsaved element sends and never reuses another conversation draft', async () => {
    const f = fixture()
    await openBatch()
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeDisabled()
    await save(f, 0, 'Saved text')
    markers()[0]!.click()
    await page
      .getByRole('textbox', { name: 'Element comment', exact: true })
      .fill('Unsaved revision')
    // Open review directly to exercise the same guard used by buttons and keyboard submits.
    click('.tp-feedback-toggle')
    expect(document.querySelector('.tp-feedback-review')).toBeNull()
    expect(document.querySelector('.tp-feedback-editor')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await openBatch()
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeEnabled()
    f.task.value = { ...f.task.value, client: { ...f.task.value.client!, sessionId: 'thread-b' } }
    await nextTick()
    await openBatch()
    await expect.element(page.getByRole('button', { name: 'Queue comments' })).toBeDisabled()
    expect(document.querySelector('.tp-feedback-review')!.textContent).not.toContain('Saved text')
  })

  it('keeps a populated Save button enabled through a pending save and a storage failure', async () => {
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect.poll(() => document.querySelector('.tp-feedback-marker-add')).not.toBeNull()
    click('.tp-feedback-marker-add')
    const input = page.getByRole('textbox', { name: 'Element comment', exact: true })
    const saveButton = page.getByRole('button', { name: 'Save comment', exact: true })
    await expect.element(saveButton).toBeDisabled()
    await input.fill('   ')
    await expect.element(saveButton).toBeDisabled()
    await input.fill('Keep this draft')
    let failSave!: () => void
    f.requestDrafts.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failSave = () => reject(new Error('Could not save the comment.'))
        })
    )
    await expect.element(saveButton).toBeEnabled()
    await saveButton.click()
    await expect.poll(() => typeof failSave).toBe('function')
    await expect.element(saveButton).toBeEnabled()
    await saveButton.click()
    expect(
      f.requestDrafts.mock.calls.filter(([request]) => request.operation === 'save')
    ).toHaveLength(1)
    failSave()
    await expect.element(input).toBeEnabled()
    await expect.element(input).toHaveValue('Keep this draft')
    await expect.element(saveButton).toBeEnabled()
    expect(f.api.notify.mock.calls.at(-1)).toEqual(['Could not save the comment.'])
    await saveButton.click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Keep this draft'
    )
  })

  it('waits for guidance already saving and queues the latest edit only once', async () => {
    await page.viewport(900, 700)
    const f = fixture()
    await openBatch()
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toBeEnabled()
    let finishSave!: () => Promise<void>
    f.requestDrafts.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          finishSave = async () => resolve(await f.store.request(request))
        })
    )
    await writeComment('Initial guidance')
    await expect.poll(() => typeof finishSave).toBe('function')
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toBeEnabled()
    await writeComment('Edited while saving')
    const queue = page.getByRole('button', { name: 'Queue comments' })
    await expect.element(queue).toBeEnabled()
    await queue.click()
    await queue.click()
    expect(f.send).not.toHaveBeenCalled()
    await finishSave()
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    expect(f.send.mock.calls[0]![0]).toMatchObject({
      mode: 'queue',
      comment: 'Edited while saving',
      items: []
    })
  })

  it('sends overall guidance by itself and clears it only after delivered acknowledgement', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      status: 'active',
      capabilities: { interrupt: false, queue: true, steer: false, continue: false }
    }
    await openBatch()
    const send = () => document.querySelector<HTMLButtonElement>('.tp-feedback-send')!
    expect(send().disabled).toBe(true)
    expect(document.querySelector('.tp-feedback-toggle')?.textContent?.trim()).toBe('')
    await writeComment('Give the whole page more breathing room.')
    let delivered!: () => Promise<void>
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      return new Promise((resolve) => {
        delivered = async () => {
          await f.store.settle(feedback.id, 'delivered')
          resolve({
            requestId: feedback.id,
            taskId: 'task-a',
            status: 'delivered',
            message: 'Sent'
          })
        }
      })
    })
    await expect.poll(() => send().disabled).toBe(false)
    send().click()
    await expect.poll(() => typeof delivered).toBe('function')
    expect(send().disabled).toBe(false)
    send().click()
    expect(f.send).toHaveBeenCalledOnce()
    expect(f.send.mock.calls[0]?.[0]).toMatchObject({
      mode: 'queue',
      items: [],
      comment: 'Give the whole page more breathing room.'
    })
    f.task.value = { ...f.task.value, status: 'completed' }
    await nextTick()
    expect(document.querySelector<HTMLButtonElement>('.tp-design-done')!.disabled).toBe(true)
    expect((await f.store.request({ operation: 'load', scope })).comment).toBe(
      'Give the whole page more breathing room.'
    )
    await delivered()
    await expect
      .poll(() => document.querySelector<HTMLButtonElement>('.tp-design-done')!.disabled)
      .toBe(false)
    await expect
      .element(page.getByRole('button', { name: 'Review comments', exact: true }))
      .toBeVisible()
    expect(markers()).toHaveLength(0)
    expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [] })
  })

  it('waits for a pending autosave before Done clears and permits retry after a storage failure', async () => {
    const f = fixture()
    await openBatch()
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toBeEnabled()
    let finishSave!: () => Promise<void>
    f.requestDrafts.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          finishSave = async () => resolve(await f.store.request(request))
        })
    )
    await writeComment('Last guidance')
    await expect.poll(() => typeof finishSave).toBe('function')
    f.task.value = { ...f.task.value, status: 'completed' }
    await nextTick()
    const done = () => document.querySelector<HTMLButtonElement>('.tp-design-done')!
    expect(done().disabled).toBe(false)
    f.requestDrafts.mockRejectedValueOnce(new Error('Cannot clear local drafts'))
    done().click()
    await nextTick()
    expect(done().disabled).toBe(true)
    await finishSave()
    await expect.poll(() => done().disabled).toBe(false)
    expect(await f.store.request({ operation: 'load', scope })).toEqual({
      items: [],
      comment: 'Last guidance'
    })
    done().click()
    await expect.poll(() => document.querySelector('.tp-design-overlay')).toBeNull()
    expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [] })
    unmountAll()
    const reopened = fixture(f.storage)
    await openBatch()
    await expect.element(page.getByRole('textbox', { name: 'General comment' })).toHaveValue('')
    expect(await reopened.store.request({ operation: 'load', scope })).toEqual({ items: [] })
  })

  it('discards this round including unsaved edits when Done is clicked', async () => {
    await page.viewport(800, 600)
    const f = fixture()
    await save(f, 0, 'Saved note')
    await page.getByRole('button', { name: 'Edit comment 1 for Heading' }).click({ force: true })
    await page.getByRole('textbox', { name: 'Element comment', exact: true }).fill('Unsaved change')
    f.task.value = { ...f.task.value, status: 'completed' }
    await nextTick()
    const done = () => document.querySelector<HTMLButtonElement>('.tp-design-done')!
    expect(done().disabled).toBe(false)
    done().click()
    await expect.poll(() => document.querySelector('.tp-design-overlay')).toBeNull()
    expect(document.querySelector('.tp-element-feedback')).toBeNull()
    expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [] })
    expect(f.send).not.toHaveBeenCalled()
  })

  it('closes the headerless batch on outside click or Escape without losing drafts', async () => {
    const f = fixture()
    await save(f, 0, 'Keep this draft')
    const trigger = document.querySelector<HTMLButtonElement>('.tp-feedback-toggle')!
    trigger.focus()
    await openBatch()
    const dialog = document.querySelector<HTMLElement>('.tp-feedback-review')!
    await expect.poll(() => document.activeElement).toBe(dialog.querySelector('textarea'))
    expect(dialog.querySelector('header')).toBeNull()
    expect(dialog.querySelector('[aria-label="Close feedback batch"]')).toBeNull()
    const outside = document.createElement('button')
    outside.textContent = 'Outside canvas action'
    f.host.append(outside)
    Object.assign(outside.style, { position: 'fixed', left: '0', top: '0' })
    await page.getByRole('button', { name: 'Outside canvas action' }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    expect(document.activeElement).toBe(outside)
    await openBatch()
    expect(document.querySelector('.tp-feedback-review')?.textContent).toContain('Keep this draft')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('reviews and sends the whole batch from the canvas toolbar with saved semantic context', async () => {
    const f = fixture()
    f.nodes[0]!.type = 'TEXT'
    f.nodes[0]!.parent = {
      id: 'frame-1',
      type: 'FRAME',
      name: 'Desktop settings',
      parent: f.pageA
    } as unknown as typeof f.pageA
    await save(f, 0, 'Make this heading clearer')
    expect(f.panel.querySelectorAll('button')).toHaveLength(1)
    expect(f.panel.querySelector('.tp-feedback-toggle')).toBeNull()
    expect(document.querySelector('.tp-design-feedback .tp-feedback-toggle')).not.toBeNull()
    await writeComment('Keep the whole page compact.')
    expect(document.querySelector('.tp-feedback-review')?.textContent).not.toContain('Reload')
    expect(document.querySelector('.tp-feedback-review')?.textContent).not.toContain('· Codex')
    await expect
      .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
      .toBe('Keep the whole page compact.')
    expect(f.send).not.toHaveBeenCalled()
    const popup = document.querySelector('.tp-feedback-review')!.getBoundingClientRect()
    const canvas = f.canvas.getBoundingClientRect()
    expect(popup.left).toBeGreaterThanOrEqual(canvas.left)
    expect(popup.right).toBeLessThanOrEqual(canvas.right)
    expect(popup.top).toBeGreaterThanOrEqual(canvas.top)
    expect(popup.bottom).toBeLessThanOrEqual(canvas.bottom)
    const bar = document.querySelector('.tp-design-feedback')!.getBoundingClientRect()
    expect(popup.top - bar.bottom).toBe(8)
    expect(popup.right).toBe(bar.right)
    f.nodes[0]!.name = 'Renamed after saving'
    await sendBatch()
    await expect.poll(() => f.send.mock.calls.length).toBe(1)
    expect(f.send.mock.calls[0]![0]).toMatchObject({
      comment: 'Keep the whole page compact.',
      items: [
        {
          nodeId: 'node-0',
          nodeName: 'Heading',
          pageName: 'Settings',
          frame: { nodeId: 'frame-1', nodeName: 'Desktop settings' }
        }
      ]
    })
    await expect.poll(() => markers().length).toBe(0)
    expect((await f.store.request({ operation: 'load', scope })).comment).toBeUndefined()
  })

  it('retains unsaved element editing while its toolbar is hidden on another page', async () => {
    const f = fixture()
    await save(f, 0, 'Original heading')
    markers()[0]!.click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor textarea')).not.toBeNull()
    const input = document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')!
    input.value = 'Keep this unsaved edit'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    f.api.currentPage = f.pageB
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    f.api.currentPage = f.pageA
    await expect
      .poll(
        () => document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')?.value
      )
      .toBe('Keep this unsaved edit')
    expect(f.send).not.toHaveBeenCalled()
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Original heading'
    )
  })

  it('keeps revised overall guidance after a late delivery and restores it after reopening', async () => {
    const f = fixture()
    await save(f, 0, 'Original heading')
    await writeComment('Original overall guidance')
    await expect
      .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
      .toBe('Original overall guidance')
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      throw new Error('Waiting deadline elapsed')
    })
    await sendBatch()
    await expect.poll(() => document.querySelector('.tp-feedback-toggle')).not.toBeNull()
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('data-tooltip'))
      .toBe('Review comments')
    const sent = f.send.mock.calls[0]![0]
    await writeComment('New overall guidance')
    await expect
      .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
      .toBe('New overall guidance')
    await f.store.settle(sent.id, 'delivered')
    f.actionResult.value = {
      requestId: sent.id,
      taskId: 'task-a',
      status: 'delivered',
      message: 'Delivered late'
    }
    await expect.poll(() => markers().length).toBe(0)
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')?.value).toBe(
      'New overall guidance'
    )
    expect(document.querySelector('.tp-feedback-toggle')?.textContent?.trim()).toBe('')
    unmountAll()
    const reopened = fixture(f.storage, 'tab-reopened')
    await openBatch()
    await expect
      .poll(() => document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')?.value)
      .toBe('New overall guidance')
    expect(reopened.send).not.toHaveBeenCalled()
  })

  it('keeps overall guidance editable when local saving fails and permits an explicit retry', async () => {
    const f = fixture()
    await save(f, 0, 'Original heading')
    f.requestDrafts.mockRejectedValueOnce(new Error('Local storage unavailable'))
    await writeComment('Do not lose this overall guidance')
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Local storage unavailable']])
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')?.value).toBe(
      'Do not lose this overall guidance'
    )
    const retry = [
      ...document.querySelectorAll<HTMLButtonElement>('.tp-feedback-review button')
    ].find((button) => button.textContent?.includes('Retry saving'))!
    retry.click()
    await expect
      .poll(async () => (await f.store.request({ operation: 'load', scope })).comment)
      .toBe('Do not lose this overall guidance')
    expect(f.send).not.toHaveBeenCalled()
  })

  it('ignores a previous conversation guidance save after the new conversation has loaded', async () => {
    const f = fixture()
    await save(f, 0, 'Original heading')
    let release!: () => void
    f.requestDrafts.mockImplementationOnce(async (request) => {
      const snapshot = await f.store.request(request)
      return new Promise((resolve) => {
        release = () => resolve(snapshot)
      })
    })
    await writeComment('Original conversation guidance')
    await expect.poll(() => typeof release).toBe('function')
    f.task.value = { ...f.task.value, client: { ...f.task.value.client!, sessionId: 'thread-b' } }
    await nextTick()
    await writeComment('Replacement conversation guidance')
    const nextScope = { ...scope, conversationId: 'thread-b' }
    await expect
      .poll(async () => (await f.store.request({ operation: 'load', scope: nextScope })).comment)
      .toBe('Replacement conversation guidance')
    release()
    await nextTick()
    await nextTick()
    expect(document.querySelector<HTMLTextAreaElement>('#tp-feedback-comment')?.value).toBe(
      'Replacement conversation guidance'
    )
    expect((await f.store.request({ operation: 'load', scope })).comment).toBe(
      'Original conversation guidance'
    )
  })

  it('keeps a replacement conversation busy until its own save completes', async () => {
    const f = fixture()
    await save(f, 0, 'Original note')
    const edit = async (name: string, text: string) => {
      click(`[aria-label="${name}"]`)
      await expect.poll(() => document.querySelector('.tp-feedback-editor textarea')).not.toBeNull()
      const input = document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')!
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
    }
    const deferredSave = () => {
      let release!: () => void
      f.requestDrafts.mockImplementationOnce(async (request) => {
        const snapshot = await f.store.request(request)
        return new Promise((resolve) => {
          release = () => resolve(snapshot)
        })
      })
      click('.tp-feedback-editor [type="submit"]')
      return async () => {
        await expect.poll(() => typeof release).toBe('function')
        release()
      }
    }
    await edit('Edit comment 1 for Heading', 'Updated original note')
    const releaseOriginal = deferredSave()
    await expect
      .poll(
        () => document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')?.disabled
      )
      .toBe(true)
    f.task.value = { ...f.task.value, client: { ...f.task.value.client!, sessionId: 'thread-b' } }
    f.api.currentPage.selection = [f.nodes[1]!]
    await expect
      .poll(() => document.querySelector('[aria-label="Add comment to Button"]'))
      .not.toBeNull()
    await edit('Add comment to Button', 'Replacement conversation note')
    const releaseReplacement = deferredSave()
    await expect
      .poll(
        () => document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')?.disabled
      )
      .toBe(true)
    await releaseOriginal()
    await nextTick()
    await nextTick()
    expect(document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')?.value).toBe(
      'Replacement conversation note'
    )
    expect(
      document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')?.disabled
    ).toBe(true)
    await releaseReplacement()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    await expect.poll(() => markers().length).toBe(1)
    expect(markers()[0]?.getAttribute('aria-label')).toContain('Button')
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Updated original note'
    )
  })

  it('retains the editor after storage rejection and allows an explicit save retry', async () => {
    const f = fixture()
    f.api.currentPage.selection = [f.nodes[0]!]
    await expect
      .poll(() => document.querySelector('[aria-label="Add comment to Heading"]'))
      .not.toBeNull()
    click('[aria-label="Add comment to Heading"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor textarea')).not.toBeNull()
    const input = document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')!
    input.value = 'Keep my note'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    f.requestDrafts.mockRejectedValueOnce(new Error('Local storage unavailable'))
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Local storage unavailable']])
    expect(document.querySelector('.tp-feedback-editor [role="alert"]')).toBeNull()
    expect(input.value).toBe('Keep my note')
    expect(input.disabled).toBe(false)
    expect(markers()).toHaveLength(0)
    f.requestDrafts.mockRejectedValueOnce(new Error('Local storage unavailable'))
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => f.api.notify.mock.calls.length).toBe(2)
    expect(f.api.notify).toHaveBeenLastCalledWith('Local storage unavailable')
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Keep my note'
    )
    expect(f.send).not.toHaveBeenCalled()
  })

  it('ignores a previous conversation load after switching scope while preserving the new editor', async () => {
    const f = fixture()
    await save(f, 0, 'Original conversation')
    let release!: () => void
    f.requestDrafts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              items: [
                {
                  nodeId: 'node-0',
                  nodeName: 'Old conversation',
                  pageId: 'page-a',
                  text: 'Stale reply',
                  createdAt: 1000
                }
              ]
            })
        })
    )
    f.task.value = { ...f.task.value, client: { ...f.task.value.client!, sessionId: 'thread-b' } }
    await expect.poll(() => typeof release).toBe('function')
    f.task.value = { ...f.task.value, client: { ...f.task.value.client!, sessionId: 'thread-c' } }
    f.api.currentPage.selection = [f.nodes[1]!]
    await expect
      .poll(() => document.querySelector('[aria-label="Add comment to Button"]'))
      .not.toBeNull()
    click('[aria-label="Add comment to Button"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor textarea')).not.toBeNull()
    const input = document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')!
    input.value = 'Keep this new edit'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    release()
    await nextTick()
    await nextTick()
    expect(f.panel.querySelector('.tp-feedback-send')).toBeNull()
    expect(input.value).toBe('Keep this new edit')
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    expect(
      (
        await f.store.request({
          operation: 'load',
          scope: { ...scope, conversationId: 'thread-c' }
        })
      ).items[0]?.text
    ).toBe('Keep this new edit')
    expect((await f.store.request({ operation: 'load', scope })).items[0]?.text).toBe(
      'Original conversation'
    )
  })

  it('applies a late delivery receipt only to submitted revisions and keeps newer edits', async () => {
    const f = fixture()
    await save(f, 0, 'Original heading')
    await save(f, 1, 'Original button')
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      throw new Error('Waiting deadline elapsed')
    })
    await sendBatch()
    await expect.poll(() => document.querySelector('.tp-feedback-toggle')).not.toBeNull()
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('data-tooltip'))
      .toBe('Review comments')
    await openBatch()
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Waiting deadline elapsed']])
    const sent = f.send.mock.calls[0]![0]
    markers()[0]!.click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor textarea')).not.toBeNull()
    const input = document.querySelector<HTMLTextAreaElement>('.tp-feedback-editor textarea')!
    input.value = 'Revised heading'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await page.getByRole('button', { name: 'Review 2 comments' }).click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor-warned')).not.toBeNull()
    await expect.poll(() => document.querySelector('.tp-feedback-review')).toBeNull()
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    await f.store.settle(sent.id, 'delivered')
    f.actionResult.value = {
      requestId: sent.id,
      taskId: 'task-a',
      status: 'delivered',
      message: 'Delivered late'
    }
    await expect
      .poll(
        () =>
          markers().filter((marker) => marker.classList.contains('tp-feedback-marker-sent')).length
      )
      .toBe(1)
    expect(markers()[0]!.classList.contains('tp-feedback-marker-sent')).toBe(false)
    await expect.poll(() => markers().length).toBe(1)
    expect(document.querySelector('.tp-feedback-review [role="alert"]')).toBeNull()
    expect(document.querySelector('.tp-feedback-toggle')?.textContent?.trim()).toBe('1')
    f.nodes[0]!.visible = false
    await expect.poll(() => markers().length).toBe(0)
    f.nodes[0]!.visible = true
    await expect.poll(() => markers().length).toBe(1)
    expect(
      (await f.store.request({ operation: 'load', scope })).items.map((item) => item.text)
    ).toEqual(['Revised heading'])
  })

  it('saves per element without sending, renumbers deletion, and fades the whole batch only after delivery', async () => {
    const f = fixture()
    await save(f, 0, 'More spacing')
    await save(f, 1, 'Increase contrast')
    await save(f, 2, 'Align the footer')
    expect(f.send).not.toHaveBeenCalled()
    await expect.poll(() => markers().map((marker) => marker.textContent)).toEqual(['1', '2', '3'])
    markers()[0]!.click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).not.toBeNull()
    click('.tp-feedback-delete')
    await expect.poll(() => markers().map((marker) => marker.textContent)).toEqual(['1', '2'])
    expect(markers()[0]!.getAttribute('aria-label')).toContain('Button')
    let finish!: () => Promise<void>
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      return new Promise((resolve) => {
        finish = async () => {
          await f.store.settle(feedback.id, 'delivered')
          resolve({
            requestId: feedback.id,
            taskId: 'task-a',
            status: 'delivered',
            message: 'Sent'
          })
        }
      })
    })
    f.api.currentPage.selection = [f.nodes[0]!]
    await sendBatch()
    await expect.poll(() => typeof finish).toBe('function')
    expect(f.send.mock.calls[0]![0]).toMatchObject({
      mode: 'queue',
      items: [
        { nodeId: 'node-1', text: 'Increase contrast' },
        { nodeId: 'node-2', text: 'Align the footer' }
      ]
    })
    expect(markers()).toHaveLength(2)
    expect(markers().every((marker) => !marker.classList.contains('tp-feedback-marker-sent'))).toBe(
      true
    )
    await finish()
    await expect
      .poll(() => markers().every((marker) => marker.classList.contains('tp-feedback-marker-sent')))
      .toBe(true)
    expect(getComputedStyle(markers()[0]!).transitionProperty).toContain('transform')
    expect(getComputedStyle(markers()[0]!).transitionProperty).toContain('opacity')
    await expect.poll(() => markers().length).toBe(0)
    expect((await f.store.request({ operation: 'load', scope })).items).toEqual([])
  })

  it('keeps drafts across pages and a reopened tab, including unavailable elements that can be deleted', async () => {
    const f = fixture()
    await save(f, 0, 'First page note')
    f.nodes[1]!.parent = f.pageB
    await save(f, 1, 'Second page note')
    await expect.poll(() => markers().map((marker) => marker.textContent)).toEqual(['2'])
    const storage = f.storage
    unmountAll()
    const reopened = fixture(storage, 'tab-reopened')
    reopened.nodes[1]!.parent = reopened.pageB
    reopened.nodes[0]!.removed = true
    reopened.anchor.value = reopened.nodes[2] as unknown as SceneNode
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.textContent?.trim())
      .toBe('2')
    expect(reopened.send).not.toHaveBeenCalled()
    await openBatch()
    expect(document.querySelector('.tp-feedback-review')?.textContent).toContain(
      'Element unavailable'
    )
    expect(document.querySelector('.tp-feedback-review')?.textContent).toContain('First page note')
    document.querySelector<HTMLButtonElement>('[aria-label="Delete comment 1"]')!.click()
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.textContent?.trim())
      .toBe('1')
    reopened.api.currentPage = reopened.pageB
    await expect.poll(() => markers().map((marker) => marker.textContent)).toEqual(['1'])
    expect(markers()[0]!.getAttribute('aria-label')).toContain('Button')
    reopened.api.fileKey = 'different-file'
    await expect.poll(() => document.querySelector('.tp-element-feedback')).toBeNull()
    expect((await reopened.store.request({ operation: 'load', scope })).items).toHaveLength(1)
  })

  it('retains a failed batch and its delivery identity without coloring the review entry red', async () => {
    const f = fixture()
    f.task.value = {
      ...f.task.value,
      capabilities: { interrupt: false, queue: false, continue: false, steer: false }
    }
    f.api.currentPage.selection = [f.nodes[0]!]
    await nextTick()
    await expect.poll(() => document.querySelector('.tp-feedback-marker')).not.toBeNull()
    f.task.value = {
      ...f.task.value,
      capabilities: { interrupt: false, queue: true, continue: false, steer: true }
    }
    await save(f, 0, 'Use a larger heading')
    expect(document.querySelector('.tp-feedback-toggle')?.textContent?.trim()).toBe('1')
    f.send.mockImplementationOnce(async (feedback) => {
      await f.store.recordSubmission(scope, feedback)
      await f.store.settle(feedback.id, 'failed')
      const result = {
        requestId: feedback.id,
        taskId: 'task-a',
        status: 'failed',
        message: 'Delivery was not acknowledged'
      } as const
      f.actionResult.value = result
      return result
    })
    await sendBatch()
    await expect.poll(() => document.querySelector('.tp-feedback-toggle')).not.toBeNull()
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('data-tooltip'))
      .toBe('Review comments')
    await openBatch()
    await expect.poll(() => f.api.notify.mock.calls).toEqual([['Delivery was not acknowledged']])
    expect(markers()).toHaveLength(1)
    const previous = f.send.mock.calls[0]![0]
    markers()[0]!.click()
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).not.toBeNull()
    click('.tp-feedback-editor [type="submit"]')
    await expect.poll(() => document.querySelector('.tp-feedback-editor')).toBeNull()
    expect((await f.store.request({ operation: 'load', scope })).submission?.id).toBe(previous.id)
    unmountAll()
    const reopened = fixture(f.storage, 'tab-reopened')
    await expect.poll(() => document.querySelector('.tp-feedback-toggle')).not.toBeNull()
    await expect
      .poll(() => document.querySelector('.tp-feedback-toggle')?.getAttribute('data-tooltip'))
      .toBe('Review comments')
    await openBatch()
    await expect.poll(() => reopened.api.notify.mock.calls).toEqual([['Sending not confirmed.']])
    expect(reopened.send).not.toHaveBeenCalled()
    click('[aria-label="Queue comments"]')
    await expect.poll(() => reopened.send.mock.calls.length).toBe(1)
    expect(reopened.send.mock.calls[0]![0].id).toBe(previous.id)
  })
})
