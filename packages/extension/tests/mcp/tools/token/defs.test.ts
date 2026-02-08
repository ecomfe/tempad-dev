import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

const mocks = vi.hoisted(() => ({
  getTokenIndex: vi.fn(),
  canonicalizeName: vi.fn(),
  canonicalizeNames: vi.fn(),
  getVariableRawName: vi.fn(),
  currentCodegenConfig: vi.fn(),
  formatHexAlpha: vi.fn(),
  normalizeCssValue: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn()
  },
  activePlugin: {
    value: null as { code?: string } | null
  }
}))

vi.mock('@/mcp/tools/token/indexer', () => ({
  getTokenIndex: mocks.getTokenIndex,
  canonicalizeName: mocks.canonicalizeName,
  canonicalizeNames: mocks.canonicalizeNames,
  getVariableRawName: mocks.getVariableRawName
}))

vi.mock('@/mcp/tools/config', () => ({
  currentCodegenConfig: mocks.currentCodegenConfig
}))

vi.mock('@/utils/css', () => ({
  formatHexAlpha: mocks.formatHexAlpha,
  normalizeCssValue: mocks.normalizeCssValue
}))

vi.mock('@/utils/log', () => ({
  logger: mocks.logger
}))

vi.mock('@/ui/state', () => ({
  activePlugin: mocks.activePlugin
}))

function createVariable(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {}
): Variable & {
  variableCollectionId?: string
  resolvedType?: string
} {
  return {
    id,
    name,
    variableCollectionId: 'collection-1',
    resolvedType: 'FLOAT',
    valuesByMode: { modeA: 16 },
    ...overrides
  } as unknown as Variable & {
    variableCollectionId?: string
    resolvedType?: string
  }
}

function createIndex() {
  return {
    byCanonicalName: new Map<string, string[]>(),
    canonicalNameById: new Map<string, string>()
  }
}

const TEST_CONFIG: CodegenConfig = {
  cssUnit: 'rem',
  rootFontSize: 16,
  scale: 1
}

