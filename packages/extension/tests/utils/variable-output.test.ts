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
  it('uses field bindings without guessing ownership of a duplicated code syntax', () => {
    setupFigma({
      variableById: {
        a: createVariable('a', 'Width', 'shared'),
        b: createVariable('b', 'Height', 'shared')
      }
    })
    const node = {
      type: 'FRAME',
      boundVariables: { width: { id: 'a' }, height: { id: 'b' } }
    } as unknown as SceneNode
    expect(
      formatNodeStyleForMcp({ width: 'shared', height: 'shared', color: 'shared' }, node)
    ).toEqual({
      width: 'var(--Width)',
      height: 'var(--Height)',
      color: 'shared'
    })
  })

  it.each([
    [
      'UI',
      (style: Record<string, string>, node: SceneNode) => formatNodeStyleForUi(style, node).style
    ],
    ['MCP', formatNodeStyleForMcp],
    ['plugin', formatNodeStyleForPluginVariables]
  ] as const)('preserves CSS literals while rewriting %s variable references', (_name, format) => {
    setupFigma({
      variableById: {
        accent: createVariable('accent', 'Accent', 'theme.color.accent')
      }
    })
    const node = {
      type: 'FRAME',
      boundVariables: { fills: [{ id: 'accent' }] }
    } as unknown as FrameNode
    const style = {
      content: '"theme.color.accent var(--Accent, red)"',
      background: 'url("https://assets.test/theme.color.accent.svg") theme.color.accent',
      mask: 'url(https://assets.test/theme.color.accent.svg)',
      'border-image': 'linear-gradient(theme.color.accent, var(--other, red))',
      outline: '1px /* theme.color.accent */ solid theme.color.accent'
    }

    expect(format(style, node)).toEqual({
      ...style,
      background: 'url("https://assets.test/theme.color.accent.svg") var(--Accent)',
      'border-image': 'linear-gradient(var(--Accent), var(--other, red))',
      outline: '1px /* theme.color.accent */ solid var(--Accent)'
    })
  })

  it('uses binding identity for quoted code syntax without rewriting matching literal content', () => {
    setupFigma({
      variableById: {
        'font-body': createVariable('font-body', 'Body font', '"Brand Font"')
      }
    })
    const node = createTextNode({ fills: [], boundVariables: {} })
    const result = formatNodeStyleForUi(
      { 'font-family': '"Brand Font"', content: '"Brand Font"' },
      node
    )

    expect(result).toEqual({
      style: { 'font-family': 'var(--Body-font)', content: '"Brand Font"' },
      variableSyntax: { '--Body-font': '"Brand Font"' }
    })
  })

  it.each(['0', 'theme.color.accent'])(
    'does not confuse %s syntax or CSS identifiers with protected fragments',
    (syntax) => {
      setupFigma({ variableById: { accent: createVariable('accent', 'Accent', syntax) } })
      const node = {
        type: 'FRAME',
        boundVariables: { fills: [{ id: 'accent' }] }
      } as unknown as FrameNode
      expect(
        formatNodeStyleForMcp(
          {
            content: '"0"',
            border: `1px solid ${syntax}`,
            'font-family': '__VAR_0__, var(--Accent, red)'
          },
          node
        )
      ).toEqual({
        content: '"0"',
        border: '1px solid var(--Accent)',
        'font-family': '__VAR_0__, var(--Accent)'
      })
    }
  )

  it.each(['HORIZONTAL', 'VERTICAL'] as const)(
    'preserves explicitly synchronized cross-axis variables in %s wrap layouts',
    (layoutMode) => {
      setupFigma({ variableById: { main: createVariable('main', 'Shared measure') } })
      for (const marker of [false, true]) {
        for (const spacing of [50, 75]) {
          const node = {
            type: 'FRAME',
            layoutMode,
            layoutWrap: 'WRAP',
            itemSpacing: spacing,
            counterAxisSpacing: marker ? spacing : null,
            getSharedPluginData: () => (marker ? 'true' : ''),
            boundVariables: { itemSpacing: { id: 'main' } }
          } as unknown as FrameNode
          expect(formatNodeStyleForMcp({ gap: `${spacing}px` }, node)).toEqual({
            'row-gap': 'var(--Shared-measure)',
            'column-gap': 'var(--Shared-measure)'
          })
        }
      }
    }
  )

  it.each([
    ['explicit equal spacing', 'WRAP', 50, ''],
    ['stale marker', 'WRAP', 25, 'true'],
    ['non-wrap layout', 'NO_WRAP', 50, 'true']
  ])('does not infer synchronization from %s', (_label, layoutWrap, crossSpacing, marker) => {
    setupFigma({ variableById: { main: createVariable('main', 'Shared measure') } })
    for (const spacing of [50, 75]) {
      const node = {
        type: 'FRAME',
        layoutMode: 'HORIZONTAL',
        layoutWrap,
        itemSpacing: spacing,
        counterAxisSpacing: crossSpacing,
        getSharedPluginData: () => marker,
        boundVariables: { itemSpacing: { id: 'main' } }
      } as unknown as FrameNode
      expect(
        formatNodeStyleForMcp(
          { 'row-gap': `${crossSpacing}px`, 'column-gap': `${spacing}px` },
          node
        )
      ).toEqual({
        'row-gap': `${crossSpacing}px`,
        'column-gap': 'var(--Shared-measure)'
      })
    }
  })

  it('prefers an independent counter-axis binding over a retained sync marker', () => {
    setupFigma({
      variableById: {
        main: createVariable('main', 'main'),
        cross: createVariable('cross', 'cross')
      }
    })
    const node = {
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'WRAP',
      itemSpacing: 50,
      counterAxisSpacing: 50,
      getSharedPluginData: () => 'true',
      boundVariables: { itemSpacing: { id: 'main' }, counterAxisSpacing: { id: 'cross' } }
    } as unknown as FrameNode
    expect(formatNodeStyleForMcp({ gap: '50px' }, node)).toEqual({
      'row-gap': 'var(--cross)',
      'column-gap': 'var(--main)'
    })
  })

  it('projects synchronized native gap references onto the bound variable identity', () => {
    setupFigma({ variableById: { shared: createVariable('shared', 'Candidate 6e21 / Shared') } })
    const node = {
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      boundVariables: { itemSpacing: { id: 'shared' } }
    } as unknown as FrameNode
    expect(formatNodeStyleForMcp({ gap: 'var(--Candidate-6e21-Shared)' }, node)).toEqual({
      'row-gap': 'var(--Candidate-6e21---Shared)',
      'column-gap': 'var(--Candidate-6e21---Shared)'
    })
  })

  it.each([false, true])(
    'does not guess ambiguous collapsed variable names (reverse %s)',
    (reverse) => {
      setupFigma({
        variableById: {
          spaced: createVariable('spaced', 'Candidate 6e21 / Shared'),
          literal: createVariable('literal', 'Candidate-6e21-Shared')
        }
      })
      const ids = reverse ? ['literal', 'spaced'] : ['spaced', 'literal']
      const node = { type: 'FRAME' } as unknown as FrameNode
      const style = { color: 'var(--Candidate-6e21-Shared)' }
      expect(formatNodeStyleForMcp(style, node, undefined, new Set(ids))).toEqual(style)
    }
  )

  it.each([0, -1, NaN, Infinity])(
    'never emits invalid rem values with root size %s',
    (rootFontSize) => {
      const css = serializeCSS({ width: '16px' }, { useRem: true, rootFontSize, scale: 1 })
      expect(css).toContain('1rem')
      expect(css).not.toMatch(/Infinity|NaN/)
    }
  )

  it.each(['HORIZONTAL', 'VERTICAL'])(
    'preserves independent spacing axes in %s layouts',
    (layoutMode) => {
      setupFigma({
        variableById: {
          main: createVariable('main', 'space-main'),
          cross: createVariable('cross', 'space-cross')
        }
      })
      const node = {
        type: 'FRAME',
        layoutMode,
        boundVariables: { itemSpacing: { id: 'main' }, counterAxisSpacing: { id: 'cross' } }
      } as unknown as FrameNode
      const result = formatNodeStyleForMcp({ gap: '16px 8px' }, node)
      expect(result).toEqual(
        layoutMode === 'HORIZONTAL'
          ? { 'row-gap': 'var(--space-cross)', 'column-gap': 'var(--space-main)' }
          : { 'row-gap': 'var(--space-main)', 'column-gap': 'var(--space-cross)' }
      )
    }
  )

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
