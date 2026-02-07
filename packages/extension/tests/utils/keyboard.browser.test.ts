import { afterEach, describe, expect, it } from 'vitest'

import { setLockAltKey, setLockMetaKey } from '@/utils/keyboard'

describe('utils/keyboard lock helpers (browser)', () => {
  afterEach(() => {
    setLockMetaKey(false)
    setLockAltKey(false)
  })

  it('locks and restores metaKey getter', () => {
    setLockMetaKey(true)
    expect(new MouseEvent('click').metaKey).toBe(true)

    setLockMetaKey(false)
    expect(new MouseEvent('click').metaKey).toBe(false)
  })

  it('locks and restores altKey getter', () => {
    setLockAltKey(true)
    expect(new MouseEvent('click').altKey).toBe(true)

    setLockAltKey(false)
    expect(new MouseEvent('click').altKey).toBe(false)
  })
})
