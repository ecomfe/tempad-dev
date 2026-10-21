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
  { name: 'hard paragraphs', characters: 'Hello\nHello', indents: [12, 12], rows: [0, 36] },
  { name: 'soft line break', characters: 'Hello\u2028Hello', indents: [12, 12], rows: [0, 24] },
  {
    name: 'soft then hard breaks',
    characters: 'Hello\u2028Hello\nHello',
    indents: [12, 12, 12],
    rows: [0, 24, 60]
  },
  {
    name: 'consecutive soft breaks',
    characters: 'Hello\u2028\u2028Hello',
    indents: [12, 12],
    rows: [0, 48]
  },
  {
    name: 'whitespace-only soft line',
    characters: 'Hello\u2028   \u2028Hello',
    indents: [12, 12],
    rows: [0, 48]
  },
  { name: 'leading soft break', characters: '\u2028Hello', indents: [12], rows: [24] },
  { name: 'trailing soft break', characters: 'Hello\u2028', indents: [12], rows: [0], height: 48 },
  { name: 'trailing hard break', characters: 'Hello\n', indents: [12], rows: [0], height: 60 },
  {
    name: 'repeated trailing hard breaks',
    characters: 'Hello\n\n',
    indents: [12],
    rows: [0],
    height: 96
  },
  {
    name: 'hard-break-only text',
    characters: '\n',
    indents: [],
    rows: [],
    height: 60
  },
  {
    name: 'trailing whitespace-only soft line',
    characters: 'Hello\u2028   ',
    indents: [12],
    rows: [0],
    height: 48
  },
  {
    name: 'automatic wrapping inside soft lines',
    characters: 'Hello Hello Hello Hello\u2028Hello Hello Hello Hello',
    indents: [12, 0, 12, 0],
    rows: [0, 24, 48, 72]
  },
  {
    name: 'zero-indent trailing soft break',
    characters: 'Hello\u2028',
    paragraphIndent: 0,
    indents: [0],
    rows: [0],
    height: 48
  },
  {
    name: 'zero-indent trailing soft whitespace',
    characters: 'Hello\u2028  ',
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [0],
    rows: [0],
    height: 48
  },
  {
    name: 'compact soft then hard breaks',
    characters: 'Hello\u2028\nHello',
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [0, 0],
    rows: [0, 48],
    height: 72
  },
  {
    name: 'compact trailing hard break',
    characters: 'Hello\n',
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [0],
    rows: [0],
    height: 48
  },
  {
    name: 'compact repeated trailing hard breaks',
    characters: 'Hello\n\n',
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [0],
    rows: [0],
    height: 72
  },
  {
    name: 'compact hard-break-only text',
    characters: '\n',
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [],
    rows: [],
    height: 48
  },
  {
    name: 'soft then terminal hard break',
    characters: 'Hello\u2028\n',
    indents: [12],
    rows: [0],
    height: 84
  },
  {
    name: 'zero-indent soft then spaced hard breaks',
    characters: 'Hello\u2028\nHello',
    paragraphIndent: 0,
    indents: [0, 0],
    rows: [0, 60],
    height: 84
  },
  {
    name: 'list item trailing soft break',
    characters: 'Hello\u2028\nHello',
    listType: 'UNORDERED',
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [20, 20],
    rows: [0, 48],
    height: 72
  },
  {
    name: 'trailing list without an external paragraph gap',
    characters: 'Hello\nHello',
    listType: 'UNORDERED',
    paragraphIndent: 0,
    indents: [20, 20],
    rows: [0, 24],
    height: 48
  },
  {
    name: 'terminal empty ordered item',
    characters: 'Hello\n',
    listType: 'ORDERED',
    paragraphIndent: 0,
    indents: [20],
    rows: [0],
    height: 48
  },
  {
    name: 'repeated terminal empty ordered items',
    characters: 'Hello\n\n',
    listType: 'ORDERED',
    paragraphIndent: 0,
    indents: [20],
    rows: [0],
    height: 72
  },
  {
    name: 'leading deeper ordered item',
    characters: 'Hello\nHello\nHello',
    listType: 'ORDERED',
    indentations: [2, 1, 2],
    paragraphIndent: 0,
    paragraphSpacing: 0,
    indents: [40, 20, 40],
    rows: [0, 24, 48],
    height: 72
  }
])('renders paragraph geometry with $name', async (scenario) => {
  const {
    characters,
    indents,
    rows,
    height,
    paragraphIndent = 12,
    paragraphSpacing = 12,
    listType = 'NONE',
    indentations
  } = scenario
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: { getVariableById: () => null, getVariableCollectionById: () => null },
    getStyleById: () => null
  })
  const fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
  const segment = {
    fontName: { family: 'Inter', style: 'Regular' },
    fontWeight: 400,
    fontSize: 16,
    lineHeight: { unit: 'PIXELS', value: 24 },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    paragraphIndent,
    paragraphSpacing,
    listOptions: { type: listType },
    indentation: 0,
    fills
  }
  const textParts = indentations ? characters.split('\n') : [characters]
  let start = 0
  const segments = textParts.map((text, index) => {
    const characters = `${text}${index < textParts.length - 1 ? '\n' : ''}`
    const result = {
      ...segment,
      characters,
      start,
      end: start + characters.length,
      indentation: indentations?.[index] ?? 0
    }
    start = result.end
    return result
  })
  const node = {
    id: 'paragraphs',
    type: 'TEXT',
    name: 'Paragraph geometry',
    visible: true,
    characters,
    x: 0,
    y: 0,
    width: 120,
    height: 100,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 100 },
    absoluteRenderBounds: { x: 0, y: 0, width: 120, height: 100 },
    fills,
    strokes: [],
    effects: [],
    getRangeBoundVariable: () => null,
    getStyledTextSegments: (fields: string[]) =>
      segments.map(({ characters, start, end, ...values }) => ({
        characters,
        start,
        end,
        ...Object.fromEntries(Object.entries(values).filter(([key]) => fields.includes(key)))
      })),
    getCSSAsync: async () => ({ width: '120px', height: '100px' })
  } as unknown as TextNode
  const result = await handleGetCode([node], 'vue')

  // Tailwind's preflight and the emitted geometry utilities control actual layout.
  const style = document.createElement('style')
  style.textContent = `
    p, ol, ul { margin: 0; padding: 0; }
    .block { display: block; }
    .list-none { list-style-type: none; }
    .${CSS.escape('pl-[1.2em]')} { padding-left: 20px; }
    .${CSS.escape('indent-[12px]')} { text-indent: 12px; }
    .${CSS.escape('mb-[12px]')} { margin-bottom: 12px; }
  `
  const host = document.createElement('div')
  host.style.cssText = 'display:flow-root;width:120px;font:16px/24px monospace'
  host.innerHTML = result.code
  const reference = document.createElement('div')
  reference.style.cssText = host.style.cssText
  reference.textContent = 'Hello'
  document.body.append(style, host, reference)

  // Compare glyph positions against the same font's unindented first line.
  const referenceRange = document.createRange()
  referenceRange.selectNodeContents(reference)
  const glyphTop =
    referenceRange.getBoundingClientRect().top - reference.getBoundingClientRect().top

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const positions: DOMRect[] = []
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent ?? ''
    for (const match of text.matchAll(/Hello/g)) {
      const range = document.createRange()
      range.setStart(walker.currentNode, match.index)
      range.setEnd(walker.currentNode, match.index + 5)
      const position = range.getBoundingClientRect()
      if (position.top !== positions.at(-1)?.top) positions.push(position)
    }
  }
  expect(positions).toHaveLength(rows.length)
  const origin = host.getBoundingClientRect()
  expect(positions.map((position) => position.left - origin.left)).toEqual(indents)
  expect(positions.map((position) => position.top - origin.top - glyphTop)).toEqual(rows)
  if (height !== undefined) expect(origin.height).toBe(height)
  if (indentations) {
    const placeholder = host.querySelector('ol > li') as HTMLLIElement
    expect(getComputedStyle(placeholder).listStyleType).toBe('none')
    expect(placeholder.value).toBe(0)
    expect(placeholder.nextElementSibling?.getAttribute('value')).toBeNull()
    expect(placeholder.querySelector('ol > li')).not.toBeNull()
  }
})
