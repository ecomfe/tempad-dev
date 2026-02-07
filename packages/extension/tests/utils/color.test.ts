import { describe, expect, it } from 'vitest'

import { compressHex, fadeTo, formatHex, rgbToHex, rgbaToCss } from '@/utils/color'

describe('utils/color', () => {
  it('fades hex colors and compresses opaque values', () => {
    expect(fadeTo('#ff0000')).toBe('#f00')
    expect(fadeTo('#112233')).toBe('#123')
    expect(fadeTo('#123456')).toBe('#123456')
    expect(fadeTo('#f00', 0.25)).toBe('rgba(255, 0, 0, 0.25)')
    expect(fadeTo('#00ff00', -1)).toBe('rgba(0, 255, 0, 0)')
    expect(fadeTo('#00ff00', 2)).toBe('rgba(0, 255, 0, 1)')
    expect(() => fadeTo('#12', 0.5)).toThrow(/Invalid hex color/)
  })

  it('formats rgb/rgba outputs', () => {
    expect(rgbToHex({ r: 1, g: 0.5, b: 0 })).toBe('#ff8000')

    expect(rgbaToCss({ r: 1, g: 0.5, b: 0 })).toBe('rgba(255, 128, 0, 1)')
    expect(rgbaToCss({ r: 1, g: 0, b: 0, a: undefined })).toBe('rgba(255, 0, 0, 1)')
    expect(rgbaToCss({ r: -1, g: 2, b: 0.5, a: 0.333 })).toBe('rgba(0, 255, 128, 0.33)')
    expect(rgbaToCss({ r: 1, g: 0, b: 0, a: 0.2 }, 0.75)).toBe('rgba(255, 0, 0, 0.75)')
  })

  it('formats and compresses hex values', () => {
    expect(formatHex(255, 0, 255)).toBe('#ff00ff')
    expect(compressHex('#AABBCC')).toBe('#abc')
    expect(compressHex('#112233')).toBe('#123')
    expect(compressHex('#123456')).toBe('#123456')
    expect(compressHex('#XYZXYZ')).toBe('#xyzxyz')
  })
})
