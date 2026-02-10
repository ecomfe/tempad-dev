import { describe, expect, it } from 'vitest'

import { applyStrokeToCSS, resolveStrokeFromPaints } from '../../src/figma/stroke'

function createGradientPaint(): GradientPaint {
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

function createSolidPaint(color: { r: number; g: number; b: number }): SolidPaint {
  return {
    type: 'SOLID',
    visible: true,
    opacity: 1,
    color
  } as unknown as SolidPaint
}

describe('figma/stroke resolveStrokeFromPaints', () => {
  it('returns null for invalid paint lists', () => {
    expect(resolveStrokeFromPaints()).toBeNull()
    expect(resolveStrokeFromPaints(null)).toBeNull()
    expect(resolveStrokeFromPaints('invalid' as unknown as Paint[])).toBeNull()
  })

  it('prioritizes gradient result over solid color', () => {
    const result = resolveStrokeFromPaints([
      createGradientPaint(),
      createSolidPaint({ r: 1, g: 0, b: 0 })
    ])
    expect(result).toEqual({ gradient: 'linear-gradient(90deg, #F00 0%, #00F 100%)' })
  })

  it('falls back to solid color when gradient is absent', () => {
    const result = resolveStrokeFromPaints([createSolidPaint({ r: 0, g: 1, b: 0 })])
    expect(result).toEqual({ solidColor: '#0F0' })
  })

  it('returns null when no gradient or solid paint can be resolved', () => {
    const result = resolveStrokeFromPaints([{ type: 'IMAGE', visible: true } as unknown as Paint])
    expect(result).toBeNull()
  })
})

describe('figma/stroke applyStrokeToCSS', () => {
  it('returns original styles when no resolved stroke style is provided', () => {
    const input = { border: '1px solid var(--stroke)' }
    expect(applyStrokeToCSS(input, null)).toBe(input)
  })

  it('uses border-image for gradient border variables and removes border-color', () => {
    const result = applyStrokeToCSS(
      {
        border: '1px solid var(--stroke)',
        'border-color': 'var(--stroke)'
      },
      { gradient: 'linear-gradient(90deg, #F00, #00F)' }
    )

    expect(result).toEqual({
      border: '1px solid var(--stroke)',
      'border-image': 'linear-gradient(90deg, #F00, #00F) 1',
      'border-image-slice': '1'
    })
  })

  it('updates border-color directly for solid color results', () => {
    const result = applyStrokeToCSS(
      {
        'border-color': 'var(--stroke)'
      },
      { solidColor: '#0F0' }
    )

    expect(result).toEqual({
      'border-color': '#0F0'
    })
  })

  it('patches border shorthand variable token when border-color is absent', () => {
    const result = applyStrokeToCSS(
      {
        border: '2px dashed var(--stroke)'
      },
      { solidColor: '#0F0' }
    )

    expect(result).toEqual({
      border: '2px dashed #0F0'
    })
  })

  it('patches trailing color variable in border shorthand with width variable present', () => {
    const result = applyStrokeToCSS(
      {
        border: 'var(--border-width-20, 2px) solid var(--stroke, #000)'
      },
      { solidColor: '#0F0' }
    )

    expect(result).toEqual({
      border: 'var(--border-width-20, 2px) solid #0F0'
    })
  })

  it('keeps shorthand unchanged when only border width uses variable token', () => {
    const result = applyStrokeToCSS(
      {
        border: 'var(--border-width-20, 2px) solid #000'
      },
      { solidColor: '#0F0' }
    )

    expect(result).toEqual({
      border: 'var(--border-width-20, 2px) solid #000'
    })
  })

  it('leaves border shorthand unchanged when no variable token is present', () => {
    const result = applyStrokeToCSS(
      {
        border: '2px dashed #000'
      },
      { solidColor: '#0F0' }
    )

    expect(result).toEqual({
      border: '2px dashed #000'
    })
  })

  it('updates stroke and outline fields when they use variable placeholders', () => {
    const gradientResult = applyStrokeToCSS(
      {
        stroke: 'var(--stroke)'
      },
      { gradient: 'linear-gradient(90deg, #F00, #00F)' }
    )
    expect(gradientResult).toEqual({
      stroke: 'linear-gradient(90deg, #F00, #00F)'
    })

    const solidResult = applyStrokeToCSS(
      {
        stroke: 'var(--stroke)',
        'outline-color': 'var(--stroke)'
      },
      { solidColor: '#0F0' }
    )
    expect(solidResult).toEqual({
      stroke: '#0F0',
      'outline-color': '#0F0'
    })
  })

  it('keeps variable placeholders unchanged when resolved style has no concrete color', () => {
    const result = applyStrokeToCSS(
      {
        border: '1px solid var(--stroke)',
        stroke: 'var(--stroke)',
        'outline-color': 'var(--stroke)'
      },
      {}
    )

    expect(result).toEqual({
      border: '1px solid var(--stroke)',
      stroke: 'var(--stroke)',
      'outline-color': 'var(--stroke)'
    })
  })

  it('keeps outline-color unchanged for gradient strokes', () => {
    const result = applyStrokeToCSS(
      {
        'outline-color': 'var(--stroke)'
      },
      { gradient: 'linear-gradient(90deg, #F00, #00F)' }
    )

    expect(result).toEqual({
      'outline-color': 'var(--stroke)'
    })
  })
})
