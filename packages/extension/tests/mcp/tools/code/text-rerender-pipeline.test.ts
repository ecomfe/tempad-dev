import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'
import { renderTextSegments } from '@/mcp/tools/code/text'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

vi.mock('@/mcp/tools/code/text/render', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/mcp/tools/code/text/render')>()
  return { ...original, renderTextSegments: vi.fn(original.renderTextSegments) }
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function createText(binding: 'width' | 'fontWeight') {
  const value = binding === 'width' ? 24 : 600
  const resolveForConsumer = vi.fn(() => ({ value, resolvedType: 'FLOAT' }))
  const variable = {
    id: 'shared',
    name: 'Shared',
    variableCollectionId: 'collection',
    resolvedType: 'FLOAT',
    scopes: ['WIDTH_HEIGHT'],
    valuesByMode: { base: value },
    resolveForConsumer
  }
  const alias = { type: 'VARIABLE_ALIAS', id: variable.id }
  const fill = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } }
  const getStyledTextSegments = vi.fn(() => [
    {
      characters: 'Text',
      start: 0,
      end: 4,
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      fontWeight: binding === 'fontWeight' ? value : 400,
      fills: [fill],
      ...(binding === 'fontWeight' ? { boundVariables: { fontWeight: alias } } : {})
    }
  ])
  const getCSSAsync = vi.fn(async () => ({
    width: binding === 'width' ? 'var(--Shared, 24px)' : '100px',
    height: '40px'
  }))
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: {
      getVariableById: () => variable,
      getVariableCollectionById: () => ({
        id: 'collection',
        name: 'Shared',
        defaultModeId: 'base',
        modes: [{ modeId: 'base', name: 'Default' }]
      })
    },
    getStyleById: () => null
  })
  const node = {
    id: 'text',
    type: 'TEXT',
    name: 'Text',
    characters: 'Text',
    visible: true,
    x: 0,
    y: 0,
    width: binding === 'width' ? value : 100,
    height: 40,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 40 },
    fills: [fill],
    strokes: [],
    effects: [],
    boundVariables: binding === 'width' ? { width: alias } : {},
    getRangeBoundVariable: (_start: number, _end: number, field: string) =>
      field === binding ? alias : null,
    getStyledTextSegments,
    getCSSAsync
  } as unknown as TextNode
  return { node, getCSSAsync, getStyledTextSegments, resolveForConsumer }
}

it('renders real text once when unresolved tokens do not change any text-run styles', async () => {
  const { node, getCSSAsync, getStyledTextSegments } = createText('width')
  const result = await handleGetCode([node], 'jsx', false)
  expect(result.code).toContain('w-(--Shared)')
  expect(result.code).toContain('Text</span>')
  expect(result.tokens?.['--Shared']).toEqual({ kind: 'number', value: '24px' })
  expect(renderTextSegments).toHaveBeenCalledTimes(1)
  expect(getCSSAsync).toHaveBeenCalledTimes(1)
  expect(getStyledTextSegments).toHaveBeenCalledTimes(1)
})

it.each([false, true])(
  'still rerenders a token used only by text runs with resolveTokens=%s',
  async (resolveTokens) => {
    const { node, getCSSAsync, getStyledTextSegments, resolveForConsumer } =
      createText('fontWeight')
    const result = await handleGetCode([node], 'jsx', resolveTokens)
    expect(result.code).toContain(
      resolveTokens ? 'font-semibold' : 'font-[weight:calc(var(--Shared)_/_100px_*_100)]'
    )
    expect(result.tokens?.['--Shared']).toEqual({ kind: 'number', value: '600px' })
    expect(renderTextSegments).toHaveBeenCalledTimes(2)
    expect(getCSSAsync).toHaveBeenCalledTimes(1)
    expect(getStyledTextSegments).toHaveBeenCalledTimes(1)
    if (resolveTokens) expect(resolveForConsumer).toHaveBeenCalledTimes(1)
  }
)

it('retains real text and reports failed consumer resolution without an unchanged render', async () => {
  const { node, resolveForConsumer } = createText('fontWeight')
  resolveForConsumer.mockImplementation(() => {
    throw new Error('Unavailable consumer')
  })
  const result = await handleGetCode([node], 'jsx', true)
  expect(result.code).toContain('font-(weight:--Shared)')
  expect(result.code).toContain('Text</strong>')
  expect(result.warnings?.map(({ type }) => type)).toEqual(['token-resolution'])
  expect(renderTextSegments).toHaveBeenCalledTimes(1)
  expect(resolveForConsumer).toHaveBeenCalledTimes(1)
})
