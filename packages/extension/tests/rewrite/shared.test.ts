import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Group, Rules } from '@/types/rewrite'

import {
  REWRITE_RULE_ID,
  applyGroups,
  getRewriteTargetRegex,
  groupMatches,
  isRules,
  loadRules
} from '@/rewrite/shared'
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

function createRules(regexFilter = '^https://www\\.figma\\.com/'): Rules {
  return [
    {
      id: REWRITE_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: []
      },
      condition: {
        regexFilter,
        resourceTypes: ['main_frame']
      }
    }
  ] as unknown as Rules
}

describe('rewrite/shared isRules + regex helpers', () => {
  it('validates rules payload shape', () => {
    expect(isRules(createRules())).toBe(true)
    expect(isRules([null])).toBe(false)
    expect(isRules([{ id: '2' }])).toBe(false)
    expect(isRules({})).toBe(false)
  })

  it('resolves rewrite target regex and handles invalid source', () => {
    const regex = getRewriteTargetRegex(createRules('figma\\.com'))
    expect(regex?.test('https://www.figma.com/file/123')).toBe(true)

    expect(getRewriteTargetRegex([] as unknown as Rules)).toBeNull()
    expect(getRewriteTargetRegex(createRules('['))).toBeNull()
  })
})

describe('rewrite/shared loadRules', () => {
  it('loads and validates rules from fetch response', async () => {
    const rules = createRules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(rules)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadRules('https://example.test/rules')).resolves.toEqual(rules)
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/rules', undefined)
  })

  it('returns null when response is not ok, payload invalid, or fetch throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: vi.fn() })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ invalid: true })
      })
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadRules('https://example.test/not-ok')).resolves.toBeNull()
    await expect(loadRules('https://example.test/invalid-payload')).resolves.toBeNull()
    await expect(loadRules('https://example.test/throws')).resolves.toBeNull()
  })
})

describe('rewrite/shared applyGroups', () => {
  it('checks marker matches and applies mixed replacement types', () => {
    const groups: Group[] = [
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
