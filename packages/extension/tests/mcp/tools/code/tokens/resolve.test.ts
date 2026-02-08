import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

import { getVariableByIdCached } from '@/mcp/tools/code/tokens/cache'
import { createStyleVarResolver, resolveStyleMap } from '@/mcp/tools/code/tokens/resolve'
import { getVariableRawName } from '@/mcp/tools/token/indexer'
import { formatHexAlpha, normalizeCssValue, normalizeFigmaVarName } from '@/utils/css'

vi.mock('@/utils/css', () => ({
  formatHexAlpha: vi.fn(() => '#MOCK-COLOR'),
  normalizeCssValue: vi.fn((value: string) => `norm(${value})`),
  normalizeFigmaVarName: vi.fn((name: string) => {
    const trimmed = name.trim().toLowerCase()
    if (trimmed.startsWith('--')) return trimmed
    return `--${trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
  }),
  replaceVarFunctions: vi.fn(
    (input: string, replacer: (match: { name: string; full: string }) => string) =>
      input.replace(/var\(([^)]+)\)/g, (full, name) => replacer({ name, full }))
  )
}))

vi.mock('@/mcp/tools/code/tokens/cache', () => ({
  getVariableByIdCached: vi.fn()
}))

vi.mock('@/mcp/tools/token/indexer', () => ({
  getVariableRawName: vi.fn()
}))

const CONFIG: CodegenConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
}

type VariableLike = Variable & {
  rawName?: string
  variableCollectionId?: string
  resolvedType?: Variable['resolvedType']
}

function createVariable(
  id: string,
  valuesByMode: Record<string, unknown>,
  extras: Partial<VariableLike> = {}
): VariableLike {
  return {
    id,
    valuesByMode,
    ...extras
  } as unknown as VariableLike
}

function setVariableMap(variables: Record<string, Variable | null>) {
  vi.mocked(getVariableByIdCached).mockImplementation((id: string) => variables[id] ?? null)
}

function setCollectionApi(options?: {
  collections?: Record<string, { id: string; defaultModeId: string } | null>
  getModeId?: (collectionId: string) => string
}) {
  const collections = options?.collections ?? {}
  const getVariableCollectionById = vi.fn((id: string) => {
    const collection = collections[id]
    if (collection === undefined) return null
    if (collection === null) throw new Error(`collection error: ${id}`)
    return collection
  })

  ;(globalThis as { figma?: PluginAPI }).figma = {
    variables: {
      getVariableCollectionById,
      ...(options?.getModeId
        ? {
            getVariableModeId: vi.fn(options.getModeId)
          }
        : {})
    }
  } as unknown as PluginAPI
}

beforeEach(() => {
  setCollectionApi()
})

afterEach(() => {
  delete (globalThis as { figma?: PluginAPI }).figma
  vi.clearAllMocks()
})

describe('tokens/resolve resolveStyleMap', () => {
  it('maps styles through the provided resolver with optional nodes', () => {
    const resolver = vi.fn((style: Record<string, string>, node?: SceneNode) => ({
      ...style,
      __node: node?.id ?? 'none'
    }))

    const result = resolveStyleMap(
      new Map([
        ['a', { color: 'red' }],
        ['b', { color: 'blue' }]
      ]),
      new Map([['a', { id: 'node-a' } as SceneNode]]),
      resolver
    )

    expect(resolver).toHaveBeenNthCalledWith(1, { color: 'red' }, { id: 'node-a' })
    expect(resolver).toHaveBeenNthCalledWith(2, { color: 'blue' }, undefined)
    expect(result).toEqual(
      new Map([
        ['a', { color: 'red', __node: 'node-a' }],
        ['b', { color: 'blue', __node: 'none' }]
      ])
    )
  })
})

describe('tokens/resolve createStyleVarResolver', () => {
  it('returns style unchanged for empty input or filtered node ids', () => {
    setVariableMap({})
    const resolver = createStyleVarResolver(
      new Map([['--size', 'v1']]),
      new Map(),
      CONFIG,
      new Set(['node-1'])
    )

    const empty = {}
    expect(resolver(empty, { id: 'node-1' } as SceneNode)).toBe(empty)

    const style = { width: 'var(--size)' }
    expect(resolver(style, { id: 'node-2' } as SceneNode)).toBe(style)
  })

  it('resolves float token values with css unit conversion and value cache reuse', () => {
    const variable = createVariable(
      'v-size',
      {
        m1: 8
      },
      {
        resolvedType: 'FLOAT',
        variableCollectionId: 'c-size',
        rawName: 'Spacing Small'
      }
    )
    setVariableMap({
      'v-size': variable
    })
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )
    setCollectionApi({
      collections: {
        'c-size': {
          id: 'c-size',
          defaultModeId: 'm1'
        }
      }
    })

    const resolver = createStyleVarResolver(
      new Map([['--spacing-small', 'v-size']]),
      new Map(),
      CONFIG
    )
    const result = resolver({
      width: 'var(--spacing-small)',
      height: 'var(--spacing-small)'
    })

    expect(result).toEqual({
      width: 'norm(8px)',
      height: 'norm(8px)'
    })
    expect(normalizeCssValue).toHaveBeenCalledTimes(1)
  })

  it('resolves unitless float tokens from node mode overrides', () => {
    const variable = createVariable(
      'v-opacity',
      {
        m1: 0.4,
        m2: 0.75
      },
      {
        resolvedType: 'FLOAT',
        variableCollectionId: 'c-opacity',
        rawName: 'Opacity Main'
      }
    )
    setVariableMap({
      'v-opacity': variable
    })
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )
    setCollectionApi({
      collections: {
        'c-opacity': {
          id: 'c-opacity',
          defaultModeId: 'm1'
        }
      },
      getModeId: () => {
        throw new Error('no active mode')
      }
    })

    const resolver = createStyleVarResolver(
      new Map([['--opacity-main', 'v-opacity']]),
      new Map(),
      CONFIG
    )

    const result = resolver(
      {
        opacity: 'var(--opacity-main)'
      },
      {
        id: 'node-1',
        resolvedVariableModes: {
          'c-opacity': 'm2'
        }
      } as unknown as SceneNode
    )

    expect(result).toEqual({
      opacity: '0.75'
    })
  })

  it('resolves alias chains and preserves unresolved/cyclic aliases', () => {
    const aliasSource = createVariable(
      'v-alias',
      { m1: { id: 'v-bool' } },
      { resolvedType: 'FLOAT' }
    )
    const boolTarget = createVariable(
      'v-bool',
      { m1: true },
      { resolvedType: 'BOOLEAN', rawName: 'Flag' }
    )
    const missingAlias = createVariable(
      'v-missing',
      { m1: { id: 'missing-id' } },
      { resolvedType: 'FLOAT' }
    )
    const cycleA = createVariable(
      'v-cycle-a',
      { m1: { id: 'v-cycle-b' } },
      { resolvedType: 'FLOAT' }
    )
    const cycleB = createVariable(
      'v-cycle-b',
      { m1: { id: 'v-cycle-a' } },
      { resolvedType: 'FLOAT' }
    )

    setVariableMap({
      'v-alias': aliasSource,
      'v-bool': boolTarget,
      'v-missing': missingAlias,
      'v-cycle-a': cycleA,
      'v-cycle-b': cycleB
    })
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )

    const resolver = createStyleVarResolver(
      new Map([
        ['--flag', 'v-alias'],
        ['--missing', 'v-missing'],
        ['--cycle', 'v-cycle-a']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver({
      ok: 'var(--flag)',
      missing: 'var(--missing)',
      cycle: 'var(--cycle)'
    })

    expect(result).toEqual({
      ok: 'true',
      missing: 'var(--missing)',
      cycle: 'var(--cycle)'
    })
  })

  it('uses target collection mode overrides when resolving alias targets', () => {
    const source = createVariable('v-source', { m1: { id: 'v-target' } }, { resolvedType: 'FLOAT' })
    const target = createVariable(
      'v-target',
      {
        mA: 'A',
        mB: 'B'
      },
      {
        resolvedType: 'STRING',
        variableCollectionId: 'c-target'
      }
    )
    setVariableMap({
      'v-source': source,
      'v-target': target
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Token')
    setCollectionApi({
      collections: {
        'c-target': {
          id: 'c-target',
          defaultModeId: 'mA'
        }
      }
    })

    const resolver = createStyleVarResolver(new Map([['--alias', 'v-source']]), new Map(), CONFIG)
    const result = resolver({ value: 'var(--alias)' }, {
      id: 'node-1',
      resolvedVariableModes: {
        'c-target': 'mB'
      }
    } as unknown as SceneNode)

    expect(result).toEqual({ value: 'B' })
  })

  it('serializes color, string, object and circular object values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const toJsonUndefinedObj = {
      toJSON: () => undefined
    }
    const toUndefinedLiteralObj = {
      toJSON: () => undefined,
      toString: () => 'undefined'
    }

    const color = createVariable(
      'v-color',
      { m1: { r: 1, g: 0, b: 0, a: 0.5 } },
      { resolvedType: 'COLOR' }
    )
    const stringVar = createVariable('v-string', { m1: 'hello' }, { resolvedType: 'STRING' })
    const objectVar = createVariable('v-object', { m1: { x: 1 } }, { resolvedType: undefined })
    const circularVar = createVariable('v-circular', { m1: circular }, { resolvedType: undefined })
    const toJsonUndefinedVar = createVariable(
      'v-json-undefined',
      { m1: toJsonUndefinedObj },
      { resolvedType: undefined }
    )
    const toUndefinedLiteralVar = createVariable(
      'v-undefined-literal',
      { m1: toUndefinedLiteralObj },
      { resolvedType: undefined }
    )
    const nullVar = createVariable('v-null', { m1: null }, { resolvedType: undefined })
    const boolVar = createVariable('v-bool', { m1: false }, { resolvedType: 'BOOLEAN' })
    const plainNumberVar = createVariable('v-number', { m1: 42 }, { resolvedType: undefined })

    setVariableMap({
      'v-color': color,
      'v-string': stringVar,
      'v-object': objectVar,
      'v-circular': circularVar,
      'v-json-undefined': toJsonUndefinedVar,
      'v-undefined-literal': toUndefinedLiteralVar,
      'v-null': nullVar,
      'v-bool': boolVar,
      'v-number': plainNumberVar
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'token')

    const resolver = createStyleVarResolver(
      new Map([
        ['--color', 'v-color'],
        ['--string', 'v-string'],
        ['--object', 'v-object'],
        ['--circular', 'v-circular'],
        ['--json-undefined', 'v-json-undefined'],
        ['--undefined-literal', 'v-undefined-literal'],
        ['--null', 'v-null'],
        ['--bool', 'v-bool'],
        ['--number', 'v-number']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver({
      color: 'var(--color)',
      string: 'var(--string)',
      object: 'var(--object)',
      circular: 'var(--circular)',
      jsonUndefined: 'var(--json-undefined)',
      undefinedLiteral: 'var(--undefined-literal)',
      nullable: 'var(--null)',
      bool: 'var(--bool)',
      number: 'var(--number)'
    })

    expect(result).toEqual({
      color: '#MOCK-COLOR',
      string: 'hello',
      object: '{"x":1}',
      circular: '[object Object]',
      jsonUndefined: '[object Object]',
      undefinedLiteral: 'var(--undefined-literal)',
      nullable: 'var(--null)',
      bool: 'false',
      number: 'var(--number)'
    })
    expect(formatHexAlpha).toHaveBeenCalledWith({ r: 1, g: 0, b: 0, a: 0.5 }, 0.5)
  })

  it('supports tokenMatcher filtering and leaves non-custom var names unchanged', () => {
    const variable = createVariable('v-token', { m1: 'ok' }, { resolvedType: 'STRING' })
    setVariableMap({
      'v-token': variable
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Token')

    const matcher = vi.fn((value: string) => !value.includes('--skip'))
    const resolver = createStyleVarResolver(
      new Map([['--token', 'v-token']]),
      new Map(),
      CONFIG,
      undefined,
      matcher
    )

    const style = {
      changed: 'var(--token)',
      skipped: 'var(--skip)',
      notToken: 'var(theme-color)',
      empty: ''
    }

    const result = resolver(style)
    expect(result).toEqual({
      changed: 'ok',
      skipped: 'var(--skip)',
      notToken: 'var(theme-color)',
      empty: ''
    })
    expect(matcher).toHaveBeenCalledWith('var(--token)')
    expect(normalizeFigmaVarName).toHaveBeenCalledWith('--token')
  })

  it('falls back to first available mode when collection lookup throws', () => {
    const variable = createVariable(
      'v-token',
      {
        first: 'value'
      },
      {
        resolvedType: 'STRING',
        variableCollectionId: 'collection-err'
      }
    )
    setVariableMap({
      'v-token': variable
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Token')
    setCollectionApi({
      collections: {
        'collection-err': null
      }
    })

    const resolver = createStyleVarResolver(new Map([['--token', 'v-token']]), new Map(), CONFIG)
    expect(resolver({ value: 'var(--token)' })).toEqual({ value: 'value' })
  })

  it('keeps unresolved expressions when variable id/mode cannot be resolved', () => {
    const aliasWithoutMode = createVariable(
      'v-alias',
      { m1: { id: 'v-empty' } },
      { resolvedType: 'FLOAT' }
    )
    const emptyTarget = createVariable('v-empty', {}, { resolvedType: 'STRING' })
    setVariableMap({
      'v-alias': aliasWithoutMode,
      'v-empty': emptyTarget
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Token')

    const matcher = vi.fn((value: string) => !value.includes('--skip'))
    const resolver = createStyleVarResolver(
      new Map([
        ['--alias', 'v-alias'],
        ['--missing-variable', 'v-not-found']
      ]),
      new Map(),
      CONFIG,
      undefined,
      matcher
    )

    const style = {
      empty: '',
      skipped: 'var(--skip)',
      unknown: 'var(--not-indexed)',
      missingVar: 'var(--missing-variable)',
      missingMode: 'var(--alias)',
      plain: 'var(theme-color)'
    }
    const result = resolver(style)

    expect(result).toBe(style)
    expect(matcher).toHaveBeenCalledWith('var(--skip)')
  })

  it('keeps unresolved expressions when a mapped variable has no selectable mode', () => {
    const noModeVar = createVariable('v-no-mode', {}, { resolvedType: 'STRING' })
    setVariableMap({
      'v-no-mode': noModeVar
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Token')

    const resolver = createStyleVarResolver(
      new Map([['--no-mode', 'v-no-mode']]),
      new Map(),
      CONFIG
    )
    expect(resolver({ value: 'var(--no-mode)' })).toEqual({ value: 'var(--no-mode)' })
  })

  it('keeps unresolved expressions when valuesByMode is missing at runtime', () => {
    const malformedVariable = createVariable(
      'v-malformed',
      undefined as unknown as Record<string, unknown>,
      { resolvedType: 'STRING' }
    )
    setVariableMap({
      'v-malformed': malformedVariable
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Malformed')

    const resolver = createStyleVarResolver(
      new Map([['--malformed', 'v-malformed']]),
      new Map(),
      CONFIG
    )

    expect(resolver({ value: 'var(--malformed)' })).toEqual({ value: 'var(--malformed)' })
  })

  it('uses collection null fallback, invalid resolved modes, and undefined collection id', () => {
    const nullCollectionVar = createVariable(
      'v-null-collection',
      { m1: 'A' },
      { resolvedType: 'STRING', variableCollectionId: 'c-null' }
    )
    const noIdCollectionVar = createVariable(
      'v-noid-collection',
      { m1: 'B' },
      { resolvedType: 'STRING', variableCollectionId: 'c-noid' }
    )
    setVariableMap({
      'v-null-collection': nullCollectionVar,
      'v-noid-collection': noIdCollectionVar
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Token')
    setCollectionApi({
      collections: {
        'c-noid': {
          id: undefined as unknown as string,
          defaultModeId: 'm1'
        }
      }
    })

    const resolver = createStyleVarResolver(
      new Map([
        ['--a', 'v-null-collection'],
        ['--b', 'v-noid-collection']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver(
      {
        a: 'var(--a)',
        b: 'var(--b)'
      },
      {
        id: 'node-1',
        resolvedVariableModes: 1 as unknown as Record<string, string>
      } as unknown as SceneNode
    )

    expect(result).toEqual({
      a: 'A',
      b: 'B'
    })
  })

  it('prefers active mode and falls back to default mode value when active mode is undefined', () => {
    const activeFloat = createVariable(
      'v-active',
      {
        m1: 4,
        m2: undefined
      },
      {
        resolvedType: 'FLOAT',
        variableCollectionId: 'c-active',
        rawName: 'spacing active'
      }
    )
    const unresolvedFloat = createVariable(
      'v-unresolved',
      {
        m2: undefined
      },
      {
        resolvedType: 'FLOAT',
        variableCollectionId: 'c-active',
        rawName: 'spacing unresolved'
      }
    )
    setVariableMap({
      'v-active': activeFloat,
      'v-unresolved': unresolvedFloat
    })
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )
    setCollectionApi({
      collections: {
        'c-active': {
          id: 'c-active',
          defaultModeId: 'm1'
        }
      },
      getModeId: () => 'm2'
    })

    const resolver = createStyleVarResolver(
      new Map([
        ['--spacing-active', 'v-active'],
        ['--spacing-unresolved', 'v-unresolved']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver({
      active: 'var(--spacing-active)',
      unresolved: 'var(--spacing-unresolved)'
    })

    expect(result).toEqual({
      active: 'norm(4px)',
      unresolved: 'var(--spacing-unresolved)'
    })
  })

  it('returns unresolved expression when fallback branch has no usable default value', () => {
    const unresolved = createVariable(
      'v-unresolved',
      {
        m2: undefined
      },
      {
        resolvedType: 'FLOAT',
        variableCollectionId: 'c-unresolved',
        rawName: 'spacing unresolved'
      }
    )
    setVariableMap({
      'v-unresolved': unresolved
    })
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )
    setCollectionApi({
      collections: {
        'c-unresolved': {
          id: 'c-unresolved',
          defaultModeId: 'm2'
        }
      }
    })

    const resolver = createStyleVarResolver(
      new Map([['--spacing-unresolved', 'v-unresolved']]),
      new Map(),
      CONFIG
    )
    expect(resolver({ value: 'var(--spacing-unresolved)' })).toEqual({
      value: 'var(--spacing-unresolved)'
    })
  })

  it('treats font-weight and z-index prefixed float tokens as unitless', () => {
    const variables = {
      'v-font-weight': createVariable(
        'v-font-weight',
        { m1: 600 },
        { resolvedType: 'FLOAT', rawName: 'font-weight-main' }
      ),
      'v-fontweight': createVariable(
        'v-fontweight',
        { m1: 650 },
        { resolvedType: 'FLOAT', rawName: 'fontweight-main' }
      ),
      'v-z-index': createVariable(
        'v-z-index',
        { m1: 3 },
        { resolvedType: 'FLOAT', rawName: 'z-index-layer' }
      ),
      'v-z': createVariable('v-z', { m1: 4 }, { resolvedType: 'FLOAT', rawName: 'z' }),
      'v-z-layer': createVariable(
        'v-z-layer',
        { m1: 5 },
        { resolvedType: 'FLOAT', rawName: 'z-overlay' }
      )
    }
    setVariableMap(variables)
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )

    const resolver = createStyleVarResolver(
      new Map([
        ['--font-weight-main', 'v-font-weight'],
        ['--fontweight-main', 'v-fontweight'],
        ['--z-index-layer', 'v-z-index'],
        ['--z', 'v-z'],
        ['--z-overlay', 'v-z-layer']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver({
      fw: 'var(--font-weight-main)',
      fw2: 'var(--fontweight-main)',
      zIndex: 'var(--z-index-layer)',
      z: 'var(--z)',
      zLayer: 'var(--z-overlay)'
    })

    expect(result).toEqual({
      fw: '600',
      fw2: '650',
      zIndex: '3',
      z: '4',
      zLayer: '5'
    })
  })

  it('uses css value normalization when canonical token names are malformed', () => {
    const variable = createVariable(
      'v-weird',
      { m1: 12 },
      { resolvedType: 'FLOAT', rawName: 'Weird' }
    )
    setVariableMap({
      'v-weird': variable
    })
    vi.mocked(getVariableRawName).mockImplementation(
      (v: Variable) => (v as VariableLike).rawName ?? ''
    )
    vi.mocked(normalizeFigmaVarName)
      .mockImplementationOnce(() => '')
      .mockImplementationOnce(() => 'token-without-prefix')
      .mockImplementation((name: string) => {
        const trimmed = name.trim().toLowerCase()
        if (trimmed.startsWith('--')) return trimmed
        return `--${trimmed.replace(/[^a-z0-9]+/g, '-')}`
      })

    const resolver = createStyleVarResolver(
      new Map([
        ['--empty-canonical', 'v-weird'],
        ['--non-prefixed', 'v-weird']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver({
      a: 'var(--empty-canonical)',
      b: 'var(--non-prefixed)'
    })

    expect(result).toEqual({
      a: 'norm(12px)',
      b: 'norm(12px)'
    })
  })

  it('treats undefined canonical names as non-unitless float tokens', () => {
    const variable = createVariable('v-undef-canonical', { m1: 10 }, { resolvedType: 'FLOAT' })
    setVariableMap({
      'v-undef-canonical': variable
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Undefined Canonical')
    vi.mocked(normalizeFigmaVarName)
      .mockImplementationOnce((name: string) => name.trim().toLowerCase())
      .mockImplementationOnce(() => undefined as unknown as string)
      .mockImplementation((name: string) => {
        const trimmed = name.trim().toLowerCase()
        if (trimmed.startsWith('--')) return trimmed
        return `--${trimmed.replace(/[^a-z0-9]+/g, '-')}`
      })

    const resolver = createStyleVarResolver(
      new Map([['--v-undef-canonical', 'v-undef-canonical']]),
      new Map(),
      CONFIG
    )
    expect(resolver({ value: 'var(--v-undef-canonical)' })).toEqual({ value: 'norm(10px)' })
  })

  it('stringifies non-string formatHexAlpha output through literal fallback', () => {
    const colorA = createVariable(
      'v-color-a',
      { m1: { r: 1, g: 0, b: 0, a: 1 } },
      { resolvedType: 'COLOR' }
    )
    const colorB = createVariable(
      'v-color-b',
      { m1: { r: 0, g: 0, b: 1, a: 1 } },
      { resolvedType: 'COLOR' }
    )
    setVariableMap({
      'v-color-a': colorA,
      'v-color-b': colorB
    })
    vi.mocked(getVariableRawName).mockImplementation(() => 'Color')
    vi.mocked(formatHexAlpha)
      .mockReturnValueOnce(7 as unknown as string)
      .mockReturnValueOnce(Symbol('x') as unknown as string)

    const resolver = createStyleVarResolver(
      new Map([
        ['--color-a', 'v-color-a'],
        ['--color-b', 'v-color-b']
      ]),
      new Map(),
      CONFIG
    )

    const result = resolver({
      a: 'var(--color-a)',
      b: 'var(--color-b)'
    })

    expect(result).toEqual({
      a: '7',
      b: 'var(--color-b)'
    })
  })
})
