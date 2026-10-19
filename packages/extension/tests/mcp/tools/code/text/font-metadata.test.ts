import { afterEach, expect, it, vi } from 'vitest'

import { renderShellTree, renderTree } from '@/mcp/tools/code/render'
import { processTokens } from '@/mcp/tools/code/tokens/process'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'

vi.mock('@/ui/state', () => ({ activePlugin: { value: undefined }, options: { value: {} } }))
vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: async (
    refs: Array<{ name: string }>,
    _config: unknown,
    pluginCode?: string
  ) => refs.map(({ name }) => `--${pluginCode ? 'renamed-' : ''}${name}`)
}))

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
afterEach(() => vi.unstubAllGlobals())

function variable(id: string, name: string, valuesByMode: Variable['valuesByMode']): Variable {
  return {
    id,
    name,
    valuesByMode,
    resolvedType: 'STRING',
    variableCollectionId: 'fonts'
  } as Variable
}

it.each([undefined, 'plugin'])(
  'keeps exact rendered face aliases and all modes with plugin=%s',
  async (pluginCode) => {
    const variables = new Map([
      ['face', variable('face', 'Face', { base: { type: 'VARIABLE_ALIAS', id: 'base' } })],
      ['base', variable('base', 'Base', { base: 'Bold Italic', alt: 'Medium' })],
      ['unused', variable('unused', 'Unused', { base: 'Black' })]
    ])
    vi.stubGlobal('figma', {
      variables: {
        getVariableById: (id: string) => variables.get(id),
        getVariableCollectionById: () => ({
          id: 'fonts',
          name: 'Fonts',
          defaultModeId: 'base',
          modes: [
            { modeId: 'base', name: 'Default' },
            { modeId: 'alt', name: 'Alternate' }
          ]
        })
      }
    })
    const report = vi.fn()
    const result = await processTokens({
      component: { name: 'span', props: { class: 'italic font-bold' }, children: ['Text'] },
      serialize: (component) => stringifyComponent(component, 'jsx'),
      variableIds: new Set(variables.keys()),
      usedCandidateIds: new Set(),
      fontStyleVariableIds: new Set(['face']),
      variableCache: variables,
      styles: new Map(),
      textSegments: new Map(),
      svgs: new Map(),
      config,
      report,
      pluginCode
    })
    const prefix = pluginCode ? '--renamed-' : '--'
    expect(result.tokensByCanonical).toMatchObject({
      [`${prefix}Face`]: { value: `${prefix}Base` },
      [`${prefix}Base`]: { value: { 'Fonts:Default': 'Bold Italic', 'Fonts:Alternate': 'Medium' } }
    })
    expect(result.tokensByCanonical).not.toHaveProperty('--Unused')
    expect(report).not.toHaveBeenCalled()
  }
)

it('reports an actually rendered face-name collision without picking either definition', async () => {
  const report = vi.fn()
  const result = await processTokens({
    component: { name: 'span', props: {}, children: ['Text'] },
    serialize: (component) => stringifyComponent(component, 'jsx'),
    variableIds: new Set(['a', 'b']),
    usedCandidateIds: new Set(),
    fontStyleVariableIds: new Set(['a']),
    variableCache: new Map([
      ['a', variable('a', 'Face', { base: 'Bold' })],
      ['b', variable('b', 'Face', { base: 'Regular' })]
    ]),
    styles: new Map(),
    textSegments: new Map(),
    svgs: new Map(),
    config,
    report
  })
  expect(result.tokensByCanonical).toEqual({})
  expect(report).toHaveBeenCalledWith(
    'token-definition',
    'Token name "--Face" matches multiple variables.'
  )
})

it('does not collect text metadata from plugin-replaced descendants or shells', async () => {
  const root = createSnapshot({ id: 'root', type: 'INSTANCE', children: ['text'] })
  const text = createSnapshot({ id: 'text', type: 'TEXT', parentId: 'root' })
  const getStyledTextSegments = vi.fn(() => {
    throw new Error('Omitted text must not be read')
  })
  Object.assign(text.node, { characters: 'Omitted', getStyledTextSegments })
  const tree = createTree([root, text])
  const fontStyleVariableIds = new Set<string>()
  const ctx = {
    config,
    nodes: new Map(),
    styles: new Map(),
    layout: new Map(),
    svgs: new Map(),
    textSegments: new Map(),
    fontStyleVariableIds,
    pluginComponents: new Map([['root', { component: { name: 'Card', props: {}, children: [] } }]])
  }
  expect(await renderTree('root', tree, ctx)).toMatchObject({ name: 'Card' })
  ctx.pluginComponents.clear()
  Object.assign(root.node, { type: 'FRAME' })
  expect(await renderShellTree('root', tree, ctx, ['text'])).not.toBeNull()
  expect(fontStyleVariableIds.size).toBe(0)
  expect(getStyledTextSegments).not.toHaveBeenCalled()
})

it('keeps the face metadata of rendered spaces but not empty or newline-only runs', async () => {
  const face = variable('face', 'Face', { base: 'Medium' })
  vi.stubGlobal('figma', { variables: { getVariableById: () => face } })
  const text = createSnapshot({ id: 'text', type: 'TEXT' })
  Object.assign(text.node, { characters: ' ' })
  for (const characters of [' ', '', '\n\n']) {
    const fontStyleVariableIds = new Set<string>()
    const segment = {
      characters,
      start: 0,
      end: characters.length,
      fontName: { family: 'Inter', style: 'Medium' },
      fontWeight: 500,
      fontStyle: 'REGULAR',
      boundVariables: { fontStyle: { type: 'VARIABLE_ALIAS', id: 'face' } }
    } as unknown as StyledTextSegment
    await renderTree('text', createTree([text]), {
      config,
      nodes: new Map(),
      styles: new Map(),
      layout: new Map(),
      svgs: new Map(),
      textSegments: new Map([['text', [segment]]]),
      fontStyleVariableIds
    })
    expect([...fontStyleVariableIds]).toEqual(characters === ' ' ? ['face'] : [])
  }
})

it.each(['normal', 'italic'])(
  'preserves valid native CSS font-style %s without styled segments',
  async (fontStyle) => {
    const text = createSnapshot({ id: 'text', type: 'TEXT' })
    Object.assign(text.node, { characters: 'Text' })
    const rendered = await renderTree('text', createTree([text]), {
      config,
      nodes: new Map(),
      styles: new Map([['text', { 'font-style': fontStyle }]]),
      layout: new Map(),
      svgs: new Map(),
      textSegments: new Map([['text', null]])
    })
    if (!rendered || typeof rendered === 'string') throw new Error('Expected text component')
    const code = stringifyComponent(rendered, { lang: 'jsx' })
    if (fontStyle === 'italic') expect(code).toContain('italic')
    else expect(code).not.toContain('italic')
    expect(code).toContain('Text')
  }
)
