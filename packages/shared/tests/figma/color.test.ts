import { describe, expect, it } from 'vitest'

import { formatHexAlpha } from '../../src/figma/color'

describe('figma/color formatHexAlpha', () => {
  it('uses default opacity when omitted', () => {
    expect(formatHexAlpha({ r: 0, g: 1, b: 0 })).toBe('#0F0')
  })

  it('compresses opaque colors when possible', () => {
    expect(formatHexAlpha({ r: 1, g: 0, b: 0 }, 1)).toBe('#F00')
    expect(formatHexAlpha({ r: 0.8, g: 0.2, b: 0.1333333333 }, 1)).toBe('#C32')
  })

  it('returns alpha-inclusive notation for transparent colors', () => {
    expect(formatHexAlpha({ r: 1, g: 0, b: 0 }, 0.5)).toBe('#FF000080')
    expect(formatHexAlpha({ r: 1, g: 0, b: 0 }, 0.5333333333)).toBe('#F008')
  })

  it('clamps and rounds channel and opacity values', () => {
    expect(formatHexAlpha({ r: -1, g: 0.501, b: 2 }, -0.4)).toBe('#0080FF00')
    expect(formatHexAlpha({ r: 0.996, g: 0, b: 0 }, 0.994)).toBe('#FE0000')
  })
})
