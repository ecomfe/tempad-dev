import { describe, expect, it, vi } from 'vitest'

vi.mock('@/mcp/tools/token/indexer', () => ({
  getVariableRawName: () => 'mock-variable'
}))

import { cleanFigmaSpecificStyles } from '@/mcp/tools/code/styles/background'

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
  it('converts solid background shorthand into background-color', () => {
    const style = { background: '#ff0000' }
    const node = createNode('FRAME')

    const result = cleanFigmaSpecificStyles(style, node)

    expect(result).toEqual({ 'background-color': '#ff0000' })
  })

  it('splits url + lightgray background shorthand and infers solid fill color', () => {
    const style = { background: 'url("image.png") lightgray 50% / cover no-repeat' }
    const node = createNode('RECTANGLE', {
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }]
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
