import { afterEach, describe, expect, it, vi } from 'vitest'

import { lockdownWorker } from '@/worker/lockdown'

describe('worker/lockdown', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'unsafeA')
    Reflect.deleteProperty(globalThis, 'unsafeB')
    Reflect.deleteProperty(globalThis, 'unsafeC')
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
      writable: false,
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

  it('ignores properties that fail both assignment and defineProperty fallback', () => {
    const originalGetOwnPropertyNames = Object.getOwnPropertyNames
    const originalDefineProperties = Object.defineProperties
    const originalDefineProperty = Object.defineProperty

    Object.defineProperty(globalThis, 'unsafeC', {
      value: 'locked',
      writable: false,
      configurable: true
    })

    vi.spyOn(Object, 'getOwnPropertyNames').mockImplementation((obj) => {
      if (obj === globalThis) return ['unsafeC']
      return originalGetOwnPropertyNames(obj)
    })
    vi.spyOn(Object, 'defineProperty').mockImplementation((obj, key, descriptor) => {
      if (obj === globalThis && key === 'unsafeC') {
        throw new TypeError('blocked defineProperty')
      }
      return originalDefineProperty(obj, key, descriptor)
    })
    vi.spyOn(Object, 'defineProperties').mockImplementation((target, descriptors) => {
      if (target !== globalThis) return originalDefineProperties(target, descriptors)
      return target as typeof globalThis
    })

    expect(() => lockdownWorker('sandboxed-worker')).not.toThrow()
    expect((globalThis as Record<string, unknown>).unsafeC).toBe('locked')
  })
})
