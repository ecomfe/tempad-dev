import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it.each([
  { name: 'hard paragraph', separator: '\n', expectedIndent: 12, expectedGap: 36 },
  { name: 'soft line break', separator: '\u2028', expectedIndent: 0, expectedGap: 24 }
])(
  'renders paragraph geometry across a $name',
  async ({ separator, expectedIndent, expectedGap }) => {
    vi.stubGlobal('__DEV__', false)
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      variables: { getVariableById: () => null, getVariableCollectionById: () => null },
      getStyleById: () => null
    })
    const characters = `Hello${separator}Hello`
    const fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
    const segment = {
      fontName: { family: 'Inter', style: 'Regular' },
      fontWeight: 400,
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      paragraphIndent: 12,
      paragraphSpacing: 12,
      listOptions: { type: 'NONE' },
      indentation: 0,
      fills
    }
    const node = {
      id: 'paragraphs',
      type: 'TEXT',
      name: 'Paragraph geometry',
      visible: true,
      characters,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
      absoluteRenderBounds: { x: 0, y: 0, width: 200, height: 100 },
      fills,
      strokes: [],
      effects: [],
      getRangeBoundVariable: () => null,
      getStyledTextSegments: (fields: string[]) => [
        {
          characters,
          start: 0,
          end: characters.length,
          ...Object.fromEntries(Object.entries(segment).filter(([key]) => fields.includes(key)))
        }
      ],
      getCSSAsync: async () => ({ width: '200px', height: '100px' })
    } as unknown as TextNode
    const result = await handleGetCode([node], 'vue')

    // Tailwind's preflight and the emitted geometry utilities control actual layout.
    const style = document.createElement('style')
    style.textContent = `
    p { margin: 0; }
    .${CSS.escape('indent-[12px]')} { text-indent: 12px; }
    .${CSS.escape('mb-[12px]')} { margin-bottom: 12px; }
  `
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;font:16px/24px monospace'
    host.innerHTML = result.code
    document.body.append(style, host)

    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const positions: DOMRect[] = []
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ?? ''
      const start = text.indexOf('Hello')
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(walker.currentNode, start)
      range.setEnd(walker.currentNode, start + 5)
      positions.push(range.getBoundingClientRect())
    }
    expect(positions).toHaveLength(2)
    const origin = host.getBoundingClientRect()
    expect(positions[0]!.left - origin.left).toBe(12)
    expect(positions[1]!.left - origin.left).toBe(expectedIndent)
    expect(positions[1]!.top - positions[0]!.top).toBe(expectedGap)
  }
)
