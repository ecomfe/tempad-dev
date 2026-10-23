import { describe, expect, it } from 'vitest'

import { preprocessStyles, styleToClassNames } from '@/mcp/tools/code/styles/normalize'
import {
  parseBorderShorthand,
  parseBoxValues,
  serializeCSS,
  splitByTopLevelComma
} from '@/utils/css'

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const

describe('CSS shorthand output', () => {
  it('retains nested calculations as complete spacing values', () => {
    const style = preprocessStyles({
      padding: 'calc(100% - 8px) 4px',
      margin: 'min(1rem, calc(2px + 3px)) auto',
      inset: 'calc(50% - 8px) 0 4px',
      gap: 'min(8px, calc(2px + 3px)) calc(1rem + 2px)'
    })
    expect(style).toMatchObject({
      'padding-top': 'calc(100% - 8px)',
      'padding-right': '4px',
      'padding-bottom': 'calc(100% - 8px)',
      'padding-left': '4px',
      'margin-top': 'min(1rem, calc(2px + 3px))',
      'margin-right': 'auto',
      top: 'calc(50% - 8px)',
      right: '0',
      bottom: '4px',
      left: '0',
      'row-gap': 'min(8px, calc(2px + 3px))',
      'column-gap': 'calc(1rem + 2px)'
    })
    expect(styleToClassNames(style, config)).toEqual(
      expect.arrayContaining([
        'py-[calc(100%_-_8px)]',
        'px-[4px]',
        'gap-y-[min(8px,_calc(2px_+_3px))]',
        'gap-x-[calc(1rem_+_2px)]'
      ])
    )
  })

  it.each(['12px / 24px', '12px 8px/24px 16px'])('preserves elliptical radius %s', (radius) => {
    const style = preprocessStyles({ 'border-radius': radius })
    expect(style).toEqual({ 'border-radius': radius })
    expect(styleToClassNames(style, config)).toEqual([`rounded-[${radius.replaceAll(' ', '_')}]`])
  })

  it.each(['red solid 1px', 'solid 1px red', '1px red solid'])(
    'classifies all components of %s regardless of order',
    (border) => {
      const style = preprocessStyles({ border })
      for (const side of ['top', 'right', 'bottom', 'left']) {
        expect(style).toMatchObject({
          [`border-${side}-width`]: '1px',
          [`border-${side}-style`]: 'solid',
          [`border-${side}-color`]: 'red'
        })
      }
      expect(style).not.toHaveProperty('border')
      expect(styleToClassNames(style, config)).toEqual(['border-[1px]', 'border-[red]'])
    }
  )

  it('keeps unknown arity shorthands through inferred layout', () => {
    const node = {
      type: 'FRAME',
      width: 100,
      height: 100,
      layoutMode: 'HORIZONTAL',
      paddingTop: 1,
      paddingRight: 2,
      paddingBottom: 3,
      paddingLeft: 4,
      itemSpacing: 8
    } as unknown as SceneNode
    const style = preprocessStyles(
      {
        padding: 'var(--spacing)',
        gap: 'var(--row) calc(1rem + 2px)',
        margin: 'env(safe-area-inset-top) auto',
        border: 'var(--border)'
      },
      node
    )
    expect(style).toEqual({
      padding: 'var(--spacing)',
      gap: 'var(--row) calc(1rem + 2px)',
      margin: 'env(safe-area-inset-top) auto',
      border: 'var(--border)',
      display: 'flex',
      'flex-direction': 'row'
    })
    expect(styleToClassNames(style, config)).toEqual(
      expect.arrayContaining([
        'p-(--spacing)',
        '[gap:var(--row)_calc(1rem_+_2px)]',
        '[border:var(--border)]'
      ])
    )
  })

  it.each(['solid', 'red', '1px', '1px solid', 'red solid', 'inherit'])(
    'retains %s so omitted border components keep their native defaults',
    (border) => {
      const style = preprocessStyles({ border })
      expect(style).toEqual({ border })
      expect(styleToClassNames(style, config)).toEqual([`[border:${border.replaceAll(' ', '_')}]`])
    }
  )

  it('retains uniform calculated widths in the gradient-border workaround', () => {
    const style = {
      'border-image': 'linear-gradient(red, blue) 1',
      'border-width': 'calc(1px + 1px)'
    }
    expect(parseBoxValues(style['border-width'])).toEqual(Array(4).fill('calc(1px + 1px)'))
    expect(styleToClassNames(style, config)).toContain('before:p-[calc(1px_+_1px)]')
  })

  it.each([
    { border: '1px solid var(--ring-color)' },
    Object.fromEntries(
      ['top', 'right', 'bottom', 'left'].map((side) => [
        `border-${side}`,
        `1px solid var(--${side}-color)`
      ])
    )
  ])('retains concrete widths beside variable colors in gradient borders', (borders) => {
    const style = preprocessStyles({
      ...borders,
      'border-image': 'linear-gradient(red, blue) 1',
      'border-radius': '8px'
    })
    expect(style).toMatchObject(borders)
    expect(styleToClassNames(style, config)).toContain('before:p-[1px]')
    const css = serializeCSS(style, { useRem: false, rootFontSize: 16, scale: 1 })
    expect(css).toContain('&::before')
    expect(css).toContain('padding: 1px;')
  })

  it.each([
    ['1px solid var(--color)', { width: '1px', style: 'solid' }],
    ['var(--width) solid red', { style: 'solid', color: 'red' }],
    ['1px var(--style) red', { width: '1px', color: 'red' }],
    ['var(--border)', {}]
  ])(
    'extracts only concrete components of %s without expanding the shorthand',
    (border, parsed) => {
      expect(parseBorderShorthand(border)).toEqual(parsed)
      expect(preprocessStyles({ border })).toEqual({ border })
    }
  )

  it('splits only the top-level slash in grid placement', () => {
    const style = preprocessStyles({
      'grid-row': 'calc(6 / 2) / span 2',
      'grid-column': 'calc(8 / 2)'
    })
    expect(style).toEqual({
      'grid-row-start': 'calc(6 / 2)',
      'grid-row-span': '2',
      'grid-column': 'calc(8 / 2)'
    })
    expect(styleToClassNames(style, config)).toEqual(
      expect.arrayContaining(['row-start-[calc(6_/_2)]', 'row-span-2', 'col-[calc(8_/_2)]'])
    )
  })

  it('keeps quoted, commented and escaped commas within their CSS token', () => {
    expect(splitByTopLevelComma(String.raw`url("a,b"), rgb(1, 2, 3), foo\,bar /* , */`)).toEqual([
      'url("a,b")',
      'rgb(1, 2, 3)',
      String.raw`foo\,bar /* , */`
    ])
  })
})
