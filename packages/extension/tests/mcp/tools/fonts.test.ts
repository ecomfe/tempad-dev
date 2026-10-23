import {
  buildGetDesignSystemToolResult,
  measureCallToolResultBytes,
  utf8Bytes
} from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGetDesignSystem } from '@/mcp/tools/design-system'

afterEach(() => vi.unstubAllGlobals())

function fonts(names: Array<[string, string]>) {
  const listAvailableFontsAsync = vi
    .fn()
    .mockResolvedValue(names.map(([family, style]) => ({ fontName: { family, style } })))
  // Deliberately no document API: environment font queries must never scan the file.
  vi.stubGlobal('figma', { listAvailableFontsAsync })
  return listAvailableFontsAsync
}

describe('environment font discovery', () => {
  it('searches and deduplicates family names without returning every style', async () => {
    fonts([
      ['Inter', 'Regular'],
      ['Noto Sans SC', 'Bold'],
      ['Noto Sans SC', 'Regular'],
      ['Noto Serif SC', 'Regular']
    ])
    expect(await handleGetDesignSystem({ scope: 'fonts', query: 'SANS' })).toEqual({
      scope: 'fonts',
      families: ['Noto Sans SC']
    })
  })

  it('returns exact native styles and explicitly missing families', async () => {
    fonts([
      ['Noto Sans SC', 'Regular'],
      ['Noto Sans SC', 'SemiBold'],
      ['Inter', 'Regular'],
      ['Noto Sans SC', 'Regular']
    ])
    expect(
      await handleGetDesignSystem({ scope: 'fonts', families: ['Noto Sans SC', 'noto sans sc'] })
    ).toEqual({
      scope: 'fonts',
      fonts: [
        { family: 'Noto Sans SC', style: 'Regular' },
        { family: 'Noto Sans SC', style: 'SemiBold' }
      ],
      missingFamilies: ['noto sans sc']
    })
  })

  it('paginates sorted results and rejects stale out-of-range cursors', async () => {
    fonts(
      Array.from({ length: 35 }, (_, index) => [
        `Font ${index.toString().padStart(2, '0')}`,
        'Regular'
      ])
    )
    const first = await handleGetDesignSystem({ scope: 'fonts' })
    expect(first.families).toHaveLength(32)
    expect(first.nextCursor).toBe(32)
    const rest = await handleGetDesignSystem({ scope: 'fonts', cursor: first.nextCursor })
    expect(rest.families).toEqual(['Font 32', 'Font 33', 'Font 34'])
    expect(rest.nextCursor).toBeUndefined()
    await expect(handleGetDesignSystem({ scope: 'fonts', cursor: 35 })).rejects.toThrow('cursor')
  })

  it('keeps family and face responses bounded without shortening exact identities', async () => {
    fonts(Array.from({ length: 40 }, (_, index) => [`${index}${'字体'.repeat(150)}`, 'Regular']))
    const result = await handleGetDesignSystem({ scope: 'fonts' })
    expect(result.nextCursor).toBeGreaterThan(0)
    expect(measureCallToolResultBytes(buildGetDesignSystemToolResult(result))).toBeLessThan(
      16 * 1024
    )
    expect(buildGetDesignSystemToolResult(result).content?.[0]?.text).toContain('glyph coverage')
    fonts([['x'.repeat(16 * 1024), 'Regular']])
    await expect(handleGetDesignSystem({ scope: 'fonts' })).rejects.toThrow('budget')
  })

  it.each(['families', 'faces'] as const)(
    'includes the continuation cursor in the %s byte budget',
    async (kind) => {
      const firstName = 'A'.repeat(100)
      const emptyPage =
        kind === 'families'
          ? { scope: 'fonts', families: [firstName, ''] }
          : {
              scope: 'fonts',
              fonts: [
                { family: 'Font', style: firstName },
                { family: 'Font', style: '' }
              ]
            }
      const names = [firstName, 'B'.repeat(12 * 1024 - utf8Bytes(emptyPage)), 'Z']
      fonts(names.map((name) => (kind === 'families' ? [name, 'Regular'] : ['Font', name])))
      const filters = kind === 'families' ? {} : { families: ['Font'] }
      const first = await handleGetDesignSystem({ scope: 'fonts', ...filters })
      expect(utf8Bytes(first)).toBeLessThanOrEqual(12 * 1024)
      expect(first.nextCursor).toBe(1)
      const rest = await handleGetDesignSystem({
        scope: 'fonts',
        ...filters,
        cursor: first.nextCursor
      })
      expect(utf8Bytes(rest)).toBeLessThanOrEqual(12 * 1024)
      expect(rest.nextCursor).toBeUndefined()
      expect(
        kind === 'families'
          ? [...first.families!, ...rest.families!]
          : [...first.fonts!, ...rest.fonts!].map(({ style }) => style)
      ).toEqual(names)
    }
  )

  it('only permits a boundary-sized native name when no continuation is needed', async () => {
    const name = 'A'.repeat(12 * 1024 - utf8Bytes({ scope: 'fonts', families: [''] }))
    fonts([[name, 'Regular']])
    expect(await handleGetDesignSystem({ scope: 'fonts' })).toEqual({
      scope: 'fonts',
      families: [name]
    })
    fonts([
      [name, 'Regular'],
      ['Z', 'Regular']
    ])
    await expect(handleGetDesignSystem({ scope: 'fonts' })).rejects.toThrow('budget')
  })
})
