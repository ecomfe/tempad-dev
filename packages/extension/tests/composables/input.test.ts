import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useEventListener: vi.fn()
}))

vi.mock('@vueuse/core', () => ({
  useEventListener: mocks.useEventListener
}))

import { useSelectAll } from '@/composables/input'

describe('composables/input', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('registers focus listener that selects input content', () => {
    const input = { select: vi.fn() } as unknown as HTMLInputElement

    useSelectAll(input)

    expect(mocks.useEventListener).toHaveBeenCalledTimes(1)
    expect(mocks.useEventListener).toHaveBeenCalledWith(input, 'focus', expect.any(Function))

    const callback = mocks.useEventListener.mock.calls[0][2] as (e: Event) => void
    callback({ target: input } as unknown as Event)
    expect(input.select).toHaveBeenCalledTimes(1)
  })

  it('handles null-ish event targets safely', () => {
    useSelectAll(null)
    const callback = mocks.useEventListener.mock.calls[0][2] as (e: Event) => void

    expect(() => callback({ target: null } as unknown as Event)).not.toThrow()
  })
})
