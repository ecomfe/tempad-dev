import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const layoutReady = { value: false }
  const runtimeMode = { value: 'standard' as 'standard' | 'unavailable' }
  const visibility = { value: 'visible' }
  const watchers: Array<{
    source: { value: unknown } | (() => unknown)
    callback: (value: unknown) => void
  }> = []
  const intervals: Array<{
    callback: () => void
    pause: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    immediate: boolean
  }> = []

  return {
    layoutReady,
    runtimeMode,
    visibility,
    watchers,
    intervals,
    waitFor: vi.fn(),
    getCanvas: vi.fn(),
    getLeftPanel: vi.fn(),
    log: vi.fn()
  }
})

vi.mock('vue', () => ({
  computed: (getter: () => unknown) => ({
    get value() {
      return getter()
    }
  }),
  watch: (
    source: { value: unknown } | (() => unknown),
    callback: (value: unknown) => void,
    options?: { immediate?: boolean }
  ) => {
    mocks.watchers.push({ source, callback })
    if (options?.immediate) {
      const value = typeof source === 'function' ? source() : source.value
      callback(value)
    }
    return vi.fn()
  }
}))

vi.mock('@vueuse/core', () => ({
  useDocumentVisibility: () => mocks.visibility,
  useIntervalFn: (callback: () => void, _ms: number, options?: { immediate?: boolean }) => {
    const pause = vi.fn()
    const resume = vi.fn()
    mocks.intervals.push({ callback, pause, resume, immediate: options?.immediate !== false })
    return { pause, resume }
  }
}))

vi.mock('p-wait-for', () => ({
  default: mocks.waitFor
}))

vi.mock('@/ui/state', () => ({
  layoutReady: mocks.layoutReady,
  runtimeMode: mocks.runtimeMode
}))

vi.mock('@/utils', () => ({
  getCanvas: mocks.getCanvas,
  getLeftPanel: mocks.getLeftPanel
}))

vi.mock('@/utils/log', () => ({
  logger: {
    log: mocks.log
  }
}))

import { useFigmaAvailability } from '@/composables/availability'

