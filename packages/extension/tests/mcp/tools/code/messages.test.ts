import { describe, expect, it } from 'vitest'

import {
  CodeBudgetExceededError,
  assertToolResponseWithinBudget,
  buildGetCodeWarnings
} from '@/mcp/tools/code/messages'

describe('mcp/code messages', () => {
  it('throws when tool result exceeds inline budget', () => {
    const fail = () =>
      assertToolResponseWithinBudget({ content: [{ type: 'text', text: 'hello world' }] }, 8)
    expect(fail).toThrow(CodeBudgetExceededError)
    expect(fail).toThrow(/UTF-8 bytes.*Reduce selection size/)

    expect(() =>
      assertToolResponseWithinBudget({ content: [{ type: 'text', text: 'ok' }] }, 128)
    ).not.toThrow()
  })

  it('builds warning list for auto-layout and depth cap', () => {
    const warnings = buildGetCodeWarnings('<div data-hint-auto-layout="inferred"></div>', {
      cappedNodeIds: ['n-0']
    })

    expect(warnings).toBeDefined()
    expect(warnings?.map((item) => item.type)).toEqual(['auto-layout', 'depth-cap'])
    const autoLayout = warnings?.find((item) => item.type === 'auto-layout')
    expect(autoLayout?.message).toContain('get_structure')
    expect(autoLayout?.message).not.toContain('get_screenshot')

    const depthCap = warnings?.find((item) => item.type === 'depth-cap')
    expect(depthCap?.message).toContain('data-hint-id')
  })

  it('returns undefined when no warning conditions are met', () => {
    expect(buildGetCodeWarnings('<div />')).toBeUndefined()
  })

  it('adds shell warning without extra metadata', () => {
    const warnings = buildGetCodeWarnings('<div />', {
      shell: true
    })

    expect(warnings?.map((item) => item.type)).toEqual(['shell'])
    expect(warnings?.[0]?.message).toContain('Shell response')
    expect(warnings?.[0]?.message).toContain('inline comment')
    expect(warnings?.[0]).not.toHaveProperty('data')
  })

  it('emits depth-cap warning when capped node ids exist', () => {
    const warnings = buildGetCodeWarnings('<div />', {
      cappedNodeIds: ['id-0']
    })
    const depthCap = warnings?.find((item) => item.type === 'depth-cap')

    expect(depthCap?.message).toContain('Tree depth capped')
  })

  it('points repeated literal warnings to bounded structured evidence', () => {
    const warnings = buildGetCodeWarnings('<div />', {
      literalClusters: [
        {
          kind: 'color',
          value: '#FFFFFF',
          occurrences: 2,
          consumers: [
            { nodeId: 'a', nodeName: 'A', properties: ['color'] },
            { nodeId: 'b', nodeName: 'B', properties: ['color'] }
          ]
        }
      ]
    })

    expect(warnings).toEqual([
      {
        type: 'literal-cluster',
        message: expect.stringContaining('structuredContent.literalClusters')
      }
    ])
  })
})
