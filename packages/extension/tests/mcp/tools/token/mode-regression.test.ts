import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { processTokens } from '@/mcp/tools/code/tokens/process'
import { createStyleVarResolver } from '@/mcp/tools/code/tokens/resolve'
import { createTokenReadContext } from '@/mcp/tools/token/context'
import { resolveTokenDefsByIds, resolveTokenDefsByNames } from '@/mcp/tools/token/defs'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn(async (refs: { code: string }[]) => refs.map(({ code }) => code))
}))
vi.mock('@/ui/state', () => ({ activePlugin: { value: null } }))
vi.mock('@/mcp/tools/config', () => ({ currentCodegenConfig: () => config }))

const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
const consumer = (id: string, mode: string) =>
  ({ id, resolvedVariableModes: { semantic: 'only', palette: mode } }) as unknown as SceneNode

describe('token mode and request regressions', () => {
  let variables: Variable[]
  let semantic: Variable
  beforeEach(() => {
    vi.mocked(runTransformVariableBatch).mockImplementation(async (refs) =>
      refs.map(({ code }) => code)
    )
    const palette = {
      id: 'palette-var',
      name: 'palette',
      variableCollectionId: 'palette',
      resolvedType: 'STRING',
      valuesByMode: { light: 'LIGHT', dark: 'DARK' }
    } as unknown as Variable
    semantic = {
      id: 'semantic-var',
      name: 'semantic',
      variableCollectionId: 'semantic',
      resolvedType: 'STRING',
      valuesByMode: { only: { type: 'VARIABLE_ALIAS', id: palette.id } },
      resolveForConsumer: vi.fn((node: SceneNode) => ({
        resolvedType: 'STRING',
        value: palette.valuesByMode[node.resolvedVariableModes.palette!]!
      }))
    } as unknown as Variable
    variables = [semantic, palette]
    const collections = [
      {
        id: 'semantic',
        name: 'Semantic',
        defaultModeId: 'only',
        modes: [{ modeId: 'only', name: 'Default' }]
      },
      {
        id: 'palette',
        name: 'Palette',
        defaultModeId: 'light',
        modes: [
          { modeId: 'light', name: 'Light' },
          { modeId: 'dark', name: 'Dark' }
        ]
      }
    ]
    vi.stubGlobal('figma', {
      variables: {
        getLocalVariablesAsync: vi.fn(async () => variables),
        getVariableById: vi.fn((id: string) => variables.find((v) => v.id === id) ?? null),
        getVariableCollectionById: vi.fn(
          (id: string) => collections.find((c) => c.id === id) ?? null
        )
      }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['light', 'dark'],
    ['dark', 'light']
  ])('resolves aliases for each consumer in %s/%s order', (first, second) => {
    const resolve = createStyleVarResolver(
      new Map([['--semantic', semantic.id]]),
      new Map(),
      config
    )
    for (const mode of [first, second]) {
      expect(resolve({ color: 'var(--semantic)' }, consumer(mode, mode))).toEqual({
        color: mode.toUpperCase()
      })
    }
  })

  it('reads renamed, added, and deleted variables on the next request', async () => {
    expect(await resolveTokenDefsByNames(new Set(['--semantic']), config)).toHaveProperty(
      '--semantic'
    )
    variables = [
      { ...semantic, name: 'renamed', valuesByMode: { only: 'UPDATED' } } as Variable,
      { ...semantic, id: 'added', name: 'added', valuesByMode: { only: 'NEW' } } as Variable
    ]
    const result = await resolveTokenDefsByNames(
      new Set(['--renamed', '--added', '--semantic', '--palette']),
      config
    )
    expect(result).toHaveProperty('--renamed')
    expect(result['--renamed']?.value).toBe('UPDATED')
    expect(result['--added']?.value).toBe('NEW')
    expect(result).not.toHaveProperty('--semantic')
    expect(result).not.toHaveProperty('--palette')
  })

  it('keeps alias definitions independent of the consumer literal', async () => {
    const resolve = createStyleVarResolver(
      new Map([['--semantic', semantic.id]]),
      new Map(),
      config
    )
    expect(resolve({ color: 'var(--semantic)' }, consumer('dark-node', 'dark'))).toEqual({
      color: 'DARK'
    })
    const tokens = await resolveTokenDefsByNames(new Set(['--semantic']), config, undefined, {
      includeAllModes: true
    })
    expect(tokens).toEqual({
      '--semantic': { kind: 'string', value: '--palette' },
      '--palette': { kind: 'string', value: { 'Palette:Light': 'LIGHT', 'Palette:Dark': 'DARK' } }
    })
  })

  it('returns the same alias definitions with resolveTokens enabled or disabled', async () => {
    const input = {
      code: '<div style="color:var(--semantic)" />',
      variableIds: new Set([semantic.id]),
      usedCandidateIds: new Set<string>(),
      variableCache: new Map<string, Variable | null>(),
      styles: new Map([['node', { color: 'var(--semantic)' }]]),
      textSegments: new Map<string, StyledTextSegment[] | null>(),
      svgs: new Map(),
      config
    }
    const unresolved = await processTokens(input)
    const resolved = await processTokens({ ...input, resolveTokens: true })
    expect(resolved.tokensByCanonical).toEqual(unresolved.tokensByCanonical)
    expect(resolved.tokensByCanonical['--semantic']?.value).toBe('--palette')
    expect(figma.variables.getLocalVariablesAsync).not.toHaveBeenCalled()
  })

  it('traverses multi-hop aliases across every mode without expanding consumer values', async () => {
    const middle = {
      ...semantic,
      id: 'middle',
      name: 'middle',
      valuesByMode: { only: { type: 'VARIABLE_ALIAS', id: 'palette-var' } }
    } as Variable
    variables.push(middle)
    semantic = {
      ...semantic,
      valuesByMode: { only: { type: 'VARIABLE_ALIAS', id: middle.id } }
    } as Variable
    variables[0] = semantic
    const report = vi.fn()
    const tokens = await resolveTokenDefsByIds(
      new Map([['--semantic', semantic.id]]),
      createTokenReadContext(config),
      true,
      report
    )
    expect(tokens['--semantic']?.value).toBe('--middle')
    expect(tokens['--middle']?.value).toBe('--palette')
    expect(tokens['--palette']?.value).toEqual({ 'Palette:Light': 'LIGHT', 'Palette:Dark': 'DARK' })
    expect(report).not.toHaveBeenCalled()
    expect(semantic.resolveForConsumer).not.toHaveBeenCalled()
    expect(figma.variables.getLocalVariablesAsync).not.toHaveBeenCalled()
  })

  it('omits unavailable alias values rather than inventing an empty literal', async () => {
    variables = [semantic]
    const report = vi.fn()
    const tokens = await resolveTokenDefsByIds(
      new Map([['--semantic', semantic.id]]),
      createTokenReadContext(config),
      true,
      report
    )
    expect(tokens).toEqual({})
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Alias target palette-var'))
  })

  it('rejects ambiguous name lookups and preserves exact-ID reads', async () => {
    const duplicate = { ...semantic, id: 'duplicate', valuesByMode: { only: 'OTHER' } } as Variable
    variables.push(duplicate)
    await expect(resolveTokenDefsByNames(new Set(['--semantic']), config)).rejects.toThrow(
      'multiple variables'
    )
    expect(
      await resolveTokenDefsByIds(
        new Map([['--semantic', duplicate.id]]),
        createTokenReadContext(config)
      )
    ).toEqual({
      '--semantic': { kind: 'string', value: 'OTHER' }
    })
  })

  it('omits colliding dependency names instead of selecting one definition', async () => {
    variables.push({
      ...semantic,
      id: 'duplicate',
      name: 'palette',
      valuesByMode: { only: 'OTHER' }
    } as Variable)
    const report = vi.fn()
    const tokens = await resolveTokenDefsByIds(
      new Map([
        ['--semantic', semantic.id],
        ['--palette', 'duplicate']
      ]),
      createTokenReadContext(config),
      true,
      report
    )
    expect(tokens).not.toHaveProperty('--palette')
    expect(report).toHaveBeenCalledWith(expect.stringContaining('matches multiple variables'))
  })

  it('canonicalizes plugin names identically for used tokens, alias targets, and name lookups', async () => {
    vi.mocked(runTransformVariableBatch).mockImplementation(async (refs) =>
      refs.map(({ name }) => `$brand ${name}`)
    )
    const result = await processTokens({
      code: '<div style="color:var(--semantic)" />',
      variableIds: new Set([semantic.id]),
      usedCandidateIds: new Set(),
      variableCache: new Map(),
      styles: new Map(),
      textSegments: new Map(),
      svgs: new Map(),
      config,
      pluginCode: 'plugin'
    })
    expect(result.tokensByCanonical['--brand-semantic']?.value).toBe('--brand-palette')
    expect(
      await resolveTokenDefsByNames(new Set(['--brand-semantic']), config, 'plugin', {
        includeAllModes: true
      })
    ).toEqual(result.tokensByCanonical)
  })

  it('keeps renamed and unchanged definitions in code order without including unused candidates', async () => {
    variables.push({ ...semantic, id: 'unused', name: 'unused' } as Variable)
    vi.mocked(runTransformVariableBatch).mockImplementation(async (refs) =>
      refs.map(({ code, name }) => (name === 'semantic' ? 'var(--brand)' : code))
    )
    const result = await processTokens({
      code: '<div style="color:var(--palette);background:var(--semantic)" />',
      variableIds: new Set(variables.map(({ id }) => id)),
      usedCandidateIds: new Set(),
      variableCache: new Map(),
      styles: new Map(),
      textSegments: new Map(),
      svgs: new Map(),
      config,
      pluginCode: 'plugin'
    })
    expect(result.code).toBe('<div style="color:var(--palette);background:var(--brand)" />')
    expect(Object.keys(result.tokensByCanonical)).toEqual(['--palette', '--brand'])
    expect(result.tokensByCanonical['--brand']?.value).toBe('--palette')
    expect(result.tokensByCanonical['--palette']?.value).toEqual({
      'Palette:Light': 'LIGHT',
      'Palette:Dark': 'DARK'
    })
    expect(figma.variables.getLocalVariablesAsync).not.toHaveBeenCalled()
  })
})
