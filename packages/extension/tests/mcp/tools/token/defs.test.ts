import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

const mocks = vi.hoisted(() => ({
  canonicalizeName: vi.fn(),
  canonicalizeNames: vi.fn(),
  getVariableRawName: vi.fn(),
  formatHexAlpha: vi.fn(),
  normalizeCssValue: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/mcp/tools/token/indexer', () => ({
  canonicalizeName: mocks.canonicalizeName,
  canonicalizeNames: mocks.canonicalizeNames,
  getVariableRawName: mocks.getVariableRawName
}))

vi.mock('@/utils/css', () => ({
  formatHexAlpha: mocks.formatHexAlpha,
  normalizeCssValue: mocks.normalizeCssValue
}))

vi.mock('@/utils/log', () => ({
  logger: mocks.logger
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

const TEST_CONFIG: CodegenConfig = {
  cssUnit: 'rem',
  rootFontSize: 16,
  scale: 1
}

describe('mcp/tools/token/defs', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.normalizeCssValue.mockImplementation((value: string) => `norm(${value})`)
    mocks.formatHexAlpha.mockReturnValue('#112233')
    mocks.getVariableRawName.mockImplementation((variable: { name: string }) => variable.name)
    mocks.canonicalizeName.mockImplementation(async (name: string) => `--${name.toLowerCase()}`)
    mocks.canonicalizeNames.mockImplementation(async (names: string[]) =>
      names.map((name) => `--${name.toLowerCase()}`)
    )
  })

  it('resolves exact candidate IDs without building a full index', async () => {
    const mod = await import('@/mcp/tools/token/defs')
    const { createTokenReadContext } = await import('@/mcp/tools/token/context')
    const variable = createVariable('id-1', 'Spacing/Small', {
      valuesByMode: { modeA: 12 }
    })
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

    const result = await mod.resolveTokenDefsByIds(
      new Map([['--spacing-small', 'id-1']]),
      createTokenReadContext(TEST_CONFIG)
    )

    expect(result).toEqual({
      '--spacing-small': { kind: 'number', value: 'norm(12px)' }
    })
  })

  it('preserves alias definitions and includes alias dependencies', async () => {
    const mod = await import('@/mcp/tools/token/defs')
    const { createTokenReadContext } = await import('@/mcp/tools/token/context')

    const aliasVar = createVariable('id-a', 'Alias/A', {
      valuesByMode: { modeA: { id: 'id-b' } }
    })
    const targetVar = createVariable('id-b', 'B', {
      valuesByMode: { modeA: 16 }
    })

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

    const result = await mod.resolveTokenDefsByIds(
      new Map([['--a', 'id-a']]),
      createTokenReadContext(TEST_CONFIG)
    )

    expect(result).toEqual({
      '--a': { kind: 'number', value: '--b' },
      '--b': { kind: 'number', value: 'norm(16px)' }
    })
  })

  it('returns values for all modes', async () => {
    const mod = await import('@/mcp/tools/token/defs')
    const { createTokenReadContext } = await import('@/mcp/tools/token/context')

    const variable = createVariable('id-space', 'Space/Base', {
      valuesByMode: { modeA: 16, modeB: 24 }
    })
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

    const result = await mod.resolveTokenDefsByIds(
      new Map([['--space-base', 'id-space']]),
      createTokenReadContext(TEST_CONFIG)
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
