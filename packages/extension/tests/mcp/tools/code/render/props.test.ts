import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  styleToClassNames: vi.fn()
}))

vi.mock('@/mcp/tools/code/styles', () => ({
  styleToClassNames: mocked.styleToClassNames
}))

import { classProp, classProps, filterGridProps, mergeClass } from '@/mcp/tools/code/render/props'

describe('mcp/code render props', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds class props and omits auto-layout hint unless fallback path is enabled', () => {
    mocked.styleToClassNames.mockReturnValue(['flex', 'w-4'])

    const result = classProps(
      { display: 'flex' },
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'className',
      {
        'data-hint-id': 'n1',
        'data-hint-auto-layout': 'inferred',
        'data-hint-empty': '   '
      }
    )

    expect(result.classNames).toEqual(['flex', 'w-4'])
    expect(result.props).toEqual({
      className: 'flex w-4',
      'data-hint-id': 'n1'
    })
  })

  it('includes auto-layout hint for fallback path with layout display and supports hint opt-out', () => {
    mocked.styleToClassNames.mockReturnValue(['grid'])

    const withHints = classProps(
      {},
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'class',
      {
        'data-hint-auto-layout': 'inferred'
      },
      { isFallback: true }
    )
    expect(withHints.props).toEqual({
      class: 'grid',
      'data-hint-auto-layout': 'inferred'
    })

    const withoutHints = classProps(
      {},
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'class',
      {
        'data-hint-id': 'n1'
      },
      { includeDataHint: false }
    )
    expect(withoutHints.props).toEqual({
      class: 'grid'
    })
  })

  it('filters grid-only props and handles class name helpers', () => {
    expect(
      filterGridProps({
        color: 'red',
        'grid-row': '1 / 2',
        'grid-column-start': '2',
        width: '10px'
      })
    ).toEqual({
      color: 'red',
      width: '10px'
    })

    expect(classProp('vue')).toBe('class')
    expect(classProp('jsx')).toBe('className')
    expect(classProp()).toBe('className')
    expect(mergeClass('a b', 'b c')).toBe('a b c')
  })
})
