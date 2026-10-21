import { afterEach, describe, expect, it } from 'vitest'

import { styleToClassNames } from '@/mcp/tools/code/styles'
import { cleanFigmaSpecificStyles } from '@/mcp/tools/code/styles/background'
import {
  resolveBackgroundFillFromPaints,
  resolveGradientFromPaints
} from '@/utils/figma-style/gradient'
import { resolveStylesFromNodeData } from '@/utils/figma-style/style-resolver'

import { installFigmaMocks, uninstallFigmaMocks } from './test-helpers'

const stops: [ColorStop, ColorStop] = [
  { position: 0.101, color: { r: 189 / 255, g: 221 / 255, b: 249 / 255, a: 1 } },
  { position: 1, color: { r: 230 / 255, g: 243 / 255, b: 254 / 255, a: 1 } }
]
const paint: GradientPaint = {
  type: 'GRADIENT_RADIAL',
  gradientTransform: [
    [1 / 0.748, 0, 0.5 - 0.5 / 0.748],
    [0, 1 / 0.748, 0.5 - 0.626 / 0.748]
  ],
  gradientStops: stops
}
const expected = 'radial-gradient(37.4% 37.4% at 50% 62.6%, #BDDDF9 10.1%, #E6F3FE 100%)'

afterEach(uninstallFigmaMocks)

describe('radial gradient geometry', () => {
  it.each([
    { width: 1000, height: 500 },
    { width: 500, height: 1000 }
  ])(
    'derives normalized size and position from the Plugin API transform on $width x $height nodes',
    (size) => {
      expect(resolveGradientFromPaints([paint], size)).toBe(expected)
    }
  )

  it('keeps explicit radii for an identity transform instead of using farthest-corner', () => {
    expect(
      resolveGradientFromPaints([
        {
          ...paint,
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0]
          ]
        }
      ])
    ).toBe('radial-gradient(50% 50% at 50% 50%, #BDDDF9 10.1%, #E6F3FE 100%)')
  })

  it('uses all three handles, including a vertical first radius and an outside center', () => {
    const withHandles = {
      ...paint,
      gradientHandlePositions: [
        { x: -0.1, y: 1.2 },
        { x: -0.1, y: 1.5 },
        { x: 0.3, y: 1.2 }
      ]
    }
    expect(resolveGradientFromPaints([withHandles])).toBe(
      'radial-gradient(40% 30% at -10% 120%, #BDDDF9 10.1%, #E6F3FE 100%)'
    )
  })

  it.each(
    (
      [
        [
          [0, 0, 0],
          [0, 0, 0]
        ],
        [
          [Infinity, 0, 0],
          [0, 1, 0]
        ],
        [
          [1, 1, 0],
          [0, 1, 0]
        ]
      ] as Transform[]
    ).map((transform) => ({ transform }))
  )('does not invent geometry for degenerate or skewed transforms', ({ transform }) => {
    expect(resolveGradientFromPaints([{ ...paint, gradientTransform: transform }])).toBe(
      'radial-gradient(#BDDDF9 10.1%, #E6F3FE 100%)'
    )
  })

  it('preserves the issue geometry through style resolution, MCP cleanup and Tailwind output', async () => {
    installFigmaMocks()
    const dimensions = { width: 1000, height: 500 }
    const result = await resolveStylesFromNodeData(
      { background: expected },
      { fills: [paint], dimensions }
    )
    const node = { type: 'FRAME', fills: [paint], ...dimensions } as unknown as SceneNode
    const cleaned = cleanFigmaSpecificStyles(result, node)
    expect(cleaned.background).toBe(expected)
    expect(
      styleToClassNames(cleaned, { cssUnit: 'px', rootFontSize: 16, scale: 1 }).join(' ')
    ).toContain('37.4%_37.4%_at_50%_62.6%')
  })

  it('uses paint geometry when Figma CSS is absent', () => {
    installFigmaMocks()
    const node = { type: 'FRAME', fills: [paint], width: 500, height: 300 } as unknown as SceneNode
    expect(cleanFigmaSpecificStyles({}, node).background).toBe(expected)
  })

  it.each([
    '37.4% 20%',
    'ellipse farthest-side at 20% 70%',
    'circle at left top',
    'calc(50% - 1px) 20% at center'
  ])(
    'preserves native CSS geometry %s while rebuilding variable colors and opacity',
    async (geometry) => {
      installFigmaMocks({ variables: { accent: { name: 'Accent' } as Variable } })
      const boundPaint: GradientPaint = {
        ...paint,
        opacity: 0.5,
        gradientStops: [
          { ...stops[0], boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'accent' } } },
          stops[1]
        ]
      }
      const result = await resolveStylesFromNodeData(
        { background: `radial-gradient(${geometry}, #BDDDF9 10.1%, #E6F3FE 100%)` },
        { fills: [boundPaint] }
      )
      expect(result.background).toContain(
        `radial-gradient(${geometry}, color-mix(in srgb, var(--Accent, #BDDDF9) 50%, transparent) 10.1%`
      )
      expect(result.background).toContain('#E6F3FE80 100%')
    }
  )

  it('matches multiple native radial layers after filtering invisible paints', () => {
    const result = resolveBackgroundFillFromPaints(
      [{ ...paint, visible: false }, paint, paint],
      undefined,
      undefined,
      {
        background:
          'radial-gradient(20% 30% at 40% 50%, red 10.1%, blue 100%), radial-gradient(60% 70% at 80% 90%, red 10.1%, blue 100%)'
      }
    )
    expect(result).toEqual({
      kind: 'layers',
      value: [
        'radial-gradient(20% 30% at 40% 50%, #BDDDF9 10.1%, #E6F3FE 100%)',
        'radial-gradient(60% 70% at 80% 90%, #BDDDF9 10.1%, #E6F3FE 100%)'
      ]
    })
  })

  it('retains native CSS when color stops cannot be paired safely', () => {
    const background = 'radial-gradient(20% 30% at 40% 50%, red 20%, 30%, blue 40%)'
    expect(resolveBackgroundFillFromPaints([paint], undefined, undefined, { background })).toEqual({
      kind: 'layers',
      value: [background]
    })
  })

  it.each([
    'radial-gradient(10% 20%, red, blue)',
    'conic-gradient(from 90deg at 30% 40%, black 0deg, red 90deg, blue 270deg, black 360deg)'
  ])('retains native layers when their paints cannot be paired: %s', (gradient) => {
    const layers = [gradient, 'linear-gradient(red, blue)']
    expect(
      resolveBackgroundFillFromPaints([paint], undefined, undefined, {
        background: layers.join(', ')
      })
    ).toEqual({
      kind: 'layers',
      value: layers
    })
  })

  it('reconstructs paint geometry when the CSS only supplies a placeholder', () => {
    expect(
      resolveBackgroundFillFromPaints([paint], undefined, undefined, {
        background: 'var(--background)'
      })
    ).toEqual({ kind: 'layers', value: [expected] })
  })
})
