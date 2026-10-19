import { describe, expect, it, vi } from 'vitest'

import { normalizeCssValue, serializeCSS } from '@/utils/css'

const remConfig = { cssUnit: 'rem' as const, rootFontSize: 16, scale: 1 }

describe('CSS dimension conversion', () => {
  it.each([
    ['var(--spacing-16px, 16px)', 'var(--spacing-16px, 1rem)'],
    ['calc(var(--spacing-16px) + 32px)', 'calc(var(--spacing-16px) + 2rem)'],
    ['size-16px --16px café16px \\31 6px', 'size-16px --16px café16px \\31 6px'],
    ['16px-wide 16pxfoo 16p\\78', '16px-wide 16pxfoo 16p\\78'],
    ['"16px" \'32px\' "escaped \\"16px\\"" 16px', '"16px" \'32px\' "escaped \\"16px\\"" 1rem'],
    [
      'url(icon-16px.svg) URL("icon)32px.svg") 16px',
      'url(icon-16px.svg) URL("icon)32px.svg") 1rem'
    ],
    [
      'url(data:image/svg+xml,16px) url(icon\\)16px.svg) 16px',
      'url(data:image/svg+xml,16px) url(icon\\)16px.svg) 1rem'
    ],
    ['u\\72 l(16px.png) 16px', 'u\\72 l(16px.png) 1rem'],
    ['#16px @size-16px /* 16px */ 16px', '#16px @size-16px /* 16px */ 1rem'],
    ['-16px +32PX .8px -.8px 1.6e1px 0px -0px', '-1rem 2rem 0.05rem -0.05rem 1rem 0 0'],
    ['16rem 10% 2 1e999px', '16rem 10% 2 1e999px'],
    ['16px /* unfinished 16px', '1rem /* unfinished 16px'],
    ['16px "unfinished 16px', '1rem "unfinished 16px'],
    ['16px url(unfinished-16px', '1rem url(unfinished-16px']
  ])('converts only px dimensions in %s', (input, expected) => {
    expect(normalizeCssValue(input, remConfig)).toBe(expected)
  })

  it('preserves token identities when scaling and serializing UI styles', () => {
    const value = 'calc(var(--spacing-16px, 16px) + 8px)'
    expect(normalizeCssValue(value, { ...remConfig, scale: 2 })).toBe(
      'calc(var(--spacing-16px, 2rem) + 1rem)'
    )
    expect(
      serializeCSS(
        { width: value, 'background-image': 'url(icon-16px.svg)' },
        { useRem: true, rootFontSize: 16, scale: 2, variableDisplay: 'both' }
      )
    ).toBe('width: calc(var(--spacing-16px, 2rem) + 1rem);\nbackground-image: url(icon-16px.svg);')
  })

  it('calls plugin dimension transforms only for real length values', () => {
    const transformPx = vi.fn(({ value }: { value: number }) => `${value / 16}em`)
    const code = serializeCSS(
      { width: 'calc(var(--spacing-16px) + 32px)', content: '"16px"' },
      { useRem: false, rootFontSize: 16, scale: 1 },
      { transformPx }
    )
    expect(code).toBe('width: calc(var(--spacing-16px) + 2em);\ncontent: "16px";')
    expect(transformPx).toHaveBeenCalledOnce()
    expect(transformPx).toHaveBeenCalledWith(expect.objectContaining({ value: 32 }))
  })
})
