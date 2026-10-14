import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Group } from '@/types/rewrite'

import { applyGroups, groupMatches } from '@/rewrite/shared'
import { logger } from '@/utils/log'

vi.mock('@/utils/log', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn()
  }
}))

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rewrite/shared applyGroups', () => {
  it('checks marker matches and applies mixed replacement types', () => {
    const groups: [Group, Group] = [
      {
        markers: ['alpha', 'beta'],
        replacements: [
          { pattern: 'alpha', replacer: 'A' },
          {
            pattern: 'beta',
            replacer: (...args: unknown[]) => String(args[0] ?? '').toUpperCase()
          },
          { pattern: /gamma/, replacer: 'G' },
          {
            pattern: /\d+/,
            replacer: (...args: unknown[]) => `[${String(args[0] ?? '')}]`
          },
          { pattern: 'missing', replacer: 'noop' }
        ]
      },
      {
        markers: ['no-match'],
        replacements: [{ pattern: 'A', replacer: 'X' }]
      }
    ]

    expect(groupMatches('alpha beta', groups[0])).toBe(true)
    expect(groupMatches('alpha', groups[0])).toBe(false)
    expect(groupMatches('any', { replacements: [] })).toBe(true)

    const result = applyGroups('alpha beta gamma 123', groups)

    expect(result.content).toBe('A BETA G [123]')
    expect(result.changed).toBe(true)
    expect(result.matchedGroups).toEqual([0])
    expect(result.rewrittenGroups).toEqual([0])
    expect(result.replacementStats).toHaveLength(5)
    expect(result.replacementStats.at(-1)).toEqual({
      groupIndex: 0,
      replacementIndex: 4,
      changed: false
    })
    expect(vi.mocked(logger.log)).toHaveBeenCalled()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'Replacement had no effect: missing -> noop'
    )
  })

  it('can apply groups without logging replacement messages', () => {
    const changed = applyGroups(
      'alpha',
      [{ replacements: [{ pattern: 'alpha', replacer: 'A' }] }],
      { logReplacements: false }
    )
    const unchanged = applyGroups(
      'alpha',
      [{ replacements: [{ pattern: 'missing', replacer: 'X' }] }],
      { logReplacements: false }
    )

    expect(changed.content).toBe('A')
    expect(unchanged.content).toBe('alpha')
    expect(vi.mocked(logger.log)).not.toHaveBeenCalled()
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })

  it('tracks matched but unchanged groups', () => {
    const result = applyGroups('alpha', [{ replacements: [{ pattern: 'missing', replacer: 'X' }] }])

    expect(result.changed).toBe(false)
    expect(result.matchedGroups).toEqual([0])
    expect(result.rewrittenGroups).toEqual([])
    expect(result.replacementStats).toEqual([
      { groupIndex: 0, replacementIndex: 0, changed: false }
    ])
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('Replacement had no effect: missing -> X')
  })
})
