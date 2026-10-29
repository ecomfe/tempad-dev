import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/mcp/tools/token/indexer', () => ({
  getVariableRawName: () => 'mock-variable'
}))

import { cleanFigmaSpecificStyles } from '@/mcp/tools/code/styles/background'
import { resolveStylesFromNode } from '@/utils/figma-style/style-resolver'

function createNode(type: SceneNode['type'], overrides: Record<string, unknown> = {}): SceneNode {
  return {
    id: 'node-1',
    name: 'node-1',
    type,
    visible: true,
    ...overrides
  } as unknown as SceneNode
}

describe('mcp/tools/code/styles/background', () => {
  it.each([false, true])(
    'preserves image layers and URL text while removing fallbacks (resolve first: %s)',
    async (resolveFirst) => {
      const node = createNode('RECTANGLE', {
        fills: [
          { type: 'SOLID', color: { r: 1, g: 0, b: 0 } },
          { type: 'IMAGE', imageHash: 'back' },
          { type: 'IMAGE', imageHash: 'front' }
        ]
      })
      const front = 'url("folder/lightgray (a,b).png") left / cover no-repeat'
      const back = 'url("b.png") right / contain repeat'
      const style = {
        background:
          'url("folder/lightgray (a,b).png") lightgray left / cover no-repeat, ' +
          'url("b.png") lightgray right / contain repeat'
      }
      const resolved = resolveFirst ? await resolveStylesFromNode(style, node) : style
      const result = cleanFigmaSpecificStyles(resolved, node)
      expect(result).toEqual({
        background: `${front}, ${back}`,
        'background-color': '#F00'
      })
    }
  )

  it('corrects the matching gradient without replacing a foreground synthetic solid layer', () => {
    const node = createNode('FRAME', {
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          opacity: 0.5,
          gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 1, a: 1 } }]
        },
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }
      ]
    })
    expect(
      cleanFigmaSpecificStyles(
        { background: 'linear-gradient(#F00, #F00), linear-gradient(90deg, blue 0%, blue 100%)' },
        node
      ).background
    ).toBe('linear-gradient(#F00, #F00), linear-gradient(90deg, #0000FF80 0%, #0000FF80 100%)')
  })
  it('preserves media and every gradient layer when correcting stop opacity', () => {
    const gradient = {
      type: 'GRADIENT_LINEAR',
      opacity: 0.5,
      gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }]
    }
    const result = cleanFigmaSpecificStyles(
      {
        background:
          'linear-gradient(90deg, red, blue), url("photo.png") lightgray 50% / cover, linear-gradient(0deg, red, blue)'
      },
      createNode('FRAME', { fills: [gradient, { type: 'IMAGE' }, gradient] })
    )
    expect(result.background).toContain('url("photo.png") 50% / cover')
    expect(result.background?.match(/linear-gradient/g)).toHaveLength(2)
    expect(result.background).toContain('#FF000080')
    expect(result.background).not.toContain('lightgray')
  })

  it.each([
    [0.99, '99', '#0000FFFC'],
    [0.995, '99.5', '#0000FFFE']
  ] as const)(
    'preserves paint opacity %s and native geometry on a gradient above an image',
    async (opacity, percentage, literal) => {
      vi.stubGlobal('figma', {
        variables: { getVariableById: () => ({ name: 'Accent' }) }
      })
      const node = createNode('RECTANGLE', {
        fills: [
          { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' },
          {
            type: 'GRADIENT_LINEAR',
            opacity,
            gradientStops: [
              {
                position: 0,
                color: { r: 1, g: 0, b: 0, a: 1 },
                boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'accent' } }
              },
              { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
            ]
          }
        ]
      })
      const style = await resolveStylesFromNode(
        {
          background:
            'linear-gradient(37deg, var(--Accent) 25%, blue 75%), url("photo.png") 50% / cover'
        },
        node
      )

      expect(cleanFigmaSpecificStyles(style, node).background).toBe(
        `linear-gradient(37deg, color-mix(in srgb, var(--Accent) ${percentage}%, transparent) 25%, ${literal} 75%), url("photo.png") 50% / cover`
      )
    }
  )

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('converts solid background shorthand into background-color', () => {
    const style = { background: '#ff0000' }
    const node = createNode('FRAME')

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result).toEqual({ 'background-color': '#ff0000' })
  })

  it('splits url + lightgray background shorthand and infers solid fill color', () => {
    const style = { background: 'url("image.png") lightgray 50% / cover no-repeat' }
    const node = createNode('RECTANGLE', {
      fills: [
        { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 },
        { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' }
      ]
    })

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result.background).toBeUndefined()
    expect(result['background-image']).toContain('url("image.png")')
    expect(result['background-position']).toBe('50%')
    expect(result['background-size']).toBe('cover')
    expect(result['background-repeat']).toBe('no-repeat')
    expect(result['background-color']).toBe('#F00')
  })

  it('replaces var-only background with gradient from node fills', () => {
    const style = { background: 'var(--token-bg)' }
    const node = createNode('FRAME', {
      fills: [
        {
          type: 'GRADIENT_RADIAL',
          visible: true,
          opacity: 1,
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
          ]
        }
      ]
    })

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result.background?.startsWith('radial-gradient(')).toBe(true)
  })

  it('preserves multiple visible solid fills as layered background output', () => {
    const style = { background: 'var(--token-bg)' }
    const node = createNode('FRAME', {
      fills: [
        { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 },
        { type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }
      ]
    })

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result).toEqual({
      background: 'linear-gradient(#0F0, #0F0), linear-gradient(#F00, #F00)'
    })
  })

  it('removes getCSSAsync lightgray fallback without recreating it as a background layer', () => {
    const style = { background: 'url("image.png") lightgray 50% / cover no-repeat' }
    const node = createNode('RECTANGLE', {
      fills: [
        { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 },
        { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' },
        { type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }
      ]
    })

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result.background).toBeUndefined()
    expect(result['background-image']).toContain('url("image.png")')
    expect(result['background-position']).toBe('50%')
    expect(result['background-size']).toBe('cover')
    expect(result['background-repeat']).toBe('no-repeat')
    expect(result['background-color']).toBe('#F00')
    expect(JSON.stringify(result)).not.toContain('lightgray')
  })

  it.each([
    { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 0.5 },
    { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, blendMode: 'MULTIPLY' },
    { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' },
    {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 1, a: 1 } }]
    }
  ])('does not use a foreground solid as the background color when the base is %j', (base) => {
    const result = cleanFigmaSpecificStyles(
      { background: 'url("image.png") lightgray 50% / cover no-repeat' },
      createNode('RECTANGLE', {
        fills: [base, { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
      })
    )
    expect(result['background-color']).toBeUndefined()
    expect(result['background-image']).toContain('url("image.png")')
    expect(JSON.stringify(result)).not.toContain('lightgray')
  })

  it('keeps a bound base color below a separate image channel, ignoring hidden paints', () => {
    vi.stubGlobal('figma', {
      variables: { getVariableById: () => ({ name: 'base' }) }
    })
    const result = cleanFigmaSpecificStyles(
      { 'background-image': 'url("image.png")' },
      createNode('RECTANGLE', {
        fills: [
          { type: 'SOLID', visible: false, color: { r: 0, g: 1, b: 0 } },
          {
            type: 'SOLID',
            color: { r: 1, g: 0, b: 0 },
            boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'base' } }
          },
          { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL' }
        ]
      })
    )
    expect(result).toEqual({
      'background-image': 'url("image.png")',
      'background-color': 'var(--base)'
    })
  })

  it('uses fill style paints before direct node fills for lightgray fallback cleanup', () => {
    vi.stubGlobal('figma', {
      getStyleById: vi.fn((id: string) =>
        id === 'fill-style'
          ? ({
              paints: [{ type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }]
            } as unknown as PaintStyle)
          : null
      ),
      variables: {
        getVariableById: vi.fn(() => null)
      }
    })

    const style = { background: 'url("image.png") lightgray 50% / cover no-repeat' }
    const node = createNode('RECTANGLE', {
      fillStyleId: 'fill-style',
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }]
    })

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result['background-color']).toBe('#0F0')
  })

  it('uses fill style paints before direct node fills for layered background resolution', () => {
    vi.stubGlobal('figma', {
      getStyleById: vi.fn((id: string) =>
        id === 'fill-style'
          ? ({
              paints: [
                { type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 },
                { type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 1 }, opacity: 1 }
              ]
            } as unknown as PaintStyle)
          : null
      ),
      variables: {
        getVariableById: vi.fn(() => null)
      }
    })

    const style = { background: 'var(--token-bg)' }
    const node = createNode('RECTANGLE', {
      fillStyleId: 'fill-style',
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }]
    })

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result).toEqual({
      background: 'linear-gradient(#00F, #00F), linear-gradient(#0F0, #0F0)'
    })
  })

  it('injects layered background output when background channels are missing', () => {
    const node = createNode('RECTANGLE', {
      fills: [
        { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 },
        { type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }
      ]
    })

    const result = cleanFigmaSpecificStyles({}, node)

    expect(result).toEqual({
      background: 'linear-gradient(#0F0, #0F0), linear-gradient(#F00, #F00)'
    })
  })

  it('injects layered background output from fill style paints when direct fills are missing', () => {
    vi.stubGlobal('figma', {
      getStyleById: vi.fn((id: string) =>
        id === 'fill-style'
          ? ({
              paints: [
                { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 },
                { type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }
              ]
            } as unknown as PaintStyle)
          : null
      ),
      variables: {
        getVariableById: vi.fn(() => null)
      }
    })

    const node = createNode('RECTANGLE', {
      fillStyleId: 'fill-style'
    })

    const result = cleanFigmaSpecificStyles({}, node)

    expect(result).toEqual({
      background: 'linear-gradient(#0F0, #0F0), linear-gradient(#F00, #F00)'
    })
  })

  it('fills missing background-color for non-text nodes only', () => {
    const frameStyle = {}
    const frame = createNode('RECTANGLE', {
      fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }]
    })
    const frameResult = cleanFigmaSpecificStyles(frameStyle, frame)
    expect(frameResult['background-color']).toBe('#0F0')

    const textStyle = {}
    const text = createNode('TEXT', {
      characters: 'hello',
      fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 }, opacity: 1 }]
    })
    const textResult = cleanFigmaSpecificStyles(textStyle, text)
    expect(textResult['background-color']).toBeUndefined()
    expect(textResult.background).toBeUndefined()
  })
})
