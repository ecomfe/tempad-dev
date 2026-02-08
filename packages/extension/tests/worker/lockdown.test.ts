import { afterEach, describe, expect, it, vi } from 'vitest'

import { lockdownWorker } from '@/worker/lockdown'

describe('worker/lockdown', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'unsafeA')
    Reflect.deleteProperty(globalThis, 'unsafeB')
    vi.restoreAllMocks()
  })

  it('removes non-safe globals and defines fixed worker entry globals', () => {
    const originalGetOwnPropertyNames = Object.getOwnPropertyNames
    const originalDefineProperties = Object.defineProperties

    Object.defineProperty(globalThis, 'unsafeA', {
      value: 'value-a',
      writable: true,
      configurable: true
    })
    Object.defineProperty(globalThis, 'unsafeB', {
      value: 'value-b',
      writable: true,
      configurable: true
    })

    const getOwnPropertyNamesSpy = vi
      .spyOn(Object, 'getOwnPropertyNames')
      .mockImplementation((obj) => {
        if (obj === globalThis) return ['Object', 'onmessage', 'unsafeA', 'unsafeB']
        return originalGetOwnPropertyNames(obj)
      })
    const definePropertiesSpy = vi
      .spyOn(Object, 'defineProperties')
      .mockImplementation((target, descriptors) => {
        if (target !== globalThis) return originalDefineProperties(target, descriptors)
        return target as typeof globalThis
      })

    lockdownWorker('sandboxed-worker')

    expect(getOwnPropertyNamesSpy).toHaveBeenCalledWith(globalThis)
    expect((globalThis as Record<string, unknown>).unsafeA).toBeUndefined()
    expect((globalThis as Record<string, unknown>).unsafeB).toBeUndefined()

    expect(definePropertiesSpy).toHaveBeenCalledWith(
      globalThis,
      expect.objectContaining({
        name: {
          value: 'sandboxed-worker',
          writable: false,
          configurable: false
        },
        onmessage: {
          value: undefined,
          writable: false,
          configurable: false
        },
        onmessageerror: {
          value: undefined,
          writable: false,
          configurable: false
        },
        postMessage: {
          value: undefined,
          writable: false,
          configurable: false
        }
      })
    )
  })

  it('fails closed when a non-safe global cannot be cleared', () => {
    const originalGetOwnPropertyNames = Object.getOwnPropertyNames

    Object.defineProperty(globalThis, 'unsafeB', {
      value: 'locked',
      writable: false,
      configurable: true
    })

    vi.spyOn(Object, 'getOwnPropertyNames').mockImplementation((obj) => {
      if (obj === globalThis) return ['unsafeB']
      return originalGetOwnPropertyNames(obj)
    })

    expect(() => lockdownWorker('sandboxed-worker')).toThrow(
      'Failed to clear global property: unsafeB'
    )
    expect((globalThis as Record<string, unknown>).unsafeB).toBe('locked')
  })
})
