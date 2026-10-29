import { describe, expect, it } from 'vitest'

import { rgbToHex } from '@/utils/color'

describe('utils/color', () => {
  it('formats normalized RGB channels as hex', () => {
    expect(rgbToHex({ r: 1, g: 0.5, b: 0 })).toBe('#ff8000')
  })
})
