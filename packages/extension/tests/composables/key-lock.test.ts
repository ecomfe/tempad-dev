import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RefLike<T> = { value: T }

type ListenerEntry = {
  target: unknown
  event: string
  handler: (...args: unknown[]) => void
}

const mocks = vi.hoisted(() => ({
  layoutReady: { value: false } as RefLike<boolean>,
  options: {
    value: {
      deepSelectOn: true,
      measureOn: true
    }
  } as RefLike<{ deepSelectOn: boolean; measureOn: boolean }>,
  getCanvas: vi.fn(),
  setLockAltKey: vi.fn(),
  setLockMetaKey: vi.fn(),
  listeners: [] as ListenerEntry[],
  watchers: [] as Array<{
    source: unknown
    callback: (value: unknown) => void
  }>,
  mutationCallbacks: [] as Array<() => void>
}))

function resolveWatchSource(source: unknown) {
  if (typeof source === 'function') return (source as () => unknown)()
  if (source && typeof source === 'object' && 'value' in (source as Record<string, unknown>)) {
    return (source as RefLike<unknown>).value
  }
  return source
}

vi.mock('vue', () => ({
  shallowRef: <T>(value: T) => ({ value }),
  watch: (
    source: unknown,
    callback: (value: unknown) => void,
    options?: { immediate?: boolean }
  ) => {
    mocks.watchers.push({ source, callback })
    if (options?.immediate) callback(resolveWatchSource(source))
    return vi.fn()
  }
}))

vi.mock('@vueuse/core', () => ({
  useEventListener: (
    targetOrEvent: unknown,
    eventOrHandler: string | ((...args: unknown[]) => void),
    maybeHandler?: (...args: unknown[]) => void
  ) => {
    const isTargetEventSignature =
      typeof eventOrHandler === 'string' && typeof maybeHandler === 'function'

    const entry = isTargetEventSignature
      ? {
          target: targetOrEvent,
          event: eventOrHandler as string,
          handler: maybeHandler as (...args: unknown[]) => void
        }
      : {
          target: undefined,
          event: targetOrEvent as string,
          handler: eventOrHandler as (...args: unknown[]) => void
        }

    mocks.listeners.push(entry)
    return vi.fn()
  },
  useMutationObserver: (_target: unknown, callback: () => void) => {
    mocks.mutationCallbacks.push(callback)
    return vi.fn()
  }
}))

vi.mock('@/ui/state', () => ({
  layoutReady: mocks.layoutReady,
  options: mocks.options
}))

vi.mock('@/utils', () => ({
  getCanvas: mocks.getCanvas,
  setLockAltKey: mocks.setLockAltKey,
  setLockMetaKey: mocks.setLockMetaKey
}))

function createClassList(initial: string[] = []) {
  const values = new Set(initial)
  return {
    add(name: string) {
      values.add(name)
    },
    contains(name: string) {
      return values.has(name)
    },
    [Symbol.iterator]: function* () {
      yield* values
    }
  }
}

function createCanvasTree(hovered = true) {
  const host = {
    dataset: {} as Record<string, string>,
    classList: createClassList(['base'])
  }
  const canvas = {
    matches: vi.fn((selector: string) => selector === ':hover' && hovered),
    parentElement: {
      parentElement: host
    }
  }

  return {
    host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLElement
  }
}

function findListener(event: string, index = 0) {
  return mocks.listeners.filter((item) => item.event === event)[index]
}

async function mountComposable() {
  vi.resetModules()
  const mod = await import('@/composables/key-lock')
  mod.useKeyLock()
}

