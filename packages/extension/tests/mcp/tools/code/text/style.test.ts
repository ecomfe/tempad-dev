import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StyledTextSegmentSubset } from '@/mcp/tools/code/text/types'

import {
  computeDominantStyle,
  inferFontWeight,
  isCodeFont,
  omitCommon,
  resolveRunAttrs,
  resolveTokens
} from '@/mcp/tools/code/text/style'

type FigmaMock = {
  mixed: symbol
  getStyleById: ReturnType<typeof vi.fn>
  variables: {
    getVariableById: ReturnType<typeof vi.fn>
  }
}

function createSegment(overrides: Record<string, unknown> = {}) {
  return {
    characters: 'Hello',
    start: 0,
    end: 5,
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'NORMAL',
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PIXELS', value: 1.5 },
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    paragraphSpacing: 0,
    indentation: 1,
    listOptions: { type: 'NONE' },
    fills: [],
    textStyleId: null,
    fillStyleId: null,
    boundVariables: {},
    hyperlink: null,
    ...overrides
  } as unknown as StyledTextSegmentSubset
}

function setupFigmaMock({
  styleById = {},
  variableById = {}
}: {
  styleById?: Record<string, unknown>
  variableById?: Record<string, { id: string; name: string } | null>
} = {}) {
  const getStyleById = vi.fn((id: string) => styleById[id] ?? null)
  const getVariableById = vi.fn((id: string) => {
    if (id === 'throws') {
      throw new Error('lookup failed')
    }
    return variableById[id] ?? null
  })
  const figmaMock: FigmaMock = {
    mixed: Symbol('mixed'),
    getStyleById,
    variables: { getVariableById }
  }

  ;(globalThis as { figma?: FigmaMock }).figma = figmaMock
  return figmaMock
}

