import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

vi.mock('@/utils/codegen', async (original) => ({
  ...(await original<typeof import('@/utils/codegen')>()),
  generateCodeBlocksForNode: vi.fn()
}))

import CodeSection from '@/components/sections/CodeSection.vue'
import { syncSelection, useSelection } from '@/composables/selection'
import { layoutReady, runtimeMode, selection, selectionRevision } from '@/ui/state'
import { generateCodeBlocksForNode } from '@/utils/codegen'

import { mount, unmountAll } from './mount'

function events() {
  const callbacks = new Map<string, Set<() => void>>()
  return {
    on: vi.fn((type: string, callback: () => void) => {
      if (!callbacks.has(type)) callbacks.set(type, new Set())
      callbacks.get(type)!.add(callback)
    }),
    off: vi.fn((type: string, callback: () => void) => callbacks.get(type)?.delete(callback)),
    emit: (type: string) => callbacks.get(type)?.forEach((callback) => callback()),
    count: () => [...callbacks.values()].reduce((sum, listeners) => sum + listeners.size, 0)
  }
}

function fixture() {
  const node = { id: 'selected', width: 100, characters: 'Before' }
  const page = { ...events(), selection: [node] }
  const api = { ...events(), fileKey: 'selection-code', currentPage: page }
  vi.stubGlobal('figma', api)
  const canvasRoot = document.createElement('div')
  canvasRoot.id = 'fullscreen-root'
  const canvasView = document.createElement('div')
  canvasView.className = 'gpu-view-content'
  const canvas = document.createElement('canvas')
  canvasView.append(canvas)
  canvasRoot.append(canvasView)
  document.body.append(canvasRoot)
  return { node, page, api, canvas }
}

const View = defineComponent({
  setup() {
    useSelection()
    return () => h(CodeSection)
  }
})

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  layoutReady.value = true
  runtimeMode.value = 'standard'
  vi.mocked(generateCodeBlocksForNode).mockImplementation(async (node) => ({
    codeBlocks: [
      {
        name: 'css',
        title: 'CSS',
        lang: 'css',
        code: `width: ${node.width}px; text: ${(node as TextNode).characters}`
      }
    ]
  }))
})

afterEach(() => {
  unmountAll()
  layoutReady.value = false
  selection.value = []
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.useRealTimers()
})

it('reads the initial selection when the Figma layout becomes ready after mounting', async () => {
  fixture()
  layoutReady.value = false
  const host = mount(View)
  expect(generateCodeBlocksForNode).not.toHaveBeenCalled()
  layoutReady.value = true
  await expect.poll(() => host.textContent).toContain('width: 100px; text: Before')
  expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
})

it('regenerates the same selected node after explicit sync and current-page edits', async () => {
  const { node, page } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px; text: Before')
  const selected = selection.value
  node.width = 200
  syncSelection()
  await expect.poll(() => host.textContent).toContain('width: 200px; text: Before')
  expect(selection.value).toBe(selected)

  node.characters = 'After'
  page.emit('nodechange')
  await expect.poll(() => host.textContent).toContain('width: 200px; text: After')
  expect(selection.value).toBe(selected)
})

it('refreshes after inspector edits and window focus without reacting to TemPad inputs', async () => {
  const { node } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  const editor = document.createElement('input')
  document.body.append(editor)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  node.width = 200
  await expect.poll(() => host.textContent).toContain('width: 200px')

  const count = vi.mocked(generateCodeBlocksForNode).mock.calls.length
  const panel = document.createElement('tempad')
  const pluginInput = document.createElement('input')
  panel.append(pluginInput)
  document.body.append(panel)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  pluginInput.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.advanceTimersByTimeAsync(150)
  expect(generateCodeBlocksForNode).toHaveBeenCalledTimes(count)
  vi.useRealTimers()

  window.dispatchEvent(new FocusEvent('blur'))
  await nextTick()
  node.width = 300
  window.dispatchEvent(new FocusEvent('focus'))
  await expect.poll(() => host.textContent).toContain('width: 300px')
})

it('rebinds native listeners on page changes and removes them when inactive or unmounted', async () => {
  const { api, page, node } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  expect(page.count()).toBe(1)
  const nextPage = { ...events(), selection: [node] }
  api.currentPage = nextPage
  api.emit('currentpagechange')
  await expect.poll(() => nextPage.count()).toBe(1)
  expect(page.count()).toBe(0)

  runtimeMode.value = 'unavailable'
  await nextTick()
  expect(api.count()).toBe(0)
  expect(nextPage.count()).toBe(0)
  runtimeMode.value = 'standard'
  await expect.poll(() => nextPage.count()).toBe(1)
  unmountAll()
  expect(api.count()).toBe(0)
  expect(nextPage.count()).toBe(0)
})

it('falls back to post-event refresh when native subscriptions are unavailable', async () => {
  const { api, node, canvas } = fixture()
  api.on.mockImplementation(() => {
    throw new Error('Unsupported event API')
  })
  api.currentPage.on.mockImplementation(() => {
    throw new Error('Unsupported page events')
  })
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  node.width = 400
  await expect.poll(() => host.textContent).toContain('width: 400px')
})

it('cleans up old page subscriptions when the native page becomes unavailable', async () => {
  const { api, page, canvas } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  Object.defineProperty(api, 'currentPage', {
    configurable: true,
    get: () => {
      throw new Error('Native page is unavailable')
    }
  })
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  await expect.poll(() => selection.value.length).toBe(0)
  expect(page.count()).toBe(0)
  Object.defineProperty(api, 'currentPage', { configurable: true, value: page })
  api.emit('currentpagechange')
  await expect.poll(() => host.textContent).toContain('width: 100px')
})

it('refreshes cached TemPad component metadata without changing the selection', async () => {
  const { node, page } = fixture()
  let component = 'OriginalButton'
  Object.assign(node, {
    type: 'FRAME',
    name: '🧩 Button',
    getSharedPluginData: (_namespace: string, key: string) => {
      if (key === 'code') return `<>\n<Stack>\n  <${component} />\n</Stack>\n</>`
      if (key === 'link') return 'https://example.com/playground'
      return ''
    }
  })
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('<OriginalButton />')
  component = 'UpdatedButton'
  page.emit('nodechange')
  await expect.poll(() => host.textContent).toContain('<UpdatedButton />')
})

it('coalesces native changes and defers background updates until focus returns', async () => {
  const { node, page, api } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  node.width = 200
  page.emit('nodechange')
  api.emit('stylechange')
  api.emit('selectionchange')
  await vi.advanceTimersByTimeAsync(99)
  expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(host.textContent).toContain('width: 200px')
  expect(generateCodeBlocksForNode).toHaveBeenCalledTimes(2)

  window.dispatchEvent(new FocusEvent('blur'))
  await nextTick()
  node.width = 300
  page.emit('nodechange')
  await vi.advanceTimersByTimeAsync(200)
  expect(generateCodeBlocksForNode).toHaveBeenCalledTimes(2)
  window.dispatchEvent(new FocusEvent('focus'))
  await nextTick()
  await nextTick()
  expect(host.textContent).toContain('width: 300px')
})

it('fences surviving native callbacks when listener cleanup fails on unmount', async () => {
  const { page } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  page.off.mockImplementation(() => {
    throw new Error('Native listener removal failed')
  })
  unmountAll()
  const revision = selectionRevision.value
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  page.emit('nodechange')
  await vi.advanceTimersByTimeAsync(200)
  expect(selectionRevision.value).toBe(revision)
})
