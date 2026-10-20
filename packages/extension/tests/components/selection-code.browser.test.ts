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
  const callbacks = new Map<string, Set<(event?: unknown) => void>>()
  return {
    on: vi.fn((type: string, callback: (event?: unknown) => void) => {
      if (!callbacks.has(type)) callbacks.set(type, new Set())
      callbacks.get(type)!.add(callback)
    }),
    off: vi.fn((type: string, callback: (event?: unknown) => void) =>
      callbacks.get(type)?.delete(callback)
    ),
    emit: (type: string, event?: unknown) =>
      callbacks.get(type)?.forEach((callback) => callback(event)),
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

it('ignores unrelated changes and no-op interactions when native events are available', async () => {
  const { page, api, canvas } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  const code = host.querySelector('.tp-code-code')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  for (const origin of ['LOCAL', 'REMOTE']) {
    page.emit('nodechange', {
      nodeChanges: [
        {
          id: 'unrelated',
          node: { id: 'unrelated' },
          type: 'PROPERTY_CHANGE',
          origin,
          properties: ['name']
        }
      ]
    })
    await vi.advanceTimersByTimeAsync(120)
  }
  api.emit('stylechange', { styleChanges: [{ id: 'unrelated-style' }] })
  await vi.advanceTimersByTimeAsync(120)
  for (let index = 0; index < 3; index++) {
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }))
    api.emit('selectionchange')
    await vi.advanceTimersByTimeAsync(120)
  }
  expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
  expect(host.querySelector('.tp-code-code')).toBe(code)
})

it('does not treat focus-target shortcuts or inspector navigation as content edits', async () => {
  const { node } = fixture()
  const children = vi.fn(() => [])
  Object.defineProperty(node, 'children', { get: children })
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  const traversals = children.mock.calls.length
  const canvasInput = document.createElement('textarea')
  canvasInput.className = 'focus-target'
  const inspectorInput = document.createElement('input')
  document.body.append(canvasInput, inspectorInput)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  for (const target of [canvasInput, inspectorInput]) {
    for (const keys of [
      { key: 'ArrowLeft' },
      { key: 'v' },
      { key: 'c', metaKey: true },
      { key: 'c', ctrlKey: true }
    ]) {
      target.dispatchEvent(new KeyboardEvent('keyup', { ...keys, bubbles: true }))
      await vi.advanceTimersByTimeAsync(120)
    }
  }
  canvasInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  await vi.advanceTimersByTimeAsync(120)
  expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
  expect(children).toHaveBeenCalledTimes(traversals)

  node.width = 200
  canvasInput.dispatchEvent(new InputEvent('input', { data: 'a', bubbles: true }))
  await vi.advanceTimersByTimeAsync(120)
  expect(host.textContent).toContain('width: 200px')
})

it('refreshes linked style changes and selected instance definition metadata', async () => {
  const { node, api, page } = fixture()
  const mainComponent = { id: 'definition' }
  Object.assign(node, { type: 'INSTANCE', mainComponent, fillStyleId: 'fill-style' })
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  node.width = 200
  api.emit('stylechange', { styleChanges: [{ id: 'fill-style' }] })
  await vi.advanceTimersByTimeAsync(100)
  expect(host.textContent).toContain('width: 200px')
  node.width = 300
  page.emit('nodechange', {
    nodeChanges: [
      {
        id: mainComponent.id,
        node: mainComponent,
        type: 'PROPERTY_CHANGE',
        origin: 'REMOTE',
        properties: ['name']
      }
    ]
  })
  await vi.advanceTimersByTimeAsync(100)
  expect(host.textContent).toContain('width: 300px')
})

it.each(['instance', 'instance-child', 'variant-set'] as const)(
  'refreshes %s dependencies on accessible component pages and cleans up their listeners',
  async (selected) => {
    const { node, api, page } = fixture()
    const library = { ...events(), id: 'library-page', type: 'PAGE', parent: null }
    const variants = { id: 'variants', type: 'COMPONENT_SET', parent: library }
    const definition = { id: 'definition', type: 'COMPONENT', parent: variants }
    const text = { id: 'definition-text', type: 'TEXT', parent: definition }
    Object.assign(definition, { children: [text] })
    if (selected === 'instance-child') {
      Object.assign(node, {
        parent: { id: 'instance', type: 'INSTANCE', mainComponent: definition, parent: page }
      })
    } else {
      Object.assign(node, { type: 'INSTANCE', mainComponent: definition, parent: page })
    }
    const host = mount(View)
    await expect.poll(() => host.textContent).toContain('width: 100px')
    const changed = selected === 'variant-set' ? variants : text
    node.width = 200
    library.emit('nodechange', {
      nodeChanges: [
        {
          id: changed.id,
          node: changed,
          type: 'PROPERTY_CHANGE',
          origin: 'REMOTE',
          properties: ['characters']
        }
      ]
    })
    await expect.poll(() => host.textContent).toContain('width: 200px')
    expect(library.count()).toBe(1)

    runtimeMode.value = 'unavailable'
    await nextTick()
    selectionRevision.value++
    await nextTick()
    expect(library.count()).toBe(0)
    runtimeMode.value = 'standard'
    await expect.poll(() => library.count()).toBe(1)

    page.selection = [{ id: 'other', width: 300, characters: 'Other' }]
    api.emit('selectionchange')
    await expect.poll(() => host.textContent).toContain('width: 300px')
    expect(library.count()).toBe(0)
    unmountAll()
    expect(page.count()).toBe(0)
  }
)