function triggerCanCheckWatch(value: boolean) {
  const entry = mocks.watchers[0]
  if (!entry) {
    throw new Error('Expected canCheck watcher to be registered')
  }
  entry.callback(value)
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('composables/availability', () => {
  beforeEach(() => {
    mocks.layoutReady.value = false
    mocks.runtimeMode.value = 'standard'
    mocks.visibility.value = 'visible'
    mocks.watchers.length = 0
    mocks.intervals.length = 0

    mocks.waitFor.mockReset()
    mocks.waitFor.mockResolvedValue(undefined)
    mocks.getCanvas.mockReset()
    mocks.getLeftPanel.mockReset()
    mocks.log.mockReset()

    vi.stubGlobal('window', {
      figma: {
        currentPage: null
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('syncs layoutReady from polling interval callback', () => {
    mocks.getCanvas.mockReturnValueOnce({}).mockReturnValueOnce(null)
    mocks.getLeftPanel.mockReturnValue({})

    useFigmaAvailability()

    expect(mocks.intervals).toHaveLength(2)

    mocks.intervals[0]?.callback()
    expect(mocks.layoutReady.value).toBe(true)

    mocks.intervals[0]?.callback()
    expect(mocks.layoutReady.value).toBe(false)
  })

  it('keeps layoutReady unchanged when poll result matches current value', () => {
    mocks.layoutReady.value = true
    mocks.getCanvas.mockReturnValue({})
    mocks.getLeftPanel.mockReturnValue({})

    useFigmaAvailability()

    mocks.intervals[0]?.callback()

    expect(mocks.layoutReady.value).toBe(true)
  })

  it('stops recover loop immediately when canCheck is false', () => {
    mocks.layoutReady.value = false

    useFigmaAvailability()

    expect(mocks.intervals[1]?.pause).toHaveBeenCalledTimes(1)
  })

  it('enters standard mode when waitFor succeeds and figma is ready', async () => {
    mocks.layoutReady.value = true
    mocks.runtimeMode.value = 'unavailable'
    ;(window as { figma?: { currentPage: unknown } }).figma = { currentPage: {} }
    mocks.waitFor.mockResolvedValue(undefined)

    useFigmaAvailability()
    await flushMicrotasks()

    expect(mocks.waitFor).toHaveBeenCalledTimes(1)
    expect(mocks.runtimeMode.value).toBe('standard')
    expect(mocks.intervals[1]?.pause).toHaveBeenCalledTimes(1)
    expect(mocks.log).toHaveBeenCalledWith('`window.figma` is now available. TemPad Dev is ready.')
  })

  it('enters unavailable mode on waitFor timeout and recovers when ready', async () => {
    mocks.layoutReady.value = true
    mocks.runtimeMode.value = 'standard'
    ;(window as { figma?: { currentPage: unknown } }).figma = { currentPage: null }
    mocks.waitFor.mockRejectedValue(new Error('timeout'))

    useFigmaAvailability()
    await flushMicrotasks()

    expect(mocks.runtimeMode.value).toBe('unavailable')
    expect(mocks.intervals[1]?.resume).toHaveBeenCalledTimes(1)
    expect(mocks.log).toHaveBeenCalledWith(
      '`window.figma` is not available. TemPad Dev is currently unavailable.'
    )

    // Covers recover loop `ok=false` path (keeps unavailable mode, does not pause on `ok`).
    mocks.visibility.value = 'visible'
    ;(window as { figma?: { currentPage: unknown } }).figma = { currentPage: null }
    mocks.intervals[1]?.callback()

    mocks.visibility.value = 'hidden'
    mocks.intervals[1]?.callback()
    expect(mocks.intervals[1]?.pause).toHaveBeenCalledTimes(1)

    mocks.visibility.value = 'visible'
    ;(window as { figma?: { currentPage: unknown } }).figma = { currentPage: {} }
    mocks.intervals[1]?.callback()

    expect(mocks.runtimeMode.value).toBe('standard')
    expect(mocks.intervals[1]?.pause).toHaveBeenCalledTimes(2)
  })

  it('returns early when runCheck is triggered while canCheck is false', async () => {
    mocks.layoutReady.value = false
    mocks.visibility.value = 'hidden'
    mocks.waitFor.mockResolvedValue(undefined)

    useFigmaAvailability()
    triggerCanCheckWatch(true)
    await flushMicrotasks()

    expect(mocks.waitFor).not.toHaveBeenCalled()
  })

  it('does not log when setMode receives the same mode', async () => {
    mocks.layoutReady.value = true
    mocks.runtimeMode.value = 'standard'
    ;(window as { figma?: { currentPage: unknown } }).figma = { currentPage: {} }
    mocks.waitFor.mockResolvedValue(undefined)

    useFigmaAvailability()
    await flushMicrotasks()

    expect(mocks.runtimeMode.value).toBe('standard')
    expect(mocks.log).not.toHaveBeenCalled()
  })

  it('ignores stale runCheck results when token changes before waitFor resolves', async () => {
    mocks.layoutReady.value = true
    mocks.runtimeMode.value = 'unavailable'
    ;(window as { figma?: { currentPage: unknown } }).figma = { currentPage: {} }

    const waitForGate: { resolve: () => void } = {
      resolve: () => undefined
    }
    mocks.waitFor.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          waitForGate.resolve = () => resolve()
        })
    )

    useFigmaAvailability()

    mocks.layoutReady.value = false
    triggerCanCheckWatch(false)

    waitForGate.resolve()
    await flushMicrotasks()

    expect(mocks.runtimeMode.value).toBe('unavailable')
    expect(mocks.log).not.toHaveBeenCalledWith(
      '`window.figma` is now available. TemPad Dev is ready.'
    )
  })
})
