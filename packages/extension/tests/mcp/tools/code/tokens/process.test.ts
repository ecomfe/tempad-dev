import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

import { resolveCodeBudget } from '@/mcp/tools/code/messages'
import { createTokenMatcher, extractTokenNames } from '@/mcp/tools/code/tokens/extract'
import { processTokens } from '@/mcp/tools/code/tokens/process'
import { filterBridge, rewriteTokenNamesInCode } from '@/mcp/tools/code/tokens/rewrite'
import { buildSourceNameIndex } from '@/mcp/tools/code/tokens/source-index'
import { applyPluginTransformToNames } from '@/mcp/tools/code/tokens/transform'
import { buildUsedTokens } from '@/mcp/tools/code/tokens/used'
import { stripFallback } from '@/utils/css'

vi.mock('@/utils/css', () => ({
  stripFallback: vi.fn((code: string) => code.replace('/*fallback*/', ''))
}))

vi.mock('@/mcp/tools/code/tokens/extract', () => ({
  extractTokenNames: vi.fn(),
  createTokenMatcher: vi.fn()
}))

vi.mock('@/mcp/tools/code/tokens/rewrite', () => ({
  rewriteTokenNamesInCode: vi.fn((code: string) => code),
  filterBridge: vi.fn((bridge: Map<string, string>) => bridge)
}))

vi.mock('@/mcp/tools/code/tokens/source-index', () => ({
  buildSourceNameIndex: vi.fn()
}))

vi.mock('@/mcp/tools/code/tokens/transform', () => ({
  applyPluginTransformToNames: vi.fn()
}))

vi.mock('@/mcp/tools/code/tokens/used', () => ({
  buildUsedTokens: vi.fn()
}))

const CONFIG: CodegenConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
}
const BUDGET = {
  ...resolveCodeBudget(1024 * 1024),
  maxCodeBytes: 20
}

