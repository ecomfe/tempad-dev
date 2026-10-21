import { expect, it } from 'vitest'

import { preserveGradientGeometry } from '@/utils/figma-style/gradient'

it.each([
  [
    'linear-gradient(red 20%, green, blue 40%)',
    'linear-gradient(90deg, #F008 0%, #0F08 50%, #00F8 100%)',
    'linear-gradient(#F008 20%, #0F08, #00F8 40%)'
  ],
  [
    'radial-gradient(red, blue)',
    'radial-gradient(20% 30% at 40% 50%, #F008 0%, #00F8 100%)',
    'radial-gradient(#F008, #00F8)'
  ],
  [
    'linear-gradient(to bottom right, red 25%, blue 75%)',
    'linear-gradient(90deg, #F008 0%, #00F8 100%)',
    'linear-gradient(to bottom right, #F008 25%, #00F8 75%)'
  ],
  [
    'radial-gradient(20% 30% at 40% 50%, var(--a, rgb(1, 2, 3)) 25% 30%, #00F calc(75% - 1px)) center / cover',
    'radial-gradient(#F008 0%, color-mix(in srgb, var(--b) 50%, transparent) 100%)',
    'radial-gradient(20% 30% at 40% 50%, #F008 25% 30%, color-mix(in srgb, var(--b) 50%, transparent) calc(75% - 1px)) center / cover'
  ],
  [
    'conic-gradient(from 30deg at 20% 40%, red 90deg, blue 270deg)',
    'conic-gradient(#F008 0%, #00F8 100%)',
    'conic-gradient(from 30deg at 20% 40%, #F008 90deg, #00F8 270deg)'
  ],
  [
    '  LINEAR-GRADIENT(90deg, red 20%, blue 80%) ',
    'linear-gradient(#F008 0%, #00F8 100%)',
    'linear-gradient(90deg, #F008 20%, #00F8 80%)'
  ]
])('replaces colors while retaining native geometry in %s', (source, resolved, expected) => {
  expect(preserveGradientGeometry(source, resolved)).toBe(expected)
})

it.each([
  ['linear-gradient(red 25%, blue 75%)', 'radial-gradient(#F00 0%, #00F 100%)'],
  ['linear-gradient(red 25%, 40%, blue 75%)', 'linear-gradient(#F00 0%, #00F 100%)'],
  ['linear-gradient(red 25%, blue 75%, green 100%)', 'linear-gradient(#F00 0%, #00F 100%)'],
  ['linear-gradient(var(--a) 25%, blue 75%', 'linear-gradient(#F00 0%, #00F 100%)'],
  ['url(a)', 'linear-gradient(#F00 0%, #00F 100%)']
])('rejects ambiguous or invalid pairing for %s', (source, resolved) => {
  expect(preserveGradientGeometry(source, resolved)).toBeNull()
})
