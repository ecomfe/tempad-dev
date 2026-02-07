import { describe, expect, it } from 'vitest'

import { buildGetCodeWarnings, truncateCode } from '@/mcp/tools/code/messages'

describe('mcp/code messages', () => {
  it('truncates markup when over size limit', () => {
    expect(truncateCode('<div>abc</div>', 8)).toEqual({
      code: '<div>abc',
      truncated: true
    })
    expect(truncateCode('<div>abc</div>', 20)).toEqual({
      code: '<div>abc</div>',
      truncated: false
    })
  })

  it('builds warning list for truncation, auto-layout and depth cap', () => {
    const ids = Array.from({ length: 55 }, (_, i) => `n-${i % 10}`)
    const warnings = buildGetCodeWarnings(
      '<div data-hint-auto-layout="inferred"></div>',
      1024,
      true,
      {
        depthLimit: 3,
        cappedNodeIds: ids
      }
    )

    expect(warnings).toBeDefined()
    expect(warnings?.map((item) => item.type)).toEqual(['truncated', 'auto-layout', 'depth-cap'])

    const depthCap = warnings?.find((item) => item.type === 'depth-cap')
    expect(depthCap?.data).toEqual({
      depthLimit: 3,
      cappedNodeIds: ['n-0', 'n-1', 'n-2', 'n-3', 'n-4', 'n-5', 'n-6', 'n-7', 'n-8', 'n-9'],
      cappedNodeCount: 10,
      cappedNodeOverflow: false
    })
  })

  it('returns undefined when no warning conditions are met', () => {
    expect(buildGetCodeWarnings('<div />', 1000, false)).toBeUndefined()
  })

  it('marks depth cap overflow and truncates id list to max 50', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`)
    const warnings = buildGetCodeWarnings('<div />', 1000, false, { cappedNodeIds: ids })
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
