import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveFillStyleForNode,
  resolveStrokeStyleForNode,
  resolveStylesFromNode
} from '../../src/figma/style-resolver'
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

function paintStyle(paints: Paint[]): PaintStyle {
  return {
    paints
  } as unknown as PaintStyle
}

afterEach(() => {
  uninstallFigmaMocks()
  vi.restoreAllMocks()
})

describe('figma/style-resolver node paint style resolution', () => {
  it('prefers fill style id paints over direct node fills', () => {
    installFigmaMocks({
      styles: {
        fillStyle: paintStyle([gradientPaint()])
      }
    })

    const node = {
      fillStyleId: 'fillStyle',
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode

    expect(resolveFillStyleForNode(node)).toEqual({
      gradient: 'linear-gradient(270deg, #F00 0%, #00F 100%)'
    })
  })

  it('falls back to node paints when fill style id is absent or not a paint style', () => {
    installFigmaMocks({
      styles: {
        fillStyle: {} as BaseStyle
      }
    })

    const withInvalidStyle = {
      fillStyleId: 'fillStyle',
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode
    expect(resolveFillStyleForNode(withInvalidStyle)).toEqual({ solidColor: '#0F0' })

    const withoutStyle = {
      fills: [solidPaint({ r: 0, g: 1, b: 0 })]
    } as unknown as SceneNode
    expect(resolveFillStyleForNode(withoutStyle)).toEqual({ solidColor: '#0F0' })
  })

  it('returns null when node has no fill or stroke fields', () => {
    installFigmaMocks()

    const node = {} as SceneNode
    expect(resolveFillStyleForNode(node)).toBeNull()
    expect(resolveStrokeStyleForNode(node)).toBeNull()
  })

  it('returns null when node paint arrays exist but cannot resolve to gradient or solid', () => {
    installFigmaMocks()
    const node = {
      fills: [{ type: 'IMAGE', visible: true }]
    } as unknown as SceneNode

    expect(resolveFillStyleForNode(node)).toBeNull()
  })

  it('returns null and warns when style lookup throws', () => {
    installFigmaMocks({
      styleErrors: ['bad-style']
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const node = {
      strokeStyleId: 'bad-style',
      strokes: [solidPaint({ r: 1, g: 0, b: 0 })]
    } as unknown as SceneNode

    expect(resolveStrokeStyleForNode(node)).toEqual({ solidColor: '#F00' })
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
      background: 'linear-gradient(270deg, #F00 0%, #00F 100%)'
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
      background: 'linear-gradient(270deg, #F00 0%, #00F 100%)'
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
      'border-image': 'linear-gradient(270deg, #F00 0%, #00F 100%)',
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
      'border-image': 'linear-gradient(270deg, #F00 0%, #00F 100%)',
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
      'border-image': 'linear-gradient(270deg, #F00 0%, #00F 100%)',
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
      stroke: 'linear-gradient(270deg, #F00 0%, #00F 100%)'
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
