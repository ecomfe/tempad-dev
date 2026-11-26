import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalizeName, canonicalizeNames, getVariableRawName } from '@/mcp/tools/token/indexer'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { normalizeFigmaVarName } from '@/utils/css'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn()
}))

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

  it('uses Figma variable names as raw names', () => {
    expect(
      getVariableRawName({
        name: 'Variable Name',
        codeSyntax: { WEB: 'var(--brand-color)' }
      } as unknown as Variable)
    ).toBe('Variable Name')

    expect(
      getVariableRawName({
        name: 'Variable Name',
        codeSyntax: { WEB: '$space_lg' }
      } as unknown as Variable)
    ).toBe('Variable Name')

    expect(
      getVariableRawName({
        name: 'Variable Name',
        codeSyntax: { WEB: 'kui-color-brand' }
      } as unknown as Variable)
    ).toBe('Variable Name')

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
      .mockResolvedValueOnce(['calc(1px)'])

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

  it('converts plugin aliases into CSS names while discarding expressions', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValueOnce([
      '$accent',
      'theme.colors.primary',
      'theme.colors.500',
      '.5',
      'theme..colors'
    ])

    await expect(canonicalizeNames(['a', 'b', 'c', 'd', 'e'], config, 'plugin')).resolves.toEqual([
      '--accent',
      '--theme-colors-primary',
      '--theme-colors-500',
      '--d',
      '--e'
    ])
  })

  it('uses figma-style normalized variable names throughout the canonicalization pipeline', async () => {
    const rawName = 'Text colors/Primary/color-text-primary'
    const normalized = normalizeFigmaVarName(rawName)
    vi.mocked(runTransformVariableBatch).mockResolvedValueOnce([undefined as unknown as string])

    const result = await canonicalizeNames([rawName], config, 'plugin-standard')

    expect(runTransformVariableBatch).toHaveBeenCalledWith(
      [
        {
          code: `var(${normalized})`,
          name: normalized.slice(2)
        }
      ],
      {
        useRem: true,
        rootFontSize: 16,
        scale: 1
      },
      'plugin-standard'
    )
    expect(result).toEqual([normalized])
  })

  it('falls back to normalized figma name when canonicalize batch returns no entry', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValueOnce([])

    const result = await canonicalizeName('Fallback Token Name', config, 'plugin-fallback')

    expect(result).toBe(normalizeFigmaVarName('Fallback Token Name'))
  })
})
