import { describe, expect, it } from 'vitest'

import { buildSourceNameIndex } from '@/mcp/tools/code/tokens/source-index'

describe('mcp/code tokens source-index', () => {
  it('indexes candidate names from codeSyntax and figma variable names', () => {
    const cache = new Map<string, Variable | null>([
      [
        'id-1',
        {
          name: 'Brand Primary',
          codeSyntax: { WEB: 'var(--brand-color)' }
        } as unknown as Variable
      ],
      [
        'id-2',
        {
          name: 'Brand Secondary',
          codeSyntax: { WEB: 'var(--brand-color)' }
        } as unknown as Variable
      ],
      [
        'id-3',
        {
          name: 'Spacing LG',
          codeSyntax: { WEB: '$spacing lg' }
        } as unknown as Variable
      ],
      ['id-4', null]
    ])

    const index = buildSourceNameIndex(new Set(['id-1', 'id-2', 'id-3', 'id-4']), cache)

    expect(index.get('--brand-color')).toBe('id-1')
    expect(index.get('var(--brand-color)')).toBe('id-1')
    expect(index.get('--spacing-lg')).toBe('id-3')
    expect(index.get('$spacing lg')).toBe('id-3')
    expect(index.get('--Spacing-LG')).toBe('id-3')
  })
})
