import { raw } from '@tempad-dev/plugins'
import { afterEach, expect, it, vi } from 'vitest'

import { processTokens } from '@/mcp/tools/code/tokens/process'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { stringifyComponent } from '@/utils/component'
import { cssToClassNames } from '@/utils/tailwind'

vi.mock('@/ui/state', () => ({ activePlugin: { value: undefined } }))
vi.mock('@/mcp/transform-variables/requester', () => ({ runTransformVariableBatch: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function inputFor(name: string) {
  const variable = {
    id: 'value',
    name,
    variableCollectionId: 'collection',
    resolvedType: 'FLOAT',
    valuesByMode: { default: 8 },
    scopes: ['WIDTH_HEIGHT']
  } as unknown as Variable
  vi.stubGlobal('figma', {
    variables: {
      getVariableCollectionById: () => ({
        id: 'collection',
        name: 'Tokens',
        defaultModeId: 'default',
        modes: [{ modeId: 'default', name: 'Default' }]
      })
    }
  })
  return {
    component: {
      name: 'div',
      props: { className: cssToClassNames({ width: `calc(var(--${name}) * 2)` }).join(' ') },
      children: []
    },
    serialize: (component: Parameters<typeof stringifyComponent>[0]) =>
      stringifyComponent(component, 'jsx'),
    variableIds: new Set(['value']),
    usedCandidateIds: new Set<string>(),
    variableCache: new Map([['value', variable]]),
    styles: new Map(),
    textSegments: new Map(),
    svgs: new Map(),
    config: { cssUnit: 'px' as const, rootFontSize: 16, scale: 1 }
  }
}

it('retains definitions for generated escaped names without changing unrenamed classes', async () => {
  const input = inputFor('some_token')
  input.component.props.className += ` before:content-['var(--only_literal)'] bg-[url(/--only_literal.svg)]`
  input.variableIds.add('literal')
  input.variableCache.set('literal', {
    ...input.variableCache.get('value')!,
    id: 'literal',
    name: 'only_literal'
  })
  const result = await processTokens(input)

  expect(result.tokensByCanonical).toEqual({ '--some_token': { kind: 'number', value: '8px' } })
  expect(result.code).toBe(input.serialize(input.component))
  expect(runTransformVariableBatch).not.toHaveBeenCalled()
})

it.each(['some_token', 'plain'])(
  'rewrites %s with encoding specific to each styling boundary',
  async (name) => {
    const input = inputFor(name)
    const literal = `before:content-['var(--${name})'] bg-[url(/--${name}.svg)]`
    const component = {
      ...input.component,
      props: {
        className: `${input.component.props.className} h-(--${name}) ${literal}`,
        style: { width: `calc(var(--${name}) * 2)` },
        title: `var(--${name})`
      },
      children: [raw(`const value = "var(--${name})";`)]
    }
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['var(--next_token)'])
    const result = await processTokens({ ...input, component, pluginCode: 'test-plugin' })

    expect(result.tokensByCanonical).toEqual({ '--next_token': { kind: 'number', value: '8px' } })
    expect(result.code).toContain(String.raw`w-[calc(var(--next\_token)_*_2)] h-(--next\_token)`)
    expect(result.code).toContain(literal)
    expect(result.code).toContain('calc(var(--next_token) * 2)')
    expect(result.code).toContain('const value = "var(--next_token)";')
    expect(result.code).toContain(`title="var(--${name})"`)
  }
)
