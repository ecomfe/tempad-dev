import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatNodeStyleForMcp, formatNodeStyleForUi } from '@/utils/variable-output'

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
    getRangeBoundVariable: vi.fn((_start: number, _end: number, field: VariableBindableTextField) =>
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

    expect(result).toEqual({
      color: ' tokens.color.brand ',
      background: 'linear-gradient( tokens.color.brand , #000)',
      'font-family': 'theme.fonts.body',
      width: 'theme.sizes.card',
      height: '240px'
    })
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

    expect(result).toEqual({
      'font-family': 'theme.fonts.body'
    })
  })
})
