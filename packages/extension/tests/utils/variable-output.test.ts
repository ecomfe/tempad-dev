import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serializeCSS } from '@/utils/css'
import { collectNodeVariableIds, TEXT_VARIABLE_FIELDS } from '@/utils/figma-variables'
import {
  formatNodeStyleForPluginVariables,
  formatNodeStyleForMcp,
  formatNodeStyleForUi
} from '@/utils/variable-output'

type FigmaMock = {
  mixed: symbol
  getStyleById: ReturnType<typeof vi.fn>
  variables: {
    getVariableById: ReturnType<typeof vi.fn>
  }
}

function createVariable(id: string, name: string, codeSyntax?: string): Variable {
  return {
    id,
    name,
    ...(codeSyntax ? { codeSyntax: { WEB: codeSyntax } } : {})
  } as unknown as Variable
}

function createTextNode(overrides: Record<string, unknown> = {}): TextNode {
  return {
    id: 'text-node',
    type: 'TEXT',
    visible: true,
    characters: 'Hello world',
    boundVariables: {
      width: { id: 'size-card' },
      height: { id: 'size-tall' }
    },
    fills: [
      {
        type: 'SOLID',
        visible: true,
        color: { r: 1, g: 0, b: 0 },
        opacity: 1,
        boundVariables: { color: { id: 'color-brand' } }
      }
    ],
    getRangeBoundVariable: vi.fn(
      (_start: number, _end: number, field: VariableBindableTextField) =>
        field === 'fontFamily' ? { id: 'font-body' } : figma.mixed
    ),
    ...overrides
  } as unknown as TextNode
}

function setupFigma({
  variableById = {},
  styleById = {}
}: {
  variableById?: Record<string, Variable | null>
  styleById?: Record<string, unknown>
} = {}) {
  const figmaMock: FigmaMock = {
    mixed: Symbol('mixed'),
    getStyleById: vi.fn((id: string) => styleById[id] ?? null),
    variables: {
      getVariableById: vi.fn((id: string) => variableById[id] ?? null)
    }
  }

  ;(globalThis as { figma?: FigmaMock }).figma = figmaMock
  return figmaMock
}