describe('mcp/code text style', () => {
  beforeEach(() => {
    delete (globalThis as { figma?: unknown }).figma
  })

  it('builds run attrs from tokens and text decorations', () => {
    const segment = createSegment({
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE'
    })

    const attrs = resolveRunAttrs(
      segment as never,
      {
        fontFamily: { id: 'f1', name: 'Type/Body' },
        fontSize: { id: 'f2', name: 'Size/Body' },
        fontWeight: { id: 'f3', name: 'Weight/Semibold' },
        lineHeight: { id: 'f4', name: 'Line/Body' },
        letterSpacing: { id: 'f5', name: 'Tracking/Body' }
      },
      [
        {
          type: 'SOLID',
          token: { id: 'color1', name: 'Color/Primary' },
          raw: {
            type: 'SOLID',
            visible: true,
            color: { r: 1, g: 0, b: 0 },
            opacity: 1
          } as SolidPaint
        }
      ]
    )

    expect(attrs).toMatchObject({
      color: 'var(--Color-Primary)',
      'font-family': 'var(--Type-Body)',
      'font-size': 'var(--Size-Body)',
      'font-weight': 'var(--Weight-Semibold)',
      'line-height': 'var(--Line-Body)',
      'letter-spacing': 'var(--Tracking-Body)',
      'text-transform': 'uppercase',
      'text-decoration-line': 'underline'
    })
  })

  it('falls back to normalized literal attrs when token refs are absent', () => {
    const segment = createSegment({
      fontName: { family: 'Inter', style: 'SemiBold' },
      fontSize: 13.3333,
      fontWeight: undefined,
      lineHeight: { unit: 'PERCENT', value: 120.1234 },
      letterSpacing: { unit: 'PERCENT', value: 5.4321 },
      textCase: 'LOWER',
      textDecoration: 'STRIKETHROUGH'
    })

    const attrs = resolveRunAttrs(segment as never, {}, [])

    expect(attrs).toMatchObject({
      color: 'transparent',
      'font-family': 'Inter',
      'font-size': '13.333px',
      'line-height': '120.123%',
      'letter-spacing': '5.432%',
      'text-transform': 'lowercase',
      'text-decoration-line': 'strikethrough'
    })
  })

  it('uses default opacity for visible solid paint when opacity is omitted', () => {
    const segment = createSegment({
      fontName: { family: '', style: '' },
      fontSize: undefined,
      fontWeight: undefined
    })

    const attrs = resolveRunAttrs(segment as never, {}, [
      {
        type: 'SOLID',
        raw: {
          type: 'SOLID',
          visible: true,
          color: { r: 0, g: 1, b: 0 }
        } as SolidPaint
      }
    ])

    expect(attrs.color?.toLowerCase()).toBe('#0f0')
  })

  it('ignores invisible fills and preserves transparent when no visible paints exist', () => {
    const segment = createSegment({
      textCase: 'SMALL_CAPS',
      textDecoration: 'NONE',
      letterSpacing: { unit: 'PERCENT' },
      lineHeight: { unit: 'PIXELS' }
    })

    const attrs = resolveRunAttrs(segment as never, {}, [
      {
        type: 'SOLID',
        raw: { type: 'SOLID', visible: false, color: { r: 0, g: 0, b: 0 }, opacity: 1 } as Paint
      },
      {
        type: 'GRADIENT_LINEAR',
        raw: {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 0 } }],
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0]
          ]
        } as unknown as Paint
      }
    ] as never)

    expect(attrs).toEqual({
      color: 'transparent',
      'font-family': 'Inter',
      'font-size': '16px',
      'font-weight': '400'
    })
  })

  it('does not force transparent when a visible non-solid paint exists', () => {
    const segment = createSegment({
      fontName: { family: '', style: '' },
      fontSize: undefined,
      fontWeight: undefined
    })
    const attrs = resolveRunAttrs(segment as never, {}, [
      {
        type: 'GRADIENT_LINEAR',
        raw: {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          gradientStops: [{ position: 1, color: { r: 1, g: 0, b: 0, a: 1 } }],
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0]
          ]
        } as unknown as Paint
      }
    ] as never)
    expect(attrs.color).toBeUndefined()
  })

  it('treats zero-opacity paint as invisible and supports AUTO line-height', () => {
    const segment = createSegment({
      lineHeight: { unit: 'AUTO' },
      letterSpacing: undefined
    })

    const attrs = resolveRunAttrs(segment as never, {}, [
      {
        type: 'GRADIENT_LINEAR',
        raw: {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 0,
          gradientStops: [{ position: 1, color: { r: 1, g: 0, b: 0, a: 1 } }],
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0]
          ]
        } as unknown as Paint
      }
    ] as never)

    expect(attrs).toMatchObject({
      color: 'transparent',
      'line-height': 'normal'
    })
    expect(attrs['letter-spacing']).toBeUndefined()
  })

  it('supports missing line-height/text-case and gradient stops without color alpha', () => {
    const segment = createSegment({
      textCase: undefined,
      lineHeight: undefined,
      fontName: { family: 'Inter', style: undefined },
      fontWeight: undefined
    })

    const attrs = resolveRunAttrs(
      segment as never,
      {
        fontWeight: { id: 'fw', name: 'Weight/Body' }
      },
      [
        {
          type: 'GRADIENT_LINEAR',
          raw: {
            type: 'GRADIENT_LINEAR',
            visible: true,
            opacity: 1,
            gradientStops: [{ position: 0.5 }],
            gradientTransform: [
              [1, 0, 0],
              [0, 1, 0]
            ]
          } as unknown as Paint
        }
      ] as never
    )

    expect(attrs['line-height']).toBeUndefined()
    expect(attrs['text-transform']).toBeUndefined()
    expect(attrs['font-weight']).toBe('var(--Weight-Body)')
  })

  it('resolves typography and fill tokens from segment/style/range bindings', () => {
    const figmaMock = setupFigmaMock({
      styleById: {
        style1: {
          boundVariables: {
            fontSize: { id: 'var-font-size' }
          }
        }
      },
      variableById: {
        'var-font-family': { id: 'var-font-family', name: 'Type/Body' },
        'var-font-size': { id: 'var-font-size', name: 'Size/Body' },
        'var-line-height': { id: 'var-line-height', name: 'Line/Body' },
        'var-fill-color': { id: 'var-fill-color', name: 'Color/Primary' }
      }
    })

    const getRangeBoundVariable = vi.fn((_start: number, _end: number, field: string) => {
      if (field === 'lineHeight') {
        return { id: 'var-line-height' }
      }
      return figmaMock.mixed
    })

    const segment = createSegment({
      textStyleId: 'style1',
      boundVariables: {
        fontFamily: { id: 'var-font-family' }
      },
      fills: [
        {
          type: 'SOLID',
          boundVariables: { color: { id: 'var-fill-color' } }
        },
        { type: 'IMAGE' }
      ]
    })

    const result = resolveTokens({ getRangeBoundVariable } as never, segment as never)

    expect(result.typography).toEqual({
      fontFamily: { id: 'var-font-family', name: 'Type/Body' },
      fontSize: { id: 'var-font-size', name: 'Size/Body' },
      lineHeight: { id: 'var-line-height', name: 'Line/Body' }
    })
    expect(result.fills).toEqual([
      {
        type: 'SOLID',
        token: { id: 'var-fill-color', name: 'Color/Primary' },
        raw: segment.fills[0]
      },
      {
        type: 'IMAGE',
        raw: segment.fills[1]
      }
    ])
  })

  it('handles style/range/variable lookup failures in token resolution', () => {
    setupFigmaMock({
      styleById: {},
      variableById: {
        ok: { id: 'ok', name: 'Token/Ok' }
      }
    })
    ;(globalThis as unknown as { figma: FigmaMock }).figma.getStyleById.mockImplementation(() => {
      throw new Error('style lookup failed')
    })

    const getRangeBoundVariable = vi.fn((_start: number, _end: number, field: string) => {
      if (field === 'fontFamily') return { id: 'throws' }
      if (field === 'fontSize') return { id: 'ok' }
      throw new Error('range lookup failed')
    })

    const segment = createSegment({
      textStyleId: 'broken-style',
      boundVariables: {
        fontWeight: { id: 'throws' }
      },
      fills: [
        {
          type: 'SOLID',
          boundVariables: { color: { id: 'throws' } }
        }
      ]
    })

    const result = resolveTokens({ getRangeBoundVariable } as never, segment as never)

    expect(result.typography).toEqual({
      fontSize: { id: 'ok', name: 'Token/Ok' }
    })
    expect(result.fills[0]).toMatchObject({ type: 'SOLID', token: null })
  })

  it('drops aliases when variable lookup returns null', () => {
    setupFigmaMock()

    const segment = createSegment({
      boundVariables: {
        fontFamily: { id: 'missing' }
      }
    })

    const result = resolveTokens(
      {
        getRangeBoundVariable: vi.fn(() => undefined)
      } as never,
      segment as never
    )

    expect(result.typography).toEqual({})
  })

  it('treats non-array fills as empty in token resolution', () => {
    setupFigmaMock()

    const segment = createSegment({
      fills: 'not-an-array'
    })

    const result = resolveTokens(
      {
        getRangeBoundVariable: vi.fn(() => undefined)
      } as never,
      segment as never
    )

    expect(result.fills).toEqual([])
  })

  it('returns dominant styles above threshold using canonicalized values', () => {
    const dominant = computeDominantStyle([
      { style: { color: '#fff', 'font-size': '12px' }, weight: 1 },
      { style: { color: '#ffffff' }, weight: 2 },
      { style: { 'font-size': '10px' }, weight: 1 }
    ])

    expect(dominant).toEqual({
      color: '#fff'
    })
  })

  it('returns empty dominant style for empty input', () => {
    expect(computeDominantStyle([])).toEqual({})
  })

  it('omits common styles using canonicalized equality', () => {
    expect(
      omitCommon(
        {
          color: '#ffffff',
          'letter-spacing': '0px',
          'font-size': '16px'
        },
        {
          color: '#fff',
          'letter-spacing': '0'
        }
      )
    ).toEqual({
      'font-size': '16px'
    })
  })

  it('returns original object when common style is empty', () => {
    const style = { color: '#fff' }
    expect(omitCommon(style, {})).toBe(style)
  })

  it('detects code-like font families', () => {
    expect(isCodeFont('Source Code Pro')).toBe(true)
    expect(isCodeFont('Inter')).toBe(false)
  })

  it('infers font weight from explicit, numeric and keyword forms', () => {
    expect(inferFontWeight('Regular', 500)).toBe(500)
    expect(inferFontWeight('SemiBold 650', undefined)).toBe(650)
    expect(inferFontWeight('ExtraBold', undefined)).toBe(800)
    expect(inferFontWeight('Book', undefined)).toBeUndefined()
    expect(inferFontWeight(undefined, undefined)).toBeUndefined()
  })
})
