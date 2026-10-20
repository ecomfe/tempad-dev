import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

beforeEach(() => {
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: { getVariableById: () => null, getVariableCollectionById: () => null },
    getStyleById: () => null
  })
})

afterEach(() => vi.unstubAllGlobals())

function createText(listTypes: Array<'NONE' | 'ORDERED' | 'UNORDERED'>): TextNode {
  const fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
  let offset = 0
  const segments = listTypes.map((type, index) => {
    const characters = `${index === 0 ? 'First' : 'Second'}${index < listTypes.length - 1 ? '\n' : ''}`
    const start = offset
    offset += characters.length
    return {
      characters,
      start,
      end: offset,
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      fontWeight: 400,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      textDecoration: 'NONE',
      listOptions: { type },
      indentation: 1,
      paragraphSpacing: 0,
      fills
    }
  })
  return {
    id: 'text',
    type: 'TEXT',
    name: 'Text blocks',
    characters: segments.map(({ characters }) => characters).join(''),
    visible: true,
    x: 0,
    y: 0,
    width: 472,
    height: 80,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 472, height: 80 },
    absoluteRenderBounds: { x: 0, y: 0, width: 472, height: 80 },
    fills,
    strokes: [],
    effects: [],
    getRangeBoundVariable: () => null,
    getStyledTextSegments: () => segments,
    getCSSAsync: async () => ({ width: '472px', height: '80px' })
  } as unknown as TextNode
}

describe.each(['jsx', 'vue'] as const)('%s native text blocks', (lang) => {
  it('keeps a list and ordinary text inside a legal layout container without a plugin', async () => {
    const result = await handleGetCode([createText(['UNORDERED', 'NONE'])], lang)
    expect(result.codegen.plugin).toBe('none')
    expect(result.code).toMatch(/^<div\b[^>]*w-\[472px\][^>]*h-\[80px\]/)
    expect(result.code).toMatch(/<ul\b[\s\S]*<li\b[^>]*>First<\/li>[\s\S]*<\/ul>/)
    expect(result.code.trim()).toMatch(/<\/ul>[\s\S]*<span\b[^>]*>Second<\/span>\s*<\/div>$/)
    expect(result.code).not.toContain('<p')
  })

  it('keeps adjacent ordered and unordered lists as siblings', async () => {
    const result = await handleGetCode([createText(['ORDERED', 'UNORDERED'])], lang)
    expect(result.code).toMatch(/^<div\b/)
    expect(result.code).toMatch(/<ol\b[\s\S]*First<\/li>[\s\S]*<\/ol>[\s\S]*<ul\b/)
    expect(result.code.trim()).toMatch(/Second<\/li>[\s\S]*<\/ul>\s*<\/div>$/)
    expect(result.code).not.toContain('<p')
  })

  it.each([
    { listTypes: ['UNORDERED'] as const, tag: 'ul' },
    { listTypes: ['NONE'] as const, tag: 'span' },
    { listTypes: ['NONE', 'NONE'] as const, tag: 'p' }
  ])('preserves a single $tag block and its layout props', async ({ listTypes, tag }) => {
    const result = await handleGetCode([createText([...listTypes])], lang)
    expect(result.code).toMatch(new RegExp(`^<${tag}\\b[^>]*w-\\[472px\\][^>]*h-\\[80px\\]`))
    expect(result.code.trim()).toMatch(new RegExp(`</${tag}>$`))
    expect(result.code).not.toContain('<div')
    expect(result.code).toContain('First')
  })
})
