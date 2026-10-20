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

  it('keeps a shorthand and its longhand overrides together in normalized inline styles', () => {
    mocked.styleToClassNames.mockReturnValue(['w-[2rem]'])
    const background =
      'url("folder/front_image;v=1.png") left / 16px 8px no-repeat, url("rear.png") center / cover'
    const style = {
      'background-color': 'var(--surface)',
      width: '16px',
      'background-position': '8px 16px, right bottom',
      background,
      'background-blend-mode': 'multiply',
      'background-size': '',
      'background-repeat': '   '
    }
    const config = { cssUnit: 'rem', rootFontSize: 16, scale: 2 } as const

    const result = classProps(style, config, 'className', undefined)

    expect(mocked.styleToClassNames).toHaveBeenCalledWith({ width: '16px' }, config)
    expect(result.props).toEqual({
      className: 'w-[2rem]',
      style: {
        background:
          'url("folder/front_image;v=1.png") left / 2rem 1rem no-repeat, url("rear.png") center / cover',
        backgroundColor: 'var(--surface)',
        backgroundPosition: '1rem 2rem, right bottom',
        backgroundBlendMode: 'multiply'
      }
    })
    expect(Object.keys(result.props.style as object)[0]).toBe('background')
    expect(style.background).toBe(background)
  })

  it('keeps quoted image URLs in inline styles even without background overrides', () => {
    mocked.styleToClassNames.mockReturnValue([])
    const background =
      'url("front_image;v=1.png") center / cover no-repeat, url("rear.png") center / cover, #FF0'
    const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
    const result = classProps(
      { background, 'background-color': '' },
      config,
      'className',
      undefined
    )

    expect(result.props).toEqual({ style: { background } })
    expect(mocked.styleToClassNames).toHaveBeenCalledWith({}, config)
  })

  it('retains utility generation when there is no background shorthand', () => {
    mocked.styleToClassNames.mockReturnValue(['bg-[#F00]'])
    const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
    const styles: Record<string, string>[] = [
      { 'background-image': 'url("image.png")', 'background-color': '#F00' },
      { background: ' ', 'background-color': '#F00' }
    ]
    for (const style of styles) {
      const result = classProps(style, config, 'class', undefined)
      expect(result.props).toEqual({ class: 'bg-[#F00]' })
      expect(mocked.styleToClassNames).toHaveBeenLastCalledWith(style, config)
    }
  })

  it('keeps class prop empty when no classes exist and detects inline-grid hints', () => {
    mocked.styleToClassNames.mockReturnValueOnce([])
    const noClass = classProps(
      {},
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'className',
      undefined
    )
    expect(noClass).toEqual({ classNames: [], props: {} })

    mocked.styleToClassNames.mockReturnValueOnce(['u-1', 'inline-grid'])
    const inlineGridHint = classProps(
      {},
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'className',
      { 'data-hint-auto-layout': 'inferred' },
      { isFallback: true }
    )

    expect(inlineGridHint.props).toEqual({
      className: 'u-1 inline-grid',
      'data-hint-auto-layout': 'inferred'
    })
  })
})
