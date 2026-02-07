import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  canonicalizeName,
  canonicalizeNames,
  getTokenIndex,
  getVariableRawName
} from '@/mcp/tools/token/indexer'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { normalizeFigmaVarName } from '@/utils/css'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn()
}))

function setLocalVariables(variables: Variable[]) {
  const getLocalVariablesAsync = vi.fn(async () => variables)
  ;(globalThis as { figma?: PluginAPI }).figma = {
    variables: {
      getLocalVariablesAsync
    }
  } as unknown as PluginAPI
  return getLocalVariablesAsync
}

const config = {
  cssUnit: 'rem',
  rootFontSize: 16,
  scale: 1
} as const

describe('token/indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as { figma?: PluginAPI }).figma
  })

  it('prefers usable codeSyntax names and falls back to variable names', () => {
    expect(
      getVariableRawName({
        name: 'Ignored Name',
        codeSyntax: { WEB: 'var(--brand-color)' }
      } as unknown as Variable)
    ).toBe('brand-color')

    expect(
      getVariableRawName({
        name: 'Ignored Name',
        codeSyntax: { WEB: '$space_lg' }
      } as unknown as Variable)
    ).toBe('space_lg')

    expect(
      getVariableRawName({
        name: 'Ignored Name',
        codeSyntax: { WEB: 'kui-color-brand' }
      } as unknown as Variable)
    ).toBe('kui-color-brand')

    expect(
      getVariableRawName({
        name: '  --FromName  ',
        codeSyntax: { WEB: 'not a valid token!' }
      } as unknown as Variable)
    ).toBe('FromName')

    expect(getVariableRawName({ name: 'Plain Name' } as unknown as Variable)).toBe('Plain Name')
    expect(getVariableRawName({} as unknown as Variable)).toBe('')
  })

  it('returns empty canonical list when no raw names are provided', async () => {
    expect(await canonicalizeNames([], config, 'plugin-empty')).toEqual([])
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('canonicalizes names in chunks and falls back for non-var transform output', async () => {
    const rawNames = Array.from({ length: 301 }, (_, i) => `name-${i}`)
    vi.mocked(runTransformVariableBatch)
      .mockResolvedValueOnce(Array.from({ length: 300 }, () => 'var(--batch-canonical)'))
      .mockResolvedValueOnce(['invalid-expression'])

    const result = await canonicalizeNames(rawNames, config, 'plugin-chunk')

    expect(result).toHaveLength(301)
    expect(result[0]).toBe('--batch-canonical')
    expect(result[299]).toBe('--batch-canonical')
    expect(result[300]).toBe(normalizeFigmaVarName('name-300'))

    expect(runTransformVariableBatch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runTransformVariableBatch).mock.calls[0]?.[0]).toHaveLength(300)
    expect(vi.mocked(runTransformVariableBatch).mock.calls[1]?.[0]).toHaveLength(1)
    expect(vi.mocked(runTransformVariableBatch).mock.calls[0]?.[1]).toEqual({
      useRem: true,
      rootFontSize: 16,
      scale: 1
    })
  })

  it('uses generated fallback code when a transformed entry is undefined', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValueOnce([undefined as unknown as string])

    const result = await canonicalizeNames(['fallback-only'], config, 'plugin-undefined')

    expect(result).toEqual(['--fallback-only'])
  })

  it('falls back to normalized figma name when canonicalize batch returns no entry', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValueOnce([])

    const result = await canonicalizeName('Fallback Token Name', config, 'plugin-fallback')

    expect(result).toBe(normalizeFigmaVarName('Fallback Token Name'))
  })

  it('builds token index with collision buckets and per-variable fallback canonical names', async () => {
    const getLocalVariablesAsync = setLocalVariables([
      { id: 'v-1', name: 'Color Brand' } as unknown as Variable,
      { id: 'v-2', name: 'Color Accent' } as unknown as Variable,
      { id: 'v-3', name: 'Third Token' } as unknown as Variable
    ])
    vi.mocked(runTransformVariableBatch).mockResolvedValueOnce([
      'var(--shared-token)',
      'var(--shared-token)'
    ])

    const result = await getTokenIndex({ ...config, scale: 11 }, 'plugin-index')

    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(1)
    expect(result.totalVariables).toBe(3)
    expect(result.canonicalNameById.get('v-1')).toBe('--shared-token')
    expect(result.canonicalNameById.get('v-2')).toBe('--shared-token')
    expect(result.canonicalNameById.get('v-3')).toBe(normalizeFigmaVarName('Third Token'))
    expect(result.byCanonicalName.get('--shared-token')).toEqual(['v-1', 'v-2'])
    expect(result.byCanonicalName.get(normalizeFigmaVarName('Third Token'))).toEqual(['v-3'])
  })

  it('reuses cached token index when cache key is unchanged', async () => {
    const getLocalVariablesAsync = setLocalVariables([
      { id: 'cached-1', name: 'Cached Token' } as unknown as Variable
    ])
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['var(--cached-token)'])

    const first = getTokenIndex({ ...config, scale: 21 }, 'plugin-cache')
    const second = getTokenIndex({ ...config, scale: 21 }, 'plugin-cache')

    expect(await first).toEqual(await second)
    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(1)
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
  })

  it('rebuilds token index when cache key changes', async () => {
    const getLocalVariablesAsync = setLocalVariables([
      { id: 'cache-key-1', name: 'Cache Key Token' } as unknown as Variable
    ])
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['var(--cache-key-token)'])

    await getTokenIndex({ ...config, scale: 31 }, undefined)
    await getTokenIndex({ ...config, scale: 31 }, undefined)
    await getTokenIndex({ ...config, scale: 32 }, undefined)
    await getTokenIndex({ ...config, scale: 32 }, 'plugin-key')

    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(3)
    expect(runTransformVariableBatch).toHaveBeenCalledTimes(3)
  })
})
