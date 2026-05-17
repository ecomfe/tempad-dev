import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveStylesFromNodeData,
  resolveStylesFromNode
} from '@/utils/figma-style/style-resolver'

import { installFigmaMocks, uninstallFigmaMocks } from './test-helpers'

function solidPaint(color: { r: number; g: number; b: number }): SolidPaint {
  return {
    type: 'SOLID',
    visible: true,
    opacity: 1,
    color
  } as unknown as SolidPaint
}

function gradientPaint(): GradientPaint {
  return {
    type: 'GRADIENT_LINEAR',
    visible: true,
    opacity: 1,
    gradientStops: [
      { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
      { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
    ],
    gradientHandlePositions: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 }
    ],
    gradientTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ]
  } as unknown as GradientPaint
}

function paintStyle(
  paints: Paint[],
  boundVariables?: Record<string, unknown>,
  name?: string
): PaintStyle {
  return {
    paints,
    ...(name ? { name } : {}),
    ...(boundVariables ? { boundVariables } : {})
  } as unknown as PaintStyle
}

afterEach(() => {
  uninstallFigmaMocks()
  vi.restoreAllMocks()
})

describe('figma/style-resolver paint precedence', () => {
  it('prefers fill style paints over direct node fills', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([gradientPaint()])
      }
    })

    const node = {
      fillStyleId: 'fillStyle',
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)'
      },
      node
    )

    expect(result).toEqual({
      background: 'linear-gradient(90deg, #F00 0%, #00F 100%)'
    })
  })

  it('falls back to node fills when fill style id is not a paint style', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: {} as BaseStyle
      }
    })

    const withInvalidStyle = {
      fillStyleId: 'fillStyle',
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)'
      },
      withInvalidStyle
    )

    expect(result).toEqual({
      'background-color': '#0F0'
    })
  })

  it('leaves unresolved fill channels unchanged when node fills cannot resolve to solid or gradient', async () => {
    installFigmaMocks()
    const node = {
      fills: [{ type: 'IMAGE', visible: true }]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)'
      },
      node
    )

    expect(result).toEqual({
      background: 'var(--fill)'
    })
  })

  it('warns and falls back to node strokes when style lookup throws', async () => {
    installFigmaMocks({
      styleErrors: ['bad-style']
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const node = {
      strokeStyleId: 'bad-style',
      strokes: [solidPaint({ r: 1, g: 0, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        stroke: 'var(--stroke)'
      },
      node
    )

    expect(result).toEqual({
      stroke: '#F00'
    })
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('figma/style-resolver resolveStylesFromNode', () => {
  it('strips lightgray fallback in background image and keeps resolved background-color', async () => {
    installFigmaMocks()
    const node = {
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'url("asset.png") lightgray'
      },
      node
    )

    expect(result).toEqual({
      background: 'url("asset.png")',
      'background-color': '#0F0'
    })
  })

  it('keeps variable bindings when stripping lightgray image fallback', async () => {
    installFigmaMocks({
      variables: {
        accent: { name: 'Accent' } as Variable
      }
    })
    const node = {
      fills: [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
      boundVariables: {
        fills: [{ id: 'accent' }]
      }
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'url("asset.png") lightgray'
      },
      node
    )

    expect(result).toEqual({
      background: 'url("asset.png")',
      'background-color': 'var(--Accent, #276EAF)'
    })
  })

  it('strips lightgray fallback even when fills do not resolve to a solid color', async () => {
    installFigmaMocks()
    const node = {
      fills: [gradientPaint()]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'url("asset.png") lightgray'
      },
      node
    )

    expect(result).toEqual({
      background: 'url("asset.png")'
    })
  })

  it('does not treat lightgray inside the image URL as a fallback token', async () => {
    installFigmaMocks()
    const node = {
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'url("/img/lightgray-bg.png") center / cover'
      },
      node
    )

    expect(result).toEqual({
      background: 'url("/img/lightgray-bg.png") center / cover'
    })
  })

  it('replaces fill background with gradient when fill style id resolves to gradient', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)'
      },
      node
    )
    expect(result).toEqual({
      background: 'linear-gradient(90deg, #F00 0%, #00F 100%)'
    })
  })

  it('promotes background-color to background for gradient fill styles', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        'background-color': 'var(--fill)'
      },
      node
    )
    expect(result).toEqual({
      background: 'linear-gradient(90deg, #F00 0%, #00F 100%)'
    })
  })

  it('leaves fill output unchanged when gradient exists but no background channels are present', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode({}, node)
    expect(result).toEqual({})
  })

  it('applies solid fill style to background-color, color, and fill channels', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)',
        color: 'var(--fill)',
        fill: 'var(--fill)'
      },
      node
    )
    expect(result).toEqual({
      'background-color': '#0F0',
      color: '#0F0',
      fill: '#0F0'
    })
  })

  it('resolves existing fill style variables unless safe style-name vars are requested', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle(
          [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
          undefined,
          'Accent'
        )
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const resolved = await resolveStylesFromNode(
      {
        background: 'var(--Accent)',
        color: 'var(--Accent)',
        fill: 'var(--Accent)'
      },
      node
    )
    expect(resolved).toEqual({
      'background-color': '#276EAF',
      color: '#276EAF',
      fill: '#276EAF'
    })

    const withStyleNameVars = await resolveStylesFromNode(
      {
        background: 'var(--Accent)',
        color: 'var(--Accent)',
        fill: 'var(--Accent)'
      },
      node,
      undefined,
      { emitSafeStyleNameVars: true }
    )
    expect(withStyleNameVars).toEqual({
      'background-color': 'var(--Accent, #276EAF)',
      color: 'var(--Accent, #276EAF)',
      fill: 'var(--Accent, #276EAF)'
    })
  })

  it('resolves existing multi-fill style variables to valid background layers by default', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([solidPaint({ r: 1, g: 0, b: 0 }), solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const resolved = await resolveStylesFromNode(
      {
        background: 'var(--Accent)'
      },
      node
    )
    expect(resolved).toEqual({
      background: 'linear-gradient(#F00, #F00), linear-gradient(#0F0, #0F0)'
    })

    const withStyleNameVars = await resolveStylesFromNode(
      {
        background: 'var(--Accent)'
      },
      node,
      undefined,
      { emitSafeStyleNameVars: true }
    )
    expect(withStyleNameVars).toEqual({
      background: 'linear-gradient(#F00, #F00), linear-gradient(#0F0, #0F0)'
    })
  })

  it('emits safe paint style variables only when requested', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle(
          [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
          undefined,
          'Accent'
        )
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const resolved = await resolveStylesFromNode(
      {
        fill: '#276EAF'
      },
      node
    )
    expect(resolved).toEqual({
      fill: '#276EAF'
    })

    const preserved = await resolveStylesFromNode(
      {
        fill: '#276EAF'
      },
      node,
      undefined,
      {
        emitSafeStyleNameVars: true
      }
    )
    expect(preserved).toEqual({
      fill: 'var(--Accent, #276EAF)'
    })
  })

  it('does not synthesize paint style variables for multi-fill or gradient styles', async () => {
    const multiStyle = paintStyle(
      [solidPaint({ r: 1, g: 0, b: 0 }), solidPaint({ r: 0, g: 1, b: 0 })],
      undefined,
      'Accent'
    )
    const gradientStyle = paintStyle([gradientPaint()], undefined, 'Accent')
    installFigmaMocks({
      styles: {
        multiStyle,
        gradientStyle
      }
    })

    const multi = await resolveStylesFromNode(
      {
        background: '#F00'
      },
      { fillStyleId: 'multiStyle' } as unknown as SceneNode,
      undefined,
      {
        emitSafeStyleNameVars: true
      }
    )
    expect(multi).toEqual({
      background: 'linear-gradient(#F00, #F00), linear-gradient(#0F0, #0F0)'
    })

    const gradient = await resolveStylesFromNode(
      {
        background: '#F00'
      },
      { fillStyleId: 'gradientStyle' } as unknown as SceneNode,
      undefined,
      {
        emitSafeStyleNameVars: true
      }
    )
    expect(gradient).toEqual({
      background: 'linear-gradient(90deg, #F00 0%, #00F 100%)'
    })
  })

  it('applies solid fill style to color without requiring background channels', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        color: 'var(--fill)'
      },
      node
    )
    expect(result).toEqual({
      color: '#0F0'
    })
  })

  it('applies solid fill from node paints even when fill style id is absent', async () => {
    installFigmaMocks()
    const node = {
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)',
        color: 'var(--fill)',
        fill: 'var(--fill)'
      },
      node
    )
    expect(result).toEqual({
      'background-color': '#0F0',
      color: '#0F0',
      fill: '#0F0'
    })
  })

  it('restores node-level fill variable bindings before style serialization', async () => {
    installFigmaMocks({
      variables: {
        accent: { name: 'Accent' } as Variable
      }
    })
    const node = {
      fills: [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
      boundVariables: {
        fills: [{ id: 'accent' }]
      }
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)',
        color: '#276EAF',
        fill: '#276EAF'
      },
      node
    )

    expect(result).toEqual({
      'background-color': 'var(--Accent, #276EAF)',
      color: 'var(--Accent, #276EAF)',
      fill: 'var(--Accent, #276EAF)'
    })
  })

  it('restores paint-style-level fill variable bindings before style serialization', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })], {
          paints: [{ id: 'accent' }]
        })
      },
      variables: {
        accent: { name: 'Accent' } as Variable
      }
    })
    const node = {
      fillStyleId: 'fillStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        'background-color': 'var(--fill)',
        fill: '#276EAF'
      },
      node
    )

    expect(result).toEqual({
      'background-color': 'var(--Accent, #276EAF)',
      fill: 'var(--Accent, #276EAF)'
    })
  })

  it('preserves multiple visible solid fills as layered background output', async () => {
    installFigmaMocks()
    const node = {
      fills: [solidPaint({ r: 1, g: 0, b: 0 }), solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)'
      },
      node
    )

    expect(result).toEqual({
      background: 'linear-gradient(#F00, #F00), linear-gradient(#0F0, #0F0)'
    })
  })

  it('preserves multiple visible solid fills when background-color is the fill channel', async () => {
    installFigmaMocks()
    const node = {
      fills: [solidPaint({ r: 1, g: 0, b: 0 }), solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        'background-color': 'var(--fill)'
      },
      node
    )

    expect(result).toEqual({
      background: 'linear-gradient(#F00, #F00), linear-gradient(#0F0, #0F0)'
    })
  })

  it('uses fill style paints before direct node fills for layered background resolution', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 }), solidPaint({ r: 0, g: 0, b: 1 })])
      }
    })
    const node = {
      fillStyleId: 'fillStyle',
      fills: [solidPaint({ r: 1, g: 0, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'var(--fill)'
      },
      node
    )

    expect(result).toEqual({
      background: 'linear-gradient(#0F0, #0F0), linear-gradient(#00F, #00F)'
    })
  })

  it('does not merge image shorthand with multi-fill layers after removing lightgray fallback', async () => {
    installFigmaMocks()
    const node = {
      fills: [solidPaint({ r: 1, g: 0, b: 0 }), solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'url("asset.png") lightgray'
      },
      node
    )

    expect(result).toEqual({
      background: 'url("asset.png")',
      'background-color': '#F00'
    })
  })

  it('uses fill style paints before direct node fills when resolving lightgray fallback color', async () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      fillStyleId: 'fillStyle',
      fills: [solidPaint({ r: 1, g: 0, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        background: 'url("asset.png") lightgray'
      },
      node
    )

    expect(result).toEqual({
      background: 'url("asset.png")',
      'background-color': '#0F0'
    })
  })

  it('uses border-image for gradient stroke styles', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        border: '1px solid var(--stroke)'
      },
      node
    )
    expect(result).toEqual({
      border: '1px solid var(--stroke)',
      'border-image': 'linear-gradient(90deg, #F00 0%, #00F 100%)',
      'border-image-slice': '1'
    })
  })

  it('uses border-image when only border-color is present for gradient stroke styles', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        'border-color': 'var(--stroke)'
      },
      node
    )
    expect(result).toEqual({
      'border-color': 'var(--stroke)',
      'border-image': 'linear-gradient(90deg, #F00 0%, #00F 100%)',
      'border-image-slice': '1'
    })
  })

  it('uses border-image for gradient node strokes when stroke style id is absent', async () => {
    installFigmaMocks()
    const node = {
      strokes: [gradientPaint()]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        border: '1px solid var(--stroke)'
      },
      node
    )
    expect(result).toEqual({
      border: '1px solid var(--stroke)',
      'border-image': 'linear-gradient(90deg, #F00 0%, #00F 100%)',
      'border-image-slice': '1'
    })
  })

  it('ignores empty and non-channel border keys when checking gradient stroke border channels', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        border: '   ',
        'border-radius': '4px',
        'border-image-slice': '2'
      },
      node
    )

    expect(result).toEqual({
      border: '   ',
      'border-radius': '4px',
      'border-image-slice': '2'
    })
  })

  it('updates border-color and stroke for solid stroke styles', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const withBorderColor = await resolveStylesFromNode(
      {
        'border-color': 'var(--stroke)',
        stroke: 'var(--stroke)'
      },
      node
    )
    expect(withBorderColor).toEqual({
      'border-color': '#0F0',
      stroke: '#0F0'
    })

    const withBorderShorthand = await resolveStylesFromNode(
      {
        border: '1px solid var(--stroke)'
      },
      node
    )
    expect(withBorderShorthand).toEqual({
      border: '1px solid #0F0'
    })

    const withWidthAndColorVars = await resolveStylesFromNode(
      {
        border: 'var(--border-width-20, 2px) solid var(--stroke, #000)'
      },
      node
    )
    expect(withWidthAndColorVars).toEqual({
      border: 'var(--border-width-20, 2px) solid #0F0'
    })

    const withWidthVarOnly = await resolveStylesFromNode(
      {
        border: 'var(--border-width-20, 2px) solid #000'
      },
      node
    )
    expect(withWidthVarOnly).toEqual({
      border: 'var(--border-width-20, 2px) solid #000'
    })
  })

  it('keeps styles unchanged when solid stroke style exists without border targets', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode({}, node)
    expect(result).toEqual({})
  })

  it('keeps shorthand border unchanged when it has no variable token', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([solidPaint({ r: 0, g: 1, b: 0 })])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        border: '1px solid #000'
      },
      node
    )
    expect(result).toEqual({
      border: '1px solid #000'
    })
  })

  it('resolves existing stroke style variables unless safe style-name vars are requested', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle(
          [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
          undefined,
          'Accent'
        )
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const withBorderColor = await resolveStylesFromNode(
      {
        'border-color': 'var(--Accent)',
        stroke: 'var(--Accent)'
      },
      node
    )
    expect(withBorderColor).toEqual({
      'border-color': '#276EAF',
      stroke: '#276EAF'
    })

    const withBorderShorthand = await resolveStylesFromNode(
      {
        border: '1px solid var(--Accent)'
      },
      node
    )
    expect(withBorderShorthand).toEqual({
      border: '1px solid #276EAF'
    })

    const withStyleNameBorderColor = await resolveStylesFromNode(
      {
        'border-color': 'var(--Accent)',
        stroke: 'var(--Accent)'
      },
      node,
      undefined,
      { emitSafeStyleNameVars: true }
    )
    expect(withStyleNameBorderColor).toEqual({
      'border-color': 'var(--Accent, #276EAF)',
      stroke: 'var(--Accent, #276EAF)'
    })

    const withStyleNameBorderShorthand = await resolveStylesFromNode(
      {
        border: '1px solid var(--Accent)'
      },
      node,
      undefined,
      { emitSafeStyleNameVars: true }
    )
    expect(withStyleNameBorderShorthand).toEqual({
      border: '1px solid var(--Accent, #276EAF)'
    })
  })

  it('emits safe stroke style variables only when requested', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle(
          [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
          undefined,
          'Accent Stroke'
        )
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const resolved = await resolveStylesFromNode(
      {
        'border-color': '#276EAF',
        stroke: '#276EAF'
      },
      node
    )
    expect(resolved).toEqual({
      'border-color': '#276EAF',
      stroke: '#276EAF'
    })

    const preserved = await resolveStylesFromNode(
      {
        border: '1px solid #276EAF',
        'border-color': '#276EAF',
        stroke: '#276EAF'
      },
      node,
      undefined,
      {
        emitSafeStyleNameVars: true
      }
    )
    expect(preserved).toEqual({
      border: '1px solid var(--Accent-Stroke, #276EAF)',
      'border-color': 'var(--Accent-Stroke, #276EAF)',
      stroke: 'var(--Accent-Stroke, #276EAF)'
    })
  })

  it('patches stroke color from node strokes when no stroke style id exists', async () => {
    installFigmaMocks()
    const node = {
      strokes: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        stroke: 'var(--stroke)'
      },
      node
    )
    expect(result).toEqual({
      stroke: '#0F0'
    })
  })

  it('restores node-level stroke variable bindings before style serialization', async () => {
    installFigmaMocks({
      variables: {
        accent: { name: 'Accent Stroke' } as Variable
      }
    })
    const node = {
      strokes: [solidPaint({ r: 39 / 255, g: 110 / 255, b: 175 / 255 })],
      boundVariables: {
        strokes: [{ id: 'accent' }]
      }
    } as unknown as SceneNode

    const withBorderColor = await resolveStylesFromNode(
      {
        'border-color': '#276EAF',
        stroke: '#276EAF'
      },
      node
    )
    expect(withBorderColor).toEqual({
      'border-color': 'var(--Accent-Stroke, #276EAF)',
      stroke: 'var(--Accent-Stroke, #276EAF)'
    })

    const withBorderShorthand = await resolveStylesFromNode(
      {
        border: '1px solid var(--stroke)'
      },
      node
    )
    expect(withBorderShorthand).toEqual({
      border: '1px solid var(--Accent-Stroke, #276EAF)'
    })
  })

  it('sets stroke to gradient when stroke style resolves to gradient', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([gradientPaint()])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        stroke: 'var(--stroke)'
      },
      node
    )
    expect(result).toEqual({
      stroke: 'linear-gradient(90deg, #F00 0%, #00F 100%)'
    })
  })

  it('keeps stroke unchanged when stroke style id exists but style cannot resolve paint', async () => {
    installFigmaMocks({
      styles: {
        strokeStyle: paintStyle([{ type: 'IMAGE', visible: true } as unknown as Paint])
      }
    })
    const node = {
      strokeStyleId: 'strokeStyle'
    } as unknown as SceneNode

    const result = await resolveStylesFromNode(
      {
        stroke: 'var(--stroke)'
      },
      node
    )
    expect(result).toEqual({
      stroke: 'var(--stroke)'
    })
  })
})

