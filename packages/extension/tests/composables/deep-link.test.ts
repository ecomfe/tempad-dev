import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners: Array<{
    event: string
    handler: () => void
    disposer: ReturnType<typeof vi.fn>
  }> = []
  const timeouts: Array<{
    callback: () => void
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }> = []
  const scopeDisposers: Array<() => void> = []

  return {
    listeners,
    timeouts,
    scopeDisposers,
    useEventListener: vi.fn(),
    useTimeoutFn: vi.fn(),
    onScopeDispose: vi.fn(),
    notify: vi.fn(),
    open: vi.fn()
  }
})

vi.mock('@vueuse/core', () => ({
  useEventListener: mocks.useEventListener,
  useTimeoutFn: mocks.useTimeoutFn
}))

vi.mock('vue', () => ({
  onScopeDispose: mocks.onScopeDispose
}))

import { useDeepLinkGuard } from '@/composables/deep-link'

function findListener(event: string, index = 0): (() => void) | undefined {
  const handlers = mocks.listeners.filter((entry) => entry.event === event)
  return handlers[index]?.handler
}

describe('composables/deep-link', () => {
  beforeEach(() => {
    mocks.listeners.length = 0
    mocks.timeouts.length = 0
    mocks.scopeDisposers.length = 0

    mocks.useEventListener.mockImplementation((_target, event, handler) => {
      const disposer = vi.fn()
      mocks.listeners.push({ event: String(event), handler: handler as () => void, disposer })
      return disposer
    })

    mocks.useTimeoutFn.mockImplementation((callback: () => void) => {
      const start = vi.fn()
      const stop = vi.fn()
      mocks.timeouts.push({ callback, start, stop })
      return { start, stop }
    })

    mocks.onScopeDispose.mockImplementation((callback: () => void) => {
      mocks.scopeDisposers.push(callback)
    })

    mocks.notify.mockReset()
    mocks.open.mockReset()

    vi.stubGlobal('figma', {
      notify: mocks.notify
    })

    vi.stubGlobal('window', {
      open: mocks.open
    })

    vi.stubGlobal('document', {
      visibilityState: 'visible'
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens deep link and shows default toast after timeout', () => {
    const guard = useDeepLinkGuard()

    guard('tempad://open')

    expect(mocks.timeouts).toHaveLength(1)
    expect(mocks.timeouts[0]?.start).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledWith('tempad://open', '_self')

    mocks.timeouts[0]?.callback()

    expect(mocks.timeouts[0]?.stop).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith(
      'No response detected. Please install the client first.'
    )
  })

  it('uses fallback deep link once before showing message', () => {
    const guard = useDeepLinkGuard({
      fallbackDeepLink: 'tempad://fallback',
      message: 'Install MCP first'
    })

    guard('tempad://primary')
    mocks.timeouts[0]?.callback()

    expect(mocks.open).toHaveBeenNthCalledWith(1, 'tempad://primary', '_self')
    expect(mocks.open).toHaveBeenNthCalledWith(2, 'tempad://fallback', '_self')
    expect(mocks.notify).not.toHaveBeenCalled()

    mocks.timeouts[1]?.callback()

    expect(mocks.notify).toHaveBeenCalledWith('Install MCP first')
  })

  it('cancels current guard when a new deep link starts', () => {
    const guard = useDeepLinkGuard()

    guard('tempad://one')
    guard('tempad://two')

    expect(mocks.timeouts[0]?.stop).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenNthCalledWith(1, 'tempad://one', '_self')
    expect(mocks.open).toHaveBeenNthCalledWith(2, 'tempad://two', '_self')
  })

  it('cleans up on visibility change when document is hidden', () => {
    const guard = useDeepLinkGuard({ message: 'hidden' })

    guard('tempad://hidden')

    const visibility = findListener('visibilitychange')
    expect(visibility).toBeTypeOf('function')
    ;(document as { visibilityState: string }).visibilityState = 'visible'
    visibility?.()
    expect(mocks.timeouts[0]?.stop).not.toHaveBeenCalled()
    ;(document as { visibilityState: string }).visibilityState = 'hidden'
    visibility?.()
    expect(mocks.timeouts[0]?.stop).toHaveBeenCalledTimes(1)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('cleans up active guard when scope is disposed', () => {
    const guard = useDeepLinkGuard()

    // Covers disposal branch before any active cleanup exists.
    mocks.scopeDisposers[0]?.()

    guard('tempad://scope')
    mocks.scopeDisposers[0]?.()

    expect(mocks.timeouts[0]?.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps active guard reference when cleanup fires before activation', () => {
    let triggered = false
    mocks.useEventListener.mockImplementation((_target, event, handler) => {
      const disposer = vi.fn()
      const callback = handler as () => void
      mocks.listeners.push({ event: String(event), handler: callback, disposer })
      if (!triggered && event === 'blur') {
        triggered = true
        callback()
      }
      return disposer
    })

    const guard = useDeepLinkGuard()

    guard('tempad://preclean')
    const blur = findListener('blur')
    blur?.()

    expect(mocks.timeouts[0]?.stop).toHaveBeenCalledTimes(1)
    expect(mocks.timeouts[0]?.start).toHaveBeenCalledTimes(1)
  })
})
