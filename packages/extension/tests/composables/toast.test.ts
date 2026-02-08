import { afterEach, describe, expect, it, vi } from 'vitest'

import { useToast } from '@/composables/toast'

describe('composables/toast', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows notification and hides active notification', () => {
    const cancel = vi.fn()
    const notify = vi.fn(() => ({ cancel }))
    vi.stubGlobal('figma', { notify })

    const toast = useToast()
    toast.show('Copied')

    expect(notify).toHaveBeenCalledWith('Copied')
    toast.hide()
    expect(cancel).toHaveBeenCalledTimes(1)

    toast.hide()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not fail when hide is called before show', () => {
    const notify = vi.fn(() => ({ cancel: vi.fn() }))
    vi.stubGlobal('figma', { notify })

    const toast = useToast()

    expect(() => toast.hide()).not.toThrow()
    expect(notify).not.toHaveBeenCalled()
  })

  it('tracks the latest notification handler', () => {
    const cancelFirst = vi.fn()
    const cancelSecond = vi.fn()
    const notify = vi
      .fn<(_msg: string) => NotificationHandler>()
      .mockReturnValueOnce({ cancel: cancelFirst } as NotificationHandler)
      .mockReturnValueOnce({ cancel: cancelSecond } as NotificationHandler)
    vi.stubGlobal('figma', { notify })

    const toast = useToast()
    toast.show('first')
    toast.show('second')
    toast.hide()

    expect(cancelFirst).not.toHaveBeenCalled()
    expect(cancelSecond).toHaveBeenCalledTimes(1)
  })
})
