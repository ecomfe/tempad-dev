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
      [
        'id-4',
        {
          name: 'No Syntax'
        } as unknown as Variable
      ],
      [
        'id-5',
        {
          name: 'Invalid Syntax',
          codeSyntax: { WEB: '$$??' }
        } as unknown as Variable
      ],
      [
        'id-7',
        {
          name: 'Spaced Dash Name',
          codeSyntax: { WEB: '@--spacing lg' }
        } as unknown as Variable
      ],
      [
        'id-8',
        {
          name: undefined
        } as unknown as Variable
      ],
      ['id-6', null]
    ])

    const index = buildSourceNameIndex(
      new Set(['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8']),
      cache
    )

    expect(index.get('--brand-color')).toBe('id-1')
    expect(index.get('var(--brand-color)')).toBe('id-1')
    expect(index.get('--spacing-lg')).toBe('id-3')
    expect(index.get('$spacing lg')).toBe('id-3')
    expect(index.get('--No-Syntax')).toBe('id-4')
    expect(index.get('--Invalid-Syntax')).toBe('id-5')
    expect(index.get('$$??')).toBe('id-5')
    expect(index.get('--spacing-lg')).toBe('id-3')
    expect(index.get('@--spacing lg')).toBe('id-7')
    expect(index.get('--unnamed')).toBe('id-5')
    expect(index.get('--Spacing-LG')).toBe('id-3')
  })
})
