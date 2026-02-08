import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  overlay: vi.fn(),
  plugin: vi.fn(),
  destroy: vi.fn(),
  toValue: vi.fn(),
  watchEffect: vi.fn(),
  scrollbarsHidingPlugin: { name: 'ScrollbarsHidingPlugin' },
  sizeObserverPlugin: { name: 'SizeObserverPlugin' },
  clickScrollPlugin: { name: 'ClickScrollPlugin' }
}))

mocks.overlay.mockImplementation(() => ({
  destroy: mocks.destroy
}))
;(mocks.overlay as unknown as { plugin: typeof mocks.plugin }).plugin = mocks.plugin

vi.mock('overlayscrollbars', () => ({
  OverlayScrollbars: mocks.overlay,
  ScrollbarsHidingPlugin: mocks.scrollbarsHidingPlugin,
  SizeObserverPlugin: mocks.sizeObserverPlugin,
  ClickScrollPlugin: mocks.clickScrollPlugin
}))

vi.mock('vue', () => ({
  toValue: mocks.toValue,
  watchEffect: mocks.watchEffect
}))

describe('composables/scrollbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.toValue.mockReset()
    mocks.watchEffect.mockReset()
  })

  it('registers overlay plugins on module load', async () => {
    await import('@/composables/scrollbar')

    expect(mocks.plugin).toHaveBeenCalledWith([
      mocks.scrollbarsHidingPlugin,
      mocks.sizeObserverPlugin,
      mocks.clickScrollPlugin
    ])
  })

  it('creates and destroys overlay instance when container is available', async () => {
    const container = {} as HTMLElement
    const options = { scrollbars: { autoHide: 'scroll' as const } }
    let cleanup: (() => void) | undefined

    mocks.toValue.mockReturnValue(container)
    mocks.watchEffect.mockImplementation(
      (effect: (onCleanup: (cb: () => void) => void) => void) => {
        effect((cb) => {
          cleanup = cb
        })
      }
    )

    const { useScrollbar } = await import('@/composables/scrollbar')

    useScrollbar(container, options)

    expect(mocks.overlay).toHaveBeenCalledWith(container, options)
    expect(cleanup).toBeTypeOf('function')

    cleanup?.()

    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('skips overlay setup when container resolves to null', async () => {
    mocks.toValue.mockReturnValue(null)
    mocks.watchEffect.mockImplementation(
      (effect: (onCleanup: (cb: () => void) => void) => void) => {
        effect(() => undefined)
      }
    )

    const { useScrollbar } = await import('@/composables/scrollbar')

    useScrollbar(null, { scrollbars: { autoHide: 'scroll' } })

    expect(mocks.overlay).not.toHaveBeenCalled()
  })
})
