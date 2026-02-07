import { afterEach, describe, expect, it, vi } from 'vitest'

import { lockdownWorker } from '@/worker/lockdown'

describe('worker/lockdown', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes non-safe globals and defines fixed worker entry globals', () => {
    const originalGetOwnPropertyNames = Object.getOwnPropertyNames
    const originalDefineProperties = Object.defineProperties

    const getOwnPropertyNamesSpy = vi
      .spyOn(Object, 'getOwnPropertyNames')
      .mockImplementation((obj) => {
        if (obj === globalThis) return ['Object', 'onmessage', 'unsafeA', 'unsafeB']
        return originalGetOwnPropertyNames(obj)
      })
    const reflectSetSpy = vi.spyOn(Reflect, 'set').mockImplementation(() => true)
    const definePropertiesSpy = vi
      .spyOn(Object, 'defineProperties')
      .mockImplementation((target, descriptors) => {
        if (target !== globalThis) return originalDefineProperties(target, descriptors)
        return target as typeof globalThis
      })

    lockdownWorker('sandboxed-worker')

    expect(getOwnPropertyNamesSpy).toHaveBeenCalledWith(globalThis)
    expect(reflectSetSpy).toHaveBeenCalledTimes(2)
    expect(reflectSetSpy).toHaveBeenCalledWith(globalThis, 'unsafeA', undefined)
    expect(reflectSetSpy).toHaveBeenCalledWith(globalThis, 'unsafeB', undefined)
    expect(reflectSetSpy).not.toHaveBeenCalledWith(globalThis, 'Object', undefined)
    expect(reflectSetSpy).not.toHaveBeenCalledWith(globalThis, 'onmessage', undefined)

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
})
