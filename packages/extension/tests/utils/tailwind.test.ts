import { describe, expect, it } from 'vitest'

import {
  cssToClassNames,
  cssToTailwind,
  joinClassNames,
  nestedCssToClassNames
} from '@/utils/tailwind'

describe('utils/tailwind cssToTailwind', () => {
  it('maps direct keyword families to classes', () => {
    expect(
      cssToTailwind({
        display: 'flex',
        position: 'absolute',
        overflow: 'hidden',
        'font-style': 'italic'
      })
    ).toBe('flex absolute overflow-hidden italic')
  })

  it('collapses side/corner/axis/composite families', () => {
    const allEqual = cssToTailwind({
      'margin-top': '8px',
      'margin-right': '8px',
      'margin-bottom': '8px',
      'margin-left': '8px',
      'border-top-left-radius': '4px',
      'border-top-right-radius': '4px',
      'border-bottom-right-radius': '4px',
      'border-bottom-left-radius': '4px',
      'column-gap': '6px',
      'row-gap': '6px',
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': '0%'
    })

    expect(allEqual.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'm-[8px]',
        'rounded-[4px]',
        'gap-[6px]',
        'grow-[1]',
        'shrink-[1]',
        'basis-[0]'
      ])
    )

    const partial = cssToTailwind({
      'padding-top': '8px',
      'padding-bottom': '8px',
      'padding-left': '4px',
      'padding-right': '4px',
      'column-gap': '12px',
      'row-gap': '4px',
      'flex-grow': '2',
      'flex-shrink': '0',
      'flex-basis': 'auto'
    }).split(/\s+/)

    expect(partial).toEqual(
      expect.arrayContaining(['px-[4px]', 'py-[8px]', 'gap-x-[12px]', 'gap-y-[4px]'])
    )
    expect(partial).toEqual(expect.arrayContaining(['grow-[2]', 'shrink-[0]', 'basis-[auto]']))
  })

  it('handles negative values, numeric coercion and calc formatting', () => {
    const result = cssToTailwind({
      'margin-left': '-4px',
      'font-weight': '500px',
      width: 'calc(100% - 24px)',
      'background-position': 'var(--pos)'
    }).split(/\s+/)

    expect(result).toEqual(
      expect.arrayContaining([
        '-ml-[4px]',
        'font-medium',
        'w-[calc(100%_-_24px)]',
        'bg-[position:var(--pos)]'
      ])
    )
  })

  it('maps shorthand and pseudo-related properties to canonical utilities', () => {
    const result = cssToTailwind({
      content: '""',
      inset: '-1px',
      padding: '1px',
      'border-radius': 'inherit'
    }).split(/\s+/)

    expect(result).toEqual(
      expect.arrayContaining(["content-['']", 'inset-[-1px]', 'p-[1px]', 'rounded-[inherit]'])
    )
  })

  it('handles formatter-based families and grid line edge cases', () => {
    const result = cssToTailwind({
      'font-family': '"Fira Sans", serif',
      'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
      'grid-template-rows': 'repeat(auto-fit, minmax(0, 1fr))',
      'grid-column': '2 / 4',
      'grid-column-start': '0',
      'grid-row-start': 'span 0'
    }).split(/\s+/)

    expect(result).toEqual(
      expect.arrayContaining([
        'font-[Fira_Sans,serif]',
        'grid-cols-3',
        'grid-rows-[repeat(auto-fit,_minmax(0,_1fr))]',
        'col-[2_/_4]',
        'col-start-auto',
        'row-start-auto'
      ])
    )
  })

  it('handles composite shortcuts, corner collapse branches, and empty values', () => {
    const flexComposite = cssToTailwind({
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': 'auto'
    })
    expect(flexComposite).toContain('flex-auto')

    const cornerTopBottom = cssToTailwind({
      'border-top-left-radius': '4px',
      'border-top-right-radius': '4px',
      'border-bottom-left-radius': '2px',
      'border-bottom-right-radius': '2px'
    }).split(/\s+/)
    expect(cornerTopBottom).toEqual(expect.arrayContaining(['rounded-t-[4px]', 'rounded-b-[2px]']))

    const cornerLeftRight = cssToTailwind({
      'border-top-left-radius': '4px',
      'border-bottom-left-radius': '4px',
      'border-top-right-radius': '6px',
      'border-bottom-right-radius': '6px'
    }).split(/\s+/)
    expect(cornerLeftRight).toEqual(expect.arrayContaining(['rounded-l-[4px]', 'rounded-r-[6px]']))

    const cornerUnique = cssToTailwind({
      'border-top-left-radius': '1px',
      'border-top-right-radius': '2px',
      'border-bottom-right-radius': '3px',
      'border-bottom-left-radius': '4px',
      'font-size': '16px'
    }).split(/\s+/)
    expect(cornerUnique).toEqual(
      expect.arrayContaining([
        'rounded-tl-[1px]',
        'rounded-tr-[2px]',
        'rounded-br-[3px]',
        'rounded-bl-[4px]',
        'text-[16px]'
      ])
    )

    expect(cssToTailwind({ 'margin-top': '', 'margin-right': '   ' })).toBe('')
    expect(cssToTailwind({ 'font-style': 'normal' })).toBe('')
  })

  it('covers axis/composite fallback branches with partial values', () => {
    const onlyX = cssToTailwind({
      'column-gap': '10px'
    }).split(/\s+/)
    expect(onlyX).toEqual(expect.arrayContaining(['gap-x-[10px]']))
    expect(onlyX).not.toEqual(expect.arrayContaining(['gap-y-[10px]']))

    const onlyY = cssToTailwind({
      'row-gap': '6px'
    }).split(/\s+/)
    expect(onlyY).toEqual(expect.arrayContaining(['gap-y-[6px]']))
    expect(onlyY).not.toEqual(expect.arrayContaining(['gap-x-[6px]']))

    const partialFlex = cssToTailwind({
      'flex-grow': '3'
    }).split(/\s+/)
    expect(partialFlex).toEqual(expect.arrayContaining(['grow-[3]']))
    expect(partialFlex).not.toEqual(expect.arrayContaining(['shrink-[3]', 'basis-[3]']))
  })

  it('returns empty string for empty style map', () => {
    expect(cssToTailwind({})).toBe('')
  })
})

