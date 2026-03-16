import { describe, expect, it } from 'vitest'

import {
  CodeBudgetExceededError,
  assertToolResponseWithinBudget,
  buildGetCodeWarnings,
  isCodeBudgetExceededError
} from '@/mcp/tools/code/messages'

describe('mcp/code messages', () => {
  it('throws when tool result exceeds inline budget', () => {
    expect(() =>
      assertToolResponseWithinBudget(
        {
          content: [{ type: 'text', text: 'hello world' }]
        },
        {
          maxResultBytes: 8
        }
      )
    ).toThrow('Tool result exceeds inline budget')

    let message = ''
    let budgetError: unknown
    try {
      assertToolResponseWithinBudget(
        {
          content: [{ type: 'text', text: 'hello world' }]
        },
        {
          maxResultBytes: 8
        }
      )
    } catch (error) {
      budgetError = error
      message = error instanceof Error ? error.message : String(error)
    }

    expect(budgetError).toBeInstanceOf(CodeBudgetExceededError)
    expect(isCodeBudgetExceededError(budgetError)).toBe(true)
    expect(message).toContain('UTF-8 bytes')
    expect(message).toContain('Reduce selection size')

    expect(() =>
      assertToolResponseWithinBudget(
        {
          content: [{ type: 'text', text: 'ok' }]
        },
        {
          maxResultBytes: 128
        }
      )
    ).not.toThrow()
  })

  it('builds warning list for auto-layout and depth cap with continuation hints', () => {
    const ids = Array.from({ length: 55 }, (_, i) => `n-${i % 10}`)
    const warnings = buildGetCodeWarnings('<div data-hint-auto-layout="inferred"></div>', {
      depthLimit: 3,
      cappedNodeIds: ids,
      requestArgs: {
        preferredLang: 'jsx',
        resolveTokens: true,
        vectorMode: 'snapshot'
      }
    })

    expect(warnings).toBeDefined()
    expect(warnings?.map((item) => item.type)).toEqual(['auto-layout', 'depth-cap'])
    const autoLayout = warnings?.find((item) => item.type === 'auto-layout')
    expect(autoLayout?.message).toContain('get_structure')
    expect(autoLayout?.message).not.toContain('get_screenshot')

    const depthCap = warnings?.find((item) => item.type === 'depth-cap')
    expect(depthCap?.data).toEqual({
      depthLimit: 3,
      cappedNodeIds: ['n-0', 'n-1', 'n-2', 'n-3', 'n-4', 'n-5', 'n-6', 'n-7', 'n-8', 'n-9'],
      cappedNodeCount: 10,
      cappedNodeOverflow: false,
      continuationTool: 'get_code',
      recommendedNextArgs: {
        nodeId: 'n-0',
        preferredLang: 'jsx',
        resolveTokens: true,
        vectorMode: 'snapshot'
      }
    })
  })

  it('returns undefined when no warning conditions are met', () => {
    expect(buildGetCodeWarnings('<div />')).toBeUndefined()
  })

  it('adds shell warning data with continuation hints', () => {
    const warnings = buildGetCodeWarnings('<div />', {
      shell: true,
      omittedNodeIds: ['a', 'b', 'c'],
      requestArgs: {
        preferredLang: 'vue',
        resolveTokens: false,
        vectorMode: 'smart'
      }
    })

    expect(warnings?.map((item) => item.type)).toEqual(['shell'])
    expect(warnings?.[0]?.message).toContain('Shell response')
    expect(warnings?.[0]?.message).toContain('inline comment')
    expect(warnings?.[0]?.data).toEqual({
      strategy: 'shell',
      omittedNodeIds: ['a', 'b', 'c'],
      omittedNodeCount: 3,
      omittedNodeOverflow: false,
      continuationTool: 'get_code',
      recommendedNextArgs: {
        nodeId: 'a',
        preferredLang: 'vue',
        resolveTokens: false,
        vectorMode: 'smart'
      }
    })
  })

  it('marks depth cap overflow and truncates id list to max 50', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`)
    const warnings = buildGetCodeWarnings('<div />', {
      cappedNodeIds: ids
    })
    const depthCap = warnings?.find((item) => item.type === 'depth-cap')
    const data = depthCap?.data as
      | {
          cappedNodeIds: string[]
          cappedNodeCount: number
          cappedNodeOverflow: boolean
        }
      | undefined

    expect(data?.cappedNodeIds).toHaveLength(50)
    expect(data?.cappedNodeCount).toBe(60)
    expect(data?.cappedNodeOverflow).toBe(true)
  })
})
