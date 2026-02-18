import { describe, expect, it } from 'vitest'

import { assertCodeWithinBudget, buildGetCodeWarnings } from '@/mcp/tools/code/messages'

describe('mcp/code messages', () => {
  it('throws when markup exceeds size budget', () => {
    expect(() =>
      assertCodeWithinBudget('<div>abc</div>', {
        maxCodeBytes: 8,
        maxCodeChars: 8,
        estimatedTokenBudget: 2
      })
    ).toThrow('Output exceeds token/context budget')

    expect(() =>
      assertCodeWithinBudget('<div>abc</div>', {
        maxCodeBytes: 20,
        maxCodeChars: 20,
        estimatedTokenBudget: 5
      })
    ).not.toThrow()
  })

  it('builds warning list for auto-layout and depth cap', () => {
    const ids = Array.from({ length: 55 }, (_, i) => `n-${i % 10}`)
    const warnings = buildGetCodeWarnings('<div data-hint-auto-layout="inferred"></div>', {
      depthLimit: 3,
      cappedNodeIds: ids
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
      cappedNodeOverflow: false
    })
  })

  it('returns undefined when no warning conditions are met', () => {
    expect(buildGetCodeWarnings('<div />')).toBeUndefined()
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
