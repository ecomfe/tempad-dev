import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

import { getVariableByIdCached } from '@/mcp/tools/code/tokens/cache'
import { buildUsedTokens } from '@/mcp/tools/code/tokens/used'
import { resolveTokenDefsByNames } from '@/mcp/tools/token'
import { canonicalizeNames, getVariableRawName } from '@/mcp/tools/token/indexer'
import { normalizeFigmaVarName } from '@/utils/css'

vi.mock('@/utils/css', () => ({
  normalizeFigmaVarName: vi.fn((name: string) => `--norm-${name}`)
}))

vi.mock('@/mcp/tools/token', () => ({
  resolveTokenDefsByNames: vi.fn()
}))

vi.mock('@/mcp/tools/token/indexer', () => ({
  canonicalizeNames: vi.fn(),
  getVariableRawName: vi.fn()
}))

vi.mock('@/mcp/tools/code/tokens/cache', () => ({
  getVariableByIdCached: vi.fn()
}))

const CONFIG: CodegenConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
}

function variable(id: string): Variable {
  return {
    id
  } as unknown as Variable
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('tokens/used buildUsedTokens', () => {
  it('returns empty token map when final bridge is empty', async () => {
    const result = await buildUsedTokens(new Map(), CONFIG)

    expect(result).toEqual({ tokensByCanonical: {} })
    expect(getVariableByIdCached).not.toHaveBeenCalled()
    expect(resolveTokenDefsByNames).not.toHaveBeenCalled()
  })

  it('resolves canonical names and forwards candidate metadata to token resolver', async () => {
    vi.mocked(getVariableByIdCached)
      .mockReturnValueOnce(variable('var-1'))
      .mockReturnValueOnce(variable('var-2'))
    vi.mocked(getVariableRawName)
      .mockReturnValueOnce('color.primary')
      .mockReturnValueOnce('space.md')
    vi.mocked(canonicalizeNames).mockResolvedValue(['--brand-color', '--space-md'])
    vi.mocked(resolveTokenDefsByNames).mockResolvedValue({
      '--brand-color': { kind: 'color', value: '#fff' }
    })

    const result = await buildUsedTokens(
      new Map([
        ['--first', 'var-1'],
        ['--second', 'var-2']
      ]),
      CONFIG,
      'plugin-code',
      new Map(),
      {
        includeAllModes: true,
        resolveValues: true
      }
    )

    expect(result.tokensByCanonical).toEqual({
      '--brand-color': { kind: 'color', value: '#fff' }
    })

    const call = vi.mocked(resolveTokenDefsByNames).mock.calls[0]
    const nameSet = call[0] as Set<string>
    const options = call[3] as {
      includeAllModes: boolean
      resolveValues: boolean
      candidateIds: Set<string>
      candidateNameById: Map<string, string>
    }

    expect(nameSet).toEqual(new Set(['--brand-color', '--space-md']))
    expect(options.includeAllModes).toBe(true)
    expect(options.resolveValues).toBe(true)
    expect(options.candidateIds).toEqual(new Set(['var-1', 'var-2']))
    expect(options.candidateNameById).toEqual(
      new Map([
        ['var-1', '--brand-color'],
        ['var-2', '--space-md']
      ])
    )
  })

  it('falls back to normalized figma name when canonicalize output is missing', async () => {
    vi.mocked(getVariableByIdCached).mockReturnValueOnce(variable('var-1'))
    vi.mocked(getVariableRawName).mockReturnValueOnce('Color Primary')
    vi.mocked(canonicalizeNames).mockResolvedValue([undefined as unknown as string])
    vi.mocked(resolveTokenDefsByNames).mockResolvedValue({})

    await buildUsedTokens(new Map([['--first', 'var-1']]), CONFIG)

    expect(normalizeFigmaVarName).toHaveBeenCalledWith('Color Primary')
    const call = vi.mocked(resolveTokenDefsByNames).mock.calls[0]
    expect(call[0]).toEqual(new Set(['--norm-Color Primary']))
    expect(call[3]).toMatchObject({
      includeAllModes: false,
      resolveValues: false
    })
  })

  it('ignores missing variables while keeping candidate ids from final bridge', async () => {
    vi.mocked(getVariableByIdCached)
      .mockReturnValueOnce(variable('var-1'))
      .mockReturnValueOnce(null)
    vi.mocked(getVariableRawName).mockReturnValueOnce('color.primary')
    vi.mocked(canonicalizeNames).mockResolvedValue(['--brand-color'])
    vi.mocked(resolveTokenDefsByNames).mockResolvedValue({})

    await buildUsedTokens(
      new Map([
        ['--first', 'var-1'],
        ['--missing', 'var-2']
      ]),
      CONFIG
    )

    const call = vi.mocked(resolveTokenDefsByNames).mock.calls[0]
    const options = call[3] as {
      candidateIds: Set<string>
      candidateNameById: Map<string, string>
    }
    expect(options.candidateIds).toEqual(new Set(['var-1', 'var-2']))
    expect(options.candidateNameById).toEqual(new Map([['var-1', '--brand-color']]))
  })
})
