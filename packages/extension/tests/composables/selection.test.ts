import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RefLike<T> = { value: T }

const mocks = vi.hoisted(() => ({
  layoutReady: { value: false } as RefLike<boolean>,
  runtimeMode: { value: 'standard' } as RefLike<'standard' | 'unavailable'>,
  selection: { value: [] as SceneNode[] } as RefLike<readonly SceneNode[]>,
  visibility: { value: 'visible' } as RefLike<'visible' | 'hidden'>,
  focused: { value: true } as RefLike<boolean>,
  getCanvas: vi.fn(),
  getLeftPanel: vi.fn(),
  listeners: [] as Array<{ target: unknown; event: string; handler: (...args: unknown[]) => void }>,
  watchers: [] as Array<{ source: unknown; callback: (value: unknown) => void }>
}))

function resolveWatchSource(source: unknown) {
  if (typeof source === 'function') {
    return (source as () => unknown)()
  }
  if (Array.isArray(source)) {
    return source.map((entry) => {
      if (entry && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)) {
        return (entry as RefLike<unknown>).value
      }
      if (typeof entry === 'function') {
        return (entry as () => unknown)()
      }
      return entry
    })
  }
  if (source && typeof source === 'object' && 'value' in (source as Record<string, unknown>)) {
    return (source as RefLike<unknown>).value
  }
  return source
}

vi.mock('vue', () => ({
  computed: (getter: () => unknown) => ({
    get value() {
      return getter()
    }
  }),
  shallowRef: <T>(value: T) => ({ value }),
  watch: (
    source: unknown,
    callback: (value: unknown) => void,
    options?: { immediate?: boolean }
  ) => {
    mocks.watchers.push({ source, callback })
    if (options?.immediate) {
      callback(resolveWatchSource(source))
    }
    return vi.fn()
  },
  onMounted: (callback: () => void) => callback()
}))

vi.mock('@vueuse/core', () => ({
  useDocumentVisibility: () => mocks.visibility,
  useWindowFocus: () => mocks.focused,
  useEventListener: (target: unknown, event: string, handler: (...args: unknown[]) => void) => {
    mocks.listeners.push({ target, event, handler })
    return vi.fn()
  }
}))

vi.mock('@/ui/state', () => ({
  layoutReady: mocks.layoutReady,
  runtimeMode: mocks.runtimeMode,
  selection: mocks.selection
}))

vi.mock('@/utils', () => ({
  getCanvas: mocks.getCanvas,
  getLeftPanel: mocks.getLeftPanel
}))

import { syncSelection, useSelection } from '@/composables/selection'
import { selection } from '@/ui/state'

function createSceneNode(id: string, visible = true): SceneNode {
  return {
    id,
    visible,
    type: 'FRAME',
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    children: []
  } as unknown as SceneNode
}

function setFigmaSelection(nodes: SceneNode[]) {
  const figma = {
    currentPage: {
      selection: nodes
    }
  }
  vi.stubGlobal('window', { figma } as unknown as Window)
  vi.stubGlobal('figma', figma)
}

function findListener(event: string, index = 0) {
  return mocks.listeners.filter((entry) => entry.event === event)[index]
}

describe('composables/selection', () => {
  beforeEach(() => {
    mocks.layoutReady.value = false
    mocks.runtimeMode.value = 'standard'
    mocks.selection.value = []
    mocks.visibility.value = 'visible'
    mocks.focused.value = true
    mocks.getCanvas.mockReset()
    mocks.getLeftPanel.mockReset()
    mocks.listeners.length = 0
    mocks.watchers.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('syncSelection clears stale selection when figma page is unavailable', () => {
    selection.value = [createSceneNode('stale')]
    vi.stubGlobal('window', {} as Window)

    syncSelection()

    expect(selection.value).toEqual([])

    // Covers the empty-selection no-op branch.
    syncSelection()
    expect(selection.value).toEqual([])
  })

  it('syncSelection updates only when selected node ids change', () => {
    const sameRef = [createSceneNode('same-ref')]
    setFigmaSelection(sameRef)
    selection.value = sameRef
    syncSelection()
    expect(selection.value).toBe(sameRef)

    const current = [createSceneNode('same')]
    setFigmaSelection([createSceneNode('same')])
    selection.value = current

    syncSelection()
    expect(selection.value).toBe(current)

    const next = [createSceneNode('next')]
    setFigmaSelection(next)
    syncSelection()

    expect(selection.value).toBe(next)
  })

  it('useSelection wires event listeners and reacts to watchers', () => {
    const canvas = {} as HTMLElement
    const panel = {} as HTMLElement
    mocks.layoutReady.value = true
    mocks.getCanvas.mockReturnValue(canvas)
    mocks.getLeftPanel.mockReturnValue(panel)
    setFigmaSelection([createSceneNode('initial')])

    useSelection()

    expect(selection.value[0]?.id).toBe('initial')
    expect(mocks.listeners.filter((entry) => entry.event === 'click')).toHaveLength(2)
    expect(mocks.listeners.filter((entry) => entry.event === 'keydown')).toHaveLength(1)

    setFigmaSelection([createSceneNode('click-sync')])
    findListener('click', 0)?.handler({})
    expect(selection.value[0]?.id).toBe('click-sync')

    setFigmaSelection([createSceneNode('focus-sync')])
    findListener('keydown', 0)?.handler({
      target: { classList: { contains: (name: string) => name === 'focus-target' } }
    })
    expect(selection.value[0]?.id).toBe('focus-sync')

    findListener('keydown', 0)?.handler({
      target: { classList: { contains: () => false } }
    })
    findListener('keydown', 0)?.handler({ target: null })
    expect(selection.value[0]?.id).toBe('focus-sync')

    const layoutWatcher = mocks.watchers[0]
    const modeWatcher = mocks.watchers[1]

    if (!layoutWatcher || !modeWatcher) {
      throw new Error('Expected both watchers to be registered')
    }

    selection.value = [createSceneNode('to-clear')]
    layoutWatcher.callback(false)
    expect(selection.value).toEqual([])

    layoutWatcher.callback(true)
    expect(mocks.getCanvas).toHaveBeenCalledTimes(3)
    expect(mocks.getLeftPanel).toHaveBeenCalledTimes(3)

    setFigmaSelection([createSceneNode('mode-guard')])
    mocks.layoutReady.value = true
    modeWatcher.callback(['unavailable', true])
    expect(selection.value).toEqual([])

    mocks.layoutReady.value = false
    modeWatcher.callback(['standard', true])
    expect(selection.value).toEqual([])

    mocks.layoutReady.value = true
    modeWatcher.callback(['standard', false])
    expect(selection.value).toEqual([])

    modeWatcher.callback(['standard', true])
    expect(selection.value[0]?.id).toBe('mode-guard')

    // Executes computed source (`isWindowActive`) through the watcher source tuple.
    setFigmaSelection([createSceneNode('source-eval')])
    modeWatcher.callback(resolveWatchSource(modeWatcher.source))
    expect(selection.value[0]?.id).toBe('source-eval')
  })

  it('handles initial layout-not-ready path without pre-clearing empty selection', () => {
    mocks.layoutReady.value = false
    mocks.selection.value = []
    setFigmaSelection([createSceneNode('not-used')])

    useSelection()

    expect(mocks.watchers).toHaveLength(2)
    expect(mocks.listeners.filter((entry) => entry.event === 'click')).toHaveLength(2)
    expect(mocks.listeners.filter((entry) => entry.event === 'keydown')).toHaveLength(1)
  })
})