describe('figma/style-resolver resolveStylesFromNodeData', () => {
  it('supports injected lookup readers and keeps gradient resolution size-sensitive', async () => {
    const readers = {
      getStyleById: vi.fn(
        () =>
          ({
            paints: [
              {
                type: 'GRADIENT_LINEAR',
                visible: true,
                opacity: 1,
                gradientStops: [
                  { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
                  { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
                ],
                gradientHandlePositions: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                  { x: 0, y: 1 }
                ]
              }
            ]
          }) as unknown as PaintStyle
      ),
      getVariableById: vi.fn(() => null)
    }

    const tall = await resolveStylesFromNodeData(
      { background: 'var(--fill)' },
      {
        fillStyleId: 'fill-style',
        dimensions: { width: 100, height: 100 }
      },
      readers
    )
    const wide = await resolveStylesFromNodeData(
      { background: 'var(--fill)' },
      {
        fillStyleId: 'fill-style',
        dimensions: { width: 200, height: 100 }
      },
      readers
    )

    expect(tall.background).toBe('linear-gradient(135deg, #F00 0%, #00F 100%)')
    expect(wide.background).toBe('linear-gradient(116.57deg, #F00 0%, #00F 100%)')
    expect(readers.getStyleById).toHaveBeenCalledTimes(2)
    expect(readers.getVariableById).not.toHaveBeenCalled()
  })
})
