import { describe, expect, it } from 'vitest'

import safe from '@/worker/safe'

describe('worker/safe', () => {
  it('contains essential intrinsic globals for sandbox survival', () => {
    expect(safe.has('Object')).toBe(true)
    expect(safe.has('Function')).toBe(true)
    expect(safe.has('Array')).toBe(true)
    expect(safe.has('Promise')).toBe(true)
    expect(safe.has('Reflect')).toBe(true)
    expect(safe.has('console')).toBe(true)
    expect(safe.has('onmessage')).toBe(true)
  })

  it('does not include unrelated host keys by default', () => {
    expect(safe.has('setTimeout')).toBe(false)
    expect(safe.has('fetch')).toBe(false)
  })
})