describe('utils/variable-output', () => {
  beforeEach(() => {
    delete (globalThis as { figma?: unknown }).figma
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { figma?: unknown }).figma
  })

  it('prefers exact WEB codeSyntax for UI output and leaves missing codeSyntax untouched', () => {
    setupFigma({
      variableById: {
        'color-brand': createVariable('color-brand', '--brand-color', ' tokens.color.brand '),
        'font-body': createVariable('font-body', '--font-body', 'theme.fonts.body'),
        'size-card': createVariable('size-card', '--size-card', 'theme.sizes.card'),
        'size-tall': createVariable('size-tall', '--size-tall')
      }
    })

    const node = createTextNode()
    const result = formatNodeStyleForUi(
      {
        color: 'var(--brand-color, #F00)',
        background: 'linear-gradient(var(--brand-color, #F00), #000)',
        'font-family': 'Inter',
        width: '320px',
        height: '240px'
      },
      node
    )

    expect(result.style).toEqual({
      color: 'var(--brand-color)',
      background: 'linear-gradient(var(--brand-color), #000)',
      'font-family': 'var(--font-body)',
      width: 'var(--size-card)',
      height: '240px'
    })
    expect(result.variableSyntax).toEqual({
      '--brand-color': ' tokens.color.brand ',
      '--font-body': 'theme.fonts.body',
      '--size-card': 'theme.sizes.card'
    })
    expect(
      serializeCSS(
        result.style,
        { useRem: false, rootFontSize: 16, scale: 1 },
        {},
        { variableSyntax: result.variableSyntax }
      )
    ).toBe(
      [
        'color:  tokens.color.brand ;',
        'background: linear-gradient( tokens.color.brand , #000);',
        'font-family: theme.fonts.body;',
        'width: theme.sizes.card;',
        'height: 240px;'
      ].join('\n')
    )
  })

  it('preserves WEB codeSyntax through UI CSS serialization', () => {
    setupFigma({
      variableById: {
        spacing: createVariable('spacing', 'Spacing 1', '$spacing-1')
      }
    })

    const node = {
      id: 'frame-node',
      type: 'FRAME',
      visible: true,
      boundVariables: {
        width: { id: 'spacing' }
      }
    } as unknown as SceneNode
    const result = formatNodeStyleForUi({ width: '4px' }, node)

    expect(
      serializeCSS(
        result.style,
        { useRem: false, rootFontSize: 16, scale: 1 },
        {},
        { variableSyntax: result.variableSyntax }
      )
    ).toBe('width: $spacing-1;')
  })

  it('emits canonical CSS variables for MCP output regardless of codeSyntax', () => {
    setupFigma({
      variableById: {
        'color-brand': createVariable('color-brand', '--brand-color', 'tokens.color.brand'),
        'font-body': createVariable('font-body', '--font-body', 'theme.fonts.body'),
        'size-card': createVariable('size-card', '--size-card', 'theme.sizes.card'),
        'size-tall': createVariable('size-tall', '--size-tall')
      }
    })

    const node = createTextNode()
    const style = formatNodeStyleForMcp(
      {
        color: 'var(--brand-color, #F00)',
        background: 'linear-gradient(var(--brand-color, #F00), #000)',
        'font-family': 'Inter',
        width: '320px',
        height: '240px'
      },
      node
    )

    expect(style).toEqual({
      color: 'var(--brand-color)',
      background: 'linear-gradient(var(--brand-color), #000)',
      'font-family': 'var(--font-body)',
      width: 'var(--size-card)',
      height: 'var(--size-tall)'
    })
  })

  it('reuses previously collected ids without repeating text binding discovery', () => {
    setupFigma({
      variableById: {
        'font-body': createVariable('font-body', '--font-body', 'theme.fonts.body'),
        'size-card': createVariable('size-card', '--size-card', 'theme.sizes.card'),
        'size-tall': createVariable('size-tall', '--size-tall')
      }
    })
    const node = createTextNode({ fills: [] })
    const ids = collectNodeVariableIds(node)
    const readRangeBinding = vi.mocked(node.getRangeBoundVariable)
    readRangeBinding.mockClear()
    const input = { 'font-family': 'Inter', width: '320px', height: '240px' }

    const uncached = formatNodeStyleForMcp(input, node)
    expect(readRangeBinding).toHaveBeenCalledTimes(TEXT_VARIABLE_FIELDS.length + 1)
    readRangeBinding.mockClear()

    const cached = formatNodeStyleForMcp(input, node, undefined, ids)
    expect(cached).toEqual(uncached)
    expect(readRangeBinding).toHaveBeenCalledTimes(1)

    readRangeBinding.mockClear()
    expect(
      formatNodeStyleForMcp({ width: '320px', height: '240px' }, node, undefined, ids)
    ).toEqual({
      width: 'var(--size-card)',
      height: 'var(--size-tall)'
    })
    expect(readRangeBinding).not.toHaveBeenCalled()
  })

  it('keeps CSS variable fallbacks for plugin variable transforms', () => {
    setupFigma({
      variableById: {
        'color-brand': createVariable('color-brand', '--brand-color', '#276EAF'),
        'size-card': createVariable('size-card', '--size-card', 'theme.sizes.card')
      }
    })

    const node = createTextNode({
      getRangeBoundVariable: vi.fn(() => figma.mixed),
      fills: []
    })
    const style = formatNodeStyleForPluginVariables(
      {
        color: 'var(--brand-color, #276EAF)',
        width: '320px'
      },
      node
    )

    expect(style).toEqual({
      color: 'var(--brand-color, #276EAF)',
      width: 'var(--size-card)'
    })
  })

  it('recovers collected variables from exact WEB codeSyntax values', () => {
    setupFigma({
      variableById: {
        accent: createVariable('accent', 'Accent', '$accent')
      }
    })

    const node = {
      id: 'vector-node',
      type: 'VECTOR',
      visible: true,
      boundVariables: {
        fills: [{ id: 'accent' }]
      }
    } as unknown as SceneNode

    expect(formatNodeStyleForPluginVariables({ fill: '$accent' }, node)).toEqual({
      fill: 'var(--Accent)'
    })

    const result = formatNodeStyleForUi({ fill: '$accent' }, node)
    expect(result.style).toEqual({
      fill: 'var(--Accent)'
    })
    expect(result.variableSyntax).toEqual({
      '--Accent': '$accent'
    })
    expect(
      serializeCSS(
        result.style,
        { useRem: false, rootFontSize: 16, scale: 1 },
        {},
        { variableSyntax: result.variableSyntax }
      )
    ).toBe('fill: $accent;')
  })

  it('recovers collected variables from WEB codeSyntax tokens in mixed values', () => {
    setupFigma({
      variableById: {
        spacing: createVariable('spacing', 'Spacing 1', '$spacing-1')
      }
    })

    const node = {
      id: 'frame-node',
      type: 'FRAME',
      visible: true,
      boundVariables: {
        itemSpacing: { id: 'spacing' }
      }
    } as unknown as SceneNode

    expect(formatNodeStyleForPluginVariables({ padding: '0px $spacing-1' }, node)).toEqual({
      padding: '0px var(--Spacing-1)'
    })
  })

  it('rewrites the same WEB syntax across CSS properties without changing var() contents', () => {
    setupFigma({
      variableById: {
        accent: createVariable('accent', 'Accent', 'theme.color.accent')
      }
    })

    const node = {
      id: 'frame-node',
      type: 'FRAME',
      visible: true,
      boundVariables: {
        fills: [{ id: 'accent' }]
      }
    } as unknown as SceneNode

    expect(
      formatNodeStyleForMcp(
        {
          color: 'theme.color.accent',
          border: '1px solid theme.color.accent',
          background: 'linear-gradient(var(--theme.color.accent, red), theme.color.accent)'
        },
        node
      )
    ).toEqual({
      color: 'var(--Accent)',
      border: '1px solid var(--Accent)',
      background: 'linear-gradient(var(--theme.color.accent, red), var(--Accent))'
    })
  })

  it('collects paint-style variables for UI codeSyntax rewrites', () => {
    setupFigma({
      variableById: {
        'color-brand': createVariable('color-brand', '--brand-color', 'tokens.color.brand')
      },
      styleById: {
        'paint-style': {
          paints: [],
          boundVariables: {
            paints: [{ id: 'color-brand' }]
          }
        }
      }
    })

    const node = {
      id: 'vector-node',
      type: 'VECTOR',
      visible: true,
      fillStyleId: 'paint-style'
    } as unknown as SceneNode
    const result = formatNodeStyleForUi(
      {
        fill: 'var(--brand-color, #276EAF)'
      },
      node
    )

    expect(result.style).toEqual({
      fill: 'var(--brand-color)'
    })
    expect(result.variableSyntax).toEqual({
      '--brand-color': 'tokens.color.brand'
    })
  })

  it('falls back to text style bindings when whole-range bindings are mixed', () => {
    setupFigma({
      variableById: {
        'font-body': createVariable('font-body', '--font-body', 'theme.fonts.body')
      },
      styleById: {
        'style-1': {
          boundVariables: {
            fontFamily: { id: 'font-body' }
          }
        }
      }
    })

    const node = createTextNode({
      textStyleId: 'style-1',
      getRangeBoundVariable: vi.fn(() => figma.mixed),
      fills: []
    })

    const result = formatNodeStyleForUi(
      {
        'font-family': 'Inter'
      },
      node
    )

    expect(result.style).toEqual({
      'font-family': 'var(--font-body)'
    })
    expect(result.variableSyntax).toEqual({
      '--font-body': 'theme.fonts.body'
    })
  })
})
