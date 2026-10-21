import { expect, it } from 'vitest'

import {
  matchBackgroundPaintLayers,
  preserveGradientGeometry,
  resolveBackgroundFillFromPaints
} from '@/utils/figma-style/gradient'

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

it.each([
  ['rgba(128, 128, 255, 0.38) 0deg, ', ', rgba(128, 128, 255, 0.38) 360deg', '25%', '75%'],
  ['', ', rgba(128, 128, 255, 0.38) 360deg', '0%', '75%'],
  ['rgba(128, 128, 255, 0.38) 0deg, ', '', '25%', '100%']
])('retains synthesized angular endpoints: %s / %s', (prefix, suffix, first, last) => {
  const firstAngle = `${Number.parseFloat(first) * 3.6}deg`
  const lastAngle = `${Number.parseFloat(last) * 3.6}deg`
  expect(
    preserveGradientGeometry(
      `conic-gradient(from 90deg at 50% 50%, ${prefix}var(--Blue) ${firstAngle}, white ${lastAngle}${suffix})`,
      `conic-gradient(color-mix(in srgb, var(--Blue) 50%, transparent) ${first}, #FFFFFF80 ${last})`
    )
  ).toBe(
    `conic-gradient(from 90deg at 50% 50%, ${prefix}color-mix(in srgb, var(--Blue) 50%, transparent) ${firstAngle}, #FFFFFF80 ${lastAngle}${suffix})`
  )
})

it.each([
  [
    'conic-gradient(black 0deg, red 90deg, blue 270deg, white 360deg)',
    'conic-gradient(red 0%, blue 100%)'
  ],
  ['conic-gradient(red 90deg, green 180deg, blue 270deg)', 'conic-gradient(red 25%, blue 75%)'],
  ['conic-gradient(black 0deg, red 90deg, blue 270deg)', 'conic-gradient(red, blue)'],
  [
    'conic-gradient(black 0deg, red 180deg, blue 270deg, white 360deg)',
    'conic-gradient(red 25%, blue 75%)'
  ],
  [
    'conic-gradient(black 0deg, red 0turn, blue 270deg, white 360deg)',
    'conic-gradient(red 25%, blue 75%)'
  ]
])('leaves unproven angular stop layouts unchanged: %s', (source, resolved) => {
  expect(preserveGradientGeometry(source, resolved)).toBeNull()
})

const quadrants = ['bottom right', 'bottom left', 'top left', 'top right'].map(
  (corner) =>
    `linear-gradient(to ${corner}, var(--Blue) 13%, white 38%) ${corner} / 50% 50% no-repeat`
)
const diamond: GradientPaint = {
  type: 'GRADIENT_DIAMOND',
  gradientTransform: [
    [1, 0, 0],
    [0, 1, 0]
  ],
  gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 1, a: 1 } }]
}
const image = { type: 'IMAGE' } as ImagePaint

it('matches all four diamond quadrants without consuming adjacent images or gradients', () => {
  const linear = { ...diamond, type: 'GRADIENT_LINEAR' } as GradientPaint
  const other = 'linear-gradient(90deg, red 0%, blue 100%)'
  expect(
    matchBackgroundPaintLayers(`${quadrants.join(', ')}, url(image), ${other}`, [
      linear,
      image,
      diamond
    ])
  ).toEqual([quadrants, ['url(image)'], [other]])
  expect(
    preserveGradientGeometry(
      quadrants[0]!,
      'radial-gradient(#0000FF40 25%, #FFFFFF80 75%)',
      'GRADIENT_DIAMOND'
    )
  ).toBe(
    'linear-gradient(to bottom right, #0000FF40 13%, #FFFFFF80 38%) bottom right / 50% 50% no-repeat'
  )
})

it.each([
  quadrants.slice(0, 3),
  [quadrants[0]!, quadrants[0]!, quadrants[2]!, quadrants[3]!],
  quadrants.map((layer) => layer.replace('50% 50%', '100% 100%')),
  quadrants.map((layer) => layer.replace('to bottom right', 'to top left')),
  quadrants.map((layer) => layer.replace(/ (?:bottom|top) (?:left|right) \/.*$/, '')),
  [...quadrants, 'linear-gradient(red, blue)']
])('rejects ambiguous or partial diamond stacks %j', (...layers) => {
  const background = layers.join(', ')
  expect(matchBackgroundPaintLayers(background, [diamond])).toBeNull()
  expect(resolveBackgroundFillFromPaints([diamond], undefined, undefined, { background })).toEqual({
    kind: 'layers',
    value: layers
  })
})

it('matches authored angular positions with native degree rounding', () => {
  expect(
    preserveGradientGeometry(
      'conic-gradient(black 0deg, red 44deg, blue 270deg, black 360deg)',
      'conic-gradient(#F008 12.345%, #00F8 75%)'
    )
  ).toBe('conic-gradient(black 0deg, #F008 44deg, #00F8 270deg, black 360deg)')
})
