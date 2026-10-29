import { describe, expect, it } from 'vitest'

import { computeDominantStyle, omitCommon } from '@/mcp/tools/code/text/style'
import { canonicalizeValue, pruneInheritedTextStyles, stripDefaultTextStyles } from '@/utils/css'

describe('CSS text style comparisons', () => {
  it.each([
    ['color', 'var(--Accent)', 'var(--accent)'],
    ['font-family', '"A B"', '"AB"'],
    ['font-family', '"A  B"', '"A B"'],
    ['font-family', '"Brand Font"', '"brand font"'],
    ['font-family', 'var(--Font, "A B")', 'var(--Font, "AB")']
  ])('retains the distinct %s override %s over %s', (key, current, inherited) => {
    const style = { [key]: current }

    pruneInheritedTextStyles(style, { [key]: inherited })

    expect(style).toEqual({ [key]: current })
    expect(omitCommon(style, { [key]: inherited })).toEqual(style)
  })

  it('keeps distinct variable references in dominant style selection', () => {
    expect(
      computeDominantStyle([
        { style: { color: 'var(--Accent)' }, weight: 1 },
        { style: { color: 'var(--accent)' }, weight: 3 }
      ])
    ).toEqual({ color: 'var(--accent)' })
  })

  it.each([
    ['rgba(0, 0, 0, 0.501)', 'rgba(0, 0, 0, 0.504)'],
    ['rgb(0.1, 0, 0)', 'rgb(0.2, 0, 0)'],
    ['rgba(255, 255, 255, invalid)', '#fff'],
    ['rgb(255, 255, 255, 1, 0)', '#fff'],
    ['rgb(, 0, 0)', '#000'],
    ['rgb(1., 0, 0)', 'rgb(1, 0, 0)']
  ])('does not discard %s by rounding or accepting it as %s', (current, inherited) => {
    const style = { color: current }
    pruneInheritedTextStyles(style, { color: inherited })
    expect(style).toEqual({ color: current })
    expect(omitCommon(style, { color: inherited })).toEqual(style)
  })

  it('still removes equivalent literal colors, weights, zero units and defaults', () => {
    const style = {
      color: 'RGB(170, 187, 204)',
      'font-weight': ' BOLD ',
      'letter-spacing': '0PX'
    }
    pruneInheritedTextStyles(style, { color: '#aabbcc', 'font-weight': '700' })
    expect(style).toEqual({})
    expect(
      stripDefaultTextStyles({
        'font-weight': 'NORMAL',
        'font-style': 'NORMAL',
        'line-height': ' NORMAL ',
        'text-decoration-style': 'SOLID'
      })
    ).toEqual({})
    expect(canonicalizeValue('color', 'RGBA(255, 255, 255, 0.5)')).toBe('#fff/50')
  })
})