describe('utils/tailwind class extraction', () => {
  it('splits mapped class names into array', () => {
    expect(cssToClassNames({ display: 'grid', 'z-index': '10' })).toEqual(['grid', 'z-[10]'])
    expect(cssToClassNames({})).toEqual([])
  })

  it('handles nested selectors with variants, arbitrary fallback and dedupe', () => {
    const classes = nestedCssToClassNames({
      display: 'flex',
      unknown: ' value ;',
      '&::before': {
        content: '""',
        unknown: ' value ;'
      },
      '&:hover': {
        display: 'flex'
      },
      '&:focus': {
        display: 'flex'
      },
      '&:unsupported': {
        color: 'red'
      },
      ignored: { bad: 'shape' } as unknown as string
    })

    expect(classes).toEqual(
      expect.arrayContaining([
        'flex',
        '[unknown:value_]',
        "before:content-['']",
        'before:[unknown:value_]',
        'hover:flex',
        'focus:flex'
      ])
    )

    const unique = Array.from(new Set(classes))
    expect(classes).toEqual(unique)
  })

  it('skips empty arbitrary properties and invalid nested nodes', () => {
    const classes = nestedCssToClassNames({
      display: 'flex',
      unknown: '',
      weird: '   ',
      '&:hover': null as unknown as Record<string, string>,
      '&:focus-visible': ['bad'] as unknown as Record<string, string>
    })

    expect(classes).toEqual(['flex'])
  })

  it('joins class names with falsey filtering', () => {
    expect(joinClassNames(['a', '', 'b', ''])).toBe('a b')
    expect(joinClassNames([])).toBe('')
  })
})