const baseInput = () => ({
  code: 'const a = "/*fallback*/ var(--token)";',
  budget: BUDGET,
  variableIds: new Set<string>(['var-1']),
  usedCandidateIds: new Set<string>(),
  variableCache: new Map<string, Variable | null>(),
  styles: new Map<string, Record<string, string>>(),
  textSegments: new Map<string, StyledTextSegment[] | null>(),
  config: CONFIG
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('tokens/process processTokens', () => {
  it('returns early when source index has no names', async () => {
    vi.mocked(buildSourceNameIndex).mockReturnValue(new Map())

    const result = await processTokens(baseInput())

    expect(stripFallback).toHaveBeenCalled()
    expect(result).toEqual({
      code: 'const a = " var(--token)";',
      tokensByCanonical: {},
      sourceIndex: new Map()
    })
    expect(extractTokenNames).not.toHaveBeenCalled()
  })

  it('returns early when no token names are detected in code', async () => {
    vi.mocked(buildSourceNameIndex).mockReturnValue(new Map([['--token', 'var-1']]))
    vi.mocked(extractTokenNames).mockReturnValue(new Set())

    const result = await processTokens(baseInput())

    expect(result.tokensByCanonical).toEqual({})
    expect(result.sourceIndex).toEqual(new Map([['--token', 'var-1']]))
    expect(applyPluginTransformToNames).not.toHaveBeenCalled()
  })

  it('throws when rewritten code exceeds the output budget', async () => {
    vi.mocked(buildSourceNameIndex).mockReturnValue(new Map([['--token', 'var-1']]))
    vi.mocked(extractTokenNames).mockReturnValue(new Set(['--token']))
    vi.mocked(applyPluginTransformToNames).mockResolvedValue({
      rewriteMap: new Map([['--token', '--renamed']]),
      finalBridge: new Map()
    })
    vi.mocked(rewriteTokenNamesInCode).mockReturnValue('X'.repeat(100))
    vi.mocked(filterBridge).mockReturnValue(new Map())

    const stamps: Array<string> = []
    await expect(
      processTokens({
        ...baseInput(),
        stamp: (label) => {
          stamps.push(label)
        },
        now: (() => {
          let t = 0
          return () => {
            t += 1
            return t
          }
        })()
      })
    ).rejects.toThrow('Output exceeds token/context budget')

    expect(stamps).toEqual(['tokens:detect'])
    expect(buildUsedTokens).not.toHaveBeenCalled()
  })

  it('builds token matcher and resolve node ids when resolveTokens is enabled', async () => {
    const matcher = vi.fn((value: string) => value.includes('--token'))

    vi.mocked(buildSourceNameIndex).mockReturnValue(new Map([['--token', 'var-1']]))
    vi.mocked(extractTokenNames).mockReturnValue(new Set(['--token']))
    vi.mocked(applyPluginTransformToNames).mockResolvedValue({
      rewriteMap: new Map(),
      finalBridge: new Map([['--token', 'var-1']])
    })
    vi.mocked(buildUsedTokens).mockResolvedValue({
      tokensByCanonical: {
        '--token': {
          kind: 'color',
          value: '#fff'
        }
      }
    })
    vi.mocked(createTokenMatcher).mockReturnValue(matcher)

    const result = await processTokens({
      ...baseInput(),
      resolveTokens: true,
      styles: new Map([
        ['node-a', { color: 'var(--token)' }],
        ['node-b', { color: '#000' }]
      ]),
      textSegments: new Map([
        ['node-c', null],
        ['node-d', []]
      ])
    })

    expect(createTokenMatcher).toHaveBeenCalledWith(new Set(['--token']))
    expect(result.tokenMatcher).toBe(matcher)
    expect(result.resolveNodeIds).toEqual(new Set(['node-a', 'node-c', 'node-d']))
  })

  it('does not create matcher when resolved token set is empty', async () => {
    vi.mocked(buildSourceNameIndex).mockReturnValue(new Map([['--token', 'var-1']]))
    vi.mocked(extractTokenNames).mockReturnValue(new Set(['--token']))
    vi.mocked(applyPluginTransformToNames).mockResolvedValue({
      rewriteMap: new Map(),
      finalBridge: new Map([['--token', 'var-1']])
    })
    vi.mocked(buildUsedTokens).mockResolvedValue({
      tokensByCanonical: {}
    })

    const result = await processTokens({
      ...baseInput(),
      resolveTokens: true
    })

    expect(result.tokenMatcher).toBeUndefined()
    expect(result.resolveNodeIds).toBeUndefined()
  })

  it('merges candidate ids and records used-stage stamp with partial rename map', async () => {
    const matcher = vi.fn((value: string) => value.includes('--token'))
    const sourceIndex = new Map([
      ['--token', 'var-1'],
      ['--other', 'var-2']
    ])

    vi.mocked(buildSourceNameIndex).mockReturnValue(sourceIndex)
    vi.mocked(extractTokenNames).mockReturnValue(new Set(['--token', '--other']))
    vi.mocked(applyPluginTransformToNames).mockResolvedValue({
      rewriteMap: new Map([['--token', '--renamed']]),
      finalBridge: new Map([['--renamed', 'var-1']])
    })
    vi.mocked(rewriteTokenNamesInCode).mockReturnValue('short')
    vi.mocked(filterBridge).mockReturnValue(new Map([['--renamed', 'var-1']]))
    vi.mocked(buildUsedTokens).mockResolvedValue({
      tokensByCanonical: {
        '--renamed': {
          kind: 'color',
          value: '#fff'
        }
      }
    })
    vi.mocked(createTokenMatcher).mockReturnValue(matcher)

    const stamps: string[] = []
    const result = await processTokens({
      ...baseInput(),
      resolveTokens: true,
      usedCandidateIds: new Set(['var-2']),
      styles: new Map([
        [
          'node-a',
          {
            empty: '',
            plain: '#000',
            token: 'var(--token)'
          }
        ]
      ]),
      stamp: (label) => {
        stamps.push(label)
      },
      now: (() => {
        let t = 100
        return () => {
          t += 1
          return t
        }
      })()
    })

    const mergedIds = vi.mocked(buildSourceNameIndex).mock.calls[0][0] as Set<string>
    expect(mergedIds).toEqual(new Set(['var-1', 'var-2']))
    expect(stamps).toEqual(['tokens:detect', 'tokens:rewrite', 'tokens:used'])
    expect(result.code).toBe('short')
    expect(result.resolveNodeIds).toEqual(new Set(['node-a']))
  })
})