it('refreshes new and removed descendants of main components without retaining obsolete dependencies', async () => {
  const { node, page } = fixture()
  const definition = { id: 'definition', type: 'COMPONENT', children: [] as object[] }
  Object.assign(node, { type: 'INSTANCE', mainComponent: definition })
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  const child = { id: 'new-definition-child', parent: definition }
  definition.children = [child]
  node.width = 200
  page.emit('nodechange', {
    nodeChanges: [{ id: child.id, node: child, type: 'CREATE', origin: 'REMOTE' }]
  })
  await expect.poll(() => host.textContent).toContain('width: 200px')
  definition.children = []
  node.width = 300
  page.emit('nodechange', {
    nodeChanges: [
      { id: child.id, node: { id: child.id, removed: true }, type: 'DELETE', origin: 'REMOTE' }
    ]
  })
  await expect.poll(() => host.textContent).toContain('width: 300px')
})

it('refreshes actual editor input without native node events while ignoring TemPad inputs', async () => {
  const { node } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  const editor = document.createElement('input')
  document.body.append(editor)
  for (const event of ['input', 'change', 'keyup']) {
    node.width += 100
    editor.dispatchEvent(
      event === 'keyup'
        ? new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
        : new Event(event, { bubbles: true })
    )
    await expect.poll(() => host.textContent).toContain(`width: ${node.width}px`)
  }
  const panel = document.createElement('tempad')
  panel.append(editor)
  document.body.append(panel)
  node.width = 900
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.advanceTimersByTimeAsync(150)
  expect(host.textContent).toContain('width: 400px')
})

it('does not traverse hidden code dependencies for a multiple selection', async () => {
  const { node, page, api } = fixture()
  const children = vi.fn(() => [])
  Object.defineProperty(node, 'children', { get: children })
  page.selection = [node, { id: 'second', width: 200, characters: 'Other' }]
  const host = mount(View)
  await nextTick()
  expect(children).not.toHaveBeenCalled()
  expect(generateCodeBlocksForNode).not.toHaveBeenCalled()
  syncSelection()
  await nextTick()
  expect(children).not.toHaveBeenCalled()
  page.selection = [node]
  api.emit('selectionchange')
  await expect.poll(() => host.textContent).toContain('width: 100px')
  expect(children).toHaveBeenCalled()
})

it.each(['textStyleId', 'fillStyleId'] as const)(
  'refreshes styles referenced by mixed text ranges through %s',
  async (field) => {
    const { node, api } = fixture()
    Object.assign(node, {
      type: 'TEXT',
      [field]: Symbol('mixed'),
      getStyledTextSegments: () => [{ [field]: 'range-style' }]
    })
    const host = mount(View)
    await expect.poll(() => host.textContent).toContain('width: 100px')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    node.width = 200
    api.emit('stylechange', { styleChanges: [{ id: 'other-range-style' }] })
    await vi.advanceTimersByTimeAsync(100)
    expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
    api.emit('stylechange', { styleChanges: [{ id: 'range-style' }] })
    await vi.advanceTimersByTimeAsync(100)
    expect(host.textContent).toContain('width: 200px')
  }
)

it('drops a pending content invalidation once focus recovery has refreshed it', async () => {
  const { node, page, api } = fixture()
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  node.width = 200
  page.emit('nodechange')
  window.dispatchEvent(new FocusEvent('blur'))
  await nextTick()
  await vi.advanceTimersByTimeAsync(200)
  expect(generateCodeBlocksForNode).toHaveBeenCalledOnce()
  window.dispatchEvent(new FocusEvent('focus'))
  await nextTick()
  await nextTick()
  expect(host.textContent).toContain('width: 200px')
  api.emit('selectionchange')
  await vi.advanceTimersByTimeAsync(100)
  expect(generateCodeBlocksForNode).toHaveBeenCalledTimes(2)
})

it('refreshes relevant remote ancestors and descendants, including removed and newly added children', async () => {
  const { node, page } = fixture()
  const parent = { id: 'parent', parent: null }
  const child = { id: 'child', parent: node }
  Object.assign(node, { parent, children: [child] })
  const host = mount(View)
  await expect.poll(() => host.textContent).toContain('width: 100px')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  for (const changed of [node, parent, child]) {
    node.width += 10
    page.emit('nodechange', {
      nodeChanges: [
        {
          id: changed.id,
          node: changed,
          type: 'PROPERTY_CHANGE',
          origin: 'REMOTE',
          properties: ['width']
        }
      ]
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(host.textContent).toContain(`width: ${node.width}px`)
  }
  Object.assign(node, { children: [] })
  node.width += 10
  page.emit('nodechange', {
    nodeChanges: [
      { id: child.id, node: { id: child.id, removed: true }, type: 'DELETE', origin: 'REMOTE' }
    ]
  })
  await vi.advanceTimersByTimeAsync(100)
  expect(host.textContent).toContain(`width: ${node.width}px`)
  const added = { id: 'added', parent: node }
  Object.assign(node, { children: [added] })
  node.width += 10
  page.emit('nodechange', {
    nodeChanges: [{ id: added.id, node: added, type: 'CREATE', origin: 'REMOTE' }]
  })
  await vi.advanceTimersByTimeAsync(100)
  expect(host.textContent).toContain(`width: ${node.width}px`)
  expect(generateCodeBlocksForNode).toHaveBeenCalledTimes(6)
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
  const { node, page } = fixture()
  page.on.mockImplementation(() => {
    throw new Error('Native node events unavailable')
  })
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