describe('mcp/tools/token/defs', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.currentCodegenConfig.mockReturnValue(TEST_CONFIG)
    mocks.activePlugin.value = null
    mocks.normalizeCssValue.mockImplementation((value: string) => `norm(${value})`)
    mocks.formatHexAlpha.mockReturnValue('#112233')
    mocks.getVariableRawName.mockImplementation((variable: { name: string }) => variable.name)
    mocks.canonicalizeName.mockImplementation(async (name: string) => `--${name.toLowerCase()}`)
    mocks.canonicalizeNames.mockImplementation(async (names: string[]) =>
      names.map((name) => `--${name.toLowerCase()}`)
    )
  })

  it('normalizes token names and enforces payload size guard', async () => {
    const mod = await import('@/mcp/tools/token/defs')
    const normal = createVariable('id-normal', 'a', {
      resolvedType: 'STRING',
      valuesByMode: { modeA: 'ok' }
    })
    const huge = createVariable('id-huge', 'big', {
      resolvedType: 'STRING',
      valuesByMode: { modeA: 'x'.repeat(MCP_MAX_PAYLOAD_BYTES) }
    })

    const index = createIndex()
    index.byCanonicalName.set('--a', ['id-normal'])
    index.byCanonicalName.set('--b', ['id-normal'])
    index.byCanonicalName.set('--big', ['id-huge'])
    index.canonicalNameById.set('id-normal', '--a')
    index.canonicalNameById.set('id-huge', '--big')
    mocks.getTokenIndex.mockResolvedValue(index)
    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      variables: {
        getVariableById: vi.fn((id: string) => {
          if (id === 'id-normal') return normal
          if (id === 'id-huge') return huge
          return null
        }),
        getVariableCollectionById: vi.fn(() => ({
          id: 'collection-1',
          name: 'Theme',
          defaultModeId: 'modeA',
          modes: [{ modeId: 'modeA', name: 'Light' }]
        })),
        getVariableModeId: vi.fn(() => 'modeA')
      }
    } as unknown as PluginAPI

    await expect(mod.handleGetTokenDefs(['a', '--b'], false)).resolves.toEqual({
      '--a': { kind: 'string', value: 'ok' }
    })

    await expect(mod.handleGetTokenDefs(['big'])).rejects.toThrow(
      'Token payload too large to return. Reduce selection or requested names and retry.'
    )
  })

  it('resolves candidates directly when candidateNameById is provided', async () => {
    const mod = await import('@/mcp/tools/token/defs')
    const variable = createVariable('id-1', 'Spacing/Small', {
      valuesByMode: { modeA: 12 }
    })
    const index = createIndex()
    index.canonicalNameById.set('id-1', '--spacing-small')
    mocks.getTokenIndex.mockResolvedValue(index)
    const getVariableById = vi.fn((id: string) => (id === 'id-1' ? variable : null))

    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      variables: {
        getVariableById,
        getVariableCollectionById: vi.fn(() => ({
          id: 'collection-1',
          name: 'Theme',
          defaultModeId: 'modeA',
          modes: [{ modeId: 'modeA', name: 'Light' }]
        })),
        getVariableModeId: vi.fn(() => 'modeA')
      }
    } as unknown as PluginAPI

    const result = await mod.resolveTokenDefsByNames(
      new Set(['--spacing-small']),
      TEST_CONFIG,
      undefined,
      {
        candidateIds: new Set(['id-1']),
        candidateNameById: new Map([['id-1', '--spacing-small']])
      }
    )

    expect(result).toEqual({
      '--spacing-small': { kind: 'number', value: 'norm(12px)' }
    })
    expect(mocks.getTokenIndex).toHaveBeenCalledTimes(1)
  })

  it('returns alias names when resolveValues is false and includes alias dependencies', async () => {
    const mod = await import('@/mcp/tools/token/defs')

    const aliasVar = createVariable('id-a', 'Alias/A', {
      valuesByMode: { modeA: { id: 'id-b' } }
    })
    const targetVar = createVariable('id-b', 'Size/Base', {
      valuesByMode: { modeA: 16 }
    })

    const index = createIndex()
    index.byCanonicalName.set('--a', ['id-a'])
    index.canonicalNameById.set('id-a', '--a')
    index.canonicalNameById.set('id-b', '--b')
    mocks.getTokenIndex.mockResolvedValue(index)
    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      variables: {
        getVariableById: vi.fn((id: string) => {
          if (id === 'id-a') return aliasVar
          if (id === 'id-b') return targetVar
          return null
        }),
        getVariableCollectionById: vi.fn(() => ({
          id: 'collection-1',
          name: 'Theme',
          defaultModeId: 'modeA',
          modes: [{ modeId: 'modeA', name: 'Light' }]
        })),
        getVariableModeId: vi.fn(() => 'modeA')
      }
    } as unknown as PluginAPI

    const result = await mod.resolveTokenDefsByNames(new Set(['--a']), TEST_CONFIG, undefined, {
      resolveValues: false
    })

    expect(result).toEqual({
      '--a': { kind: 'number', value: '--b' },
      '--b': { kind: 'number', value: 'norm(16px)' }
    })
  })

  it('returns per-mode token values when includeAllModes is enabled', async () => {
    const mod = await import('@/mcp/tools/token/defs')

    const variable = createVariable('id-space', 'Space/Base', {
      valuesByMode: { modeA: 16, modeB: 24 }
    })
    const index = createIndex()
    index.byCanonicalName.set('--space-base', ['id-space'])
    index.canonicalNameById.set('id-space', '--space-base')
    mocks.getTokenIndex.mockResolvedValue(index)
    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      variables: {
        getVariableById: vi.fn((id: string) => (id === 'id-space' ? variable : null)),
        getVariableCollectionById: vi.fn(() => ({
          id: 'collection-1',
          name: 'Theme',
          defaultModeId: 'modeA',
          modes: [
            { modeId: 'modeA', name: 'Light' },
            { modeId: 'modeB', name: 'Dark' }
          ]
        })),
        getVariableModeId: vi.fn(() => 'modeB')
      }
    } as unknown as PluginAPI

    const result = await mod.resolveTokenDefsByNames(
      new Set(['--space-base']),
      TEST_CONFIG,
      undefined,
      { includeAllModes: true, resolveValues: true }
    )

    expect(result).toEqual({
      '--space-base': {
        kind: 'number',
        value: {
          'Theme:Light': 'norm(16px)',
          'Theme:Dark': 'norm(24px)'
        }
      }
    })
  })
})