beforeEach(() => {
  mocks.layoutReady.value = false
  mocks.options.value = {
    deepSelectOn: true,
    measureOn: true
  }
  mocks.getCanvas.mockReset()
  mocks.setLockAltKey.mockReset()
  mocks.setLockMetaKey.mockReset()
  mocks.listeners.length = 0
  mocks.watchers.length = 0
  mocks.mutationCallbacks.length = 0
  vi.stubGlobal(
    'getComputedStyle',
    vi.fn(() => ({ cursor: 'auto' }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('composables/key-lock', () => {
  it('syncs lock state with layout readiness transitions', async () => {
    const { canvas } = createCanvasTree(true)
    mocks.getCanvas.mockReturnValue(canvas)

    await mountComposable()

    const layoutWatcher = mocks.watchers[0]
    if (!layoutWatcher) throw new Error('Expected layout watcher')

    layoutWatcher.callback(true)
    expect(mocks.getCanvas).toHaveBeenCalledTimes(1)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(true)
    expect(mocks.setLockAltKey).toHaveBeenLastCalledWith(true)

    layoutWatcher.callback(false)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(false)
    expect(mocks.setLockAltKey).toHaveBeenLastCalledWith(false)
  })

  it('handles keydown/keyup for Alt and Space with measure guards', async () => {
    const { canvas } = createCanvasTree(true)
    mocks.getCanvas.mockReturnValue(canvas)
    mocks.layoutReady.value = true

    await mountComposable()

    const keydown = findListener('keydown')
    const keyup = findListener('keyup')
    if (!keydown || !keyup) throw new Error('Expected keyboard listeners')

    keydown.handler({ key: 'Alt' } as KeyboardEvent)
    expect(mocks.setLockAltKey).toHaveBeenCalledWith(false)

    keyup.handler({ key: 'Alt' } as KeyboardEvent)
    expect(mocks.setLockAltKey).toHaveBeenLastCalledWith(true)

    const altCalls = mocks.setLockAltKey.mock.calls.length
    mocks.options.value.measureOn = false
    keydown.handler({ key: 'Alt' } as KeyboardEvent)
    expect(mocks.setLockAltKey.mock.calls.length).toBe(altCalls)

    keydown.handler({ key: ' ' } as KeyboardEvent)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(false)
    expect(mocks.setLockAltKey).toHaveBeenLastCalledWith(false)

    keyup.handler({ key: ' ' } as KeyboardEvent)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(true)
    expect(mocks.setLockAltKey).toHaveBeenLastCalledWith(false)
  })

  it('pauses meta on wheel and resumes after timeout when not space-pressed', async () => {
    vi.useFakeTimers()

    const { canvas } = createCanvasTree(true)
    mocks.getCanvas.mockReturnValue(canvas)
    mocks.layoutReady.value = true

    await mountComposable()

    const wheel = findListener('wheel')
    const keydown = findListener('keydown')
    if (!wheel || !keydown) throw new Error('Expected wheel and keydown listeners')

    wheel.handler({} as WheelEvent)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(false)

    vi.advanceTimersByTime(200)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(true)

    keydown.handler({ key: ' ' } as KeyboardEvent)
    wheel.handler({} as WheelEvent)
    vi.advanceTimersByTime(200)
    expect(mocks.setLockMetaKey).toHaveBeenLastCalledWith(false)
  })

  it('reconciles duplicate cursor cover via mutation observer and measure toggle', async () => {
    const DUPLICATE_CURSOR =
      'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAIZElEQVR4AeyYTWxUVRTH3yD9UCEE) 8 8, auto'

    const { canvas, host } = createCanvasTree(true)
    mocks.getCanvas.mockReturnValue(canvas)
    mocks.layoutReady.value = true
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({ cursor: DUPLICATE_CURSOR }))
    )

    await mountComposable()

    const mutation = mocks.mutationCallbacks[0]
    if (!mutation) throw new Error('Expected mutation callback')
    ;(host.classList as unknown as { add: (name: string) => void }).add('dup-class')
    mutation()
    expect(host.dataset.tpCursorOverride).toBe('')

    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({ cursor: 'auto' }))
    )
    mutation()
    expect(host.dataset.tpCursorOverride).toBe('')

    mocks.options.value.measureOn = false
    mutation()
    expect(host.dataset.tpCursorOverride).toBeUndefined()
  })
})
