import { describe, expect, it, vi } from 'vitest'

vi.mock('@/mcp/tools/token/indexer', () => ({
  getVariableRawName: () => 'mock-var'
}))

import {
  buildLayoutStyles,
  layoutOnly,
  preprocessStyles,
  stripInertShadows,
  styleToClassNames
} from '@/mcp/tools/code/styles/normalize'

describe('mcp/styles/normalize', () => {
  it('filters layout-only keys', () => {
    expect(
      layoutOnly({
        display: 'flex',
        position: 'absolute',
        width: '100px',
        color: 'red',
        'background-color': '#fff'
      })
    ).toEqual({
      display: 'flex',
      position: 'absolute',
      width: '100px'
    })
  })

  it('builds layout map and strips svg width/height/overflow', () => {
    const map = new Map<string, Record<string, string>>([
      [
        'svg-root',
        {
          width: '100px',
          height: '80px',
          overflow: 'hidden',
          display: 'block',
          position: 'relative'
        }
      ],
      ['normal', { width: '200px', display: 'flex', color: 'red' }]
    ])

    const result = buildLayoutStyles(map, new Set(['svg-root']))
    expect(result.get('svg-root')).toEqual({ display: 'block', position: 'relative' })
    expect(result.get('normal')).toEqual({ width: '200px', display: 'flex' })

    const noStrip = buildLayoutStyles(
      new Map([['svg-clean', { display: 'block' }]]),
      new Set(['svg-clean'])
    )
    expect(noStrip.get('svg-clean')).toEqual({ display: 'block' })
  })

  it('runs preprocess pipeline with shorthand expansion', () => {
    expect(preprocessStyles({ padding: '8px 4px' })).toMatchObject({
      'padding-top': '8px',
      'padding-right': '4px',
      'padding-bottom': '8px',
      'padding-left': '4px'
    })
  })

  it('removes box-shadow only when fill is not renderable', () => {
    const untouched = { color: 'red' }
    stripInertShadows(untouched, { type: 'FRAME' } as SceneNode)
    expect(untouched).toEqual({ color: 'red' })

    const withoutFill = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(withoutFill, { type: 'FRAME' } as SceneNode)
    expect(withoutFill).toEqual({})

    const withSolid = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(withSolid, {
      type: 'RECTANGLE',
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }]
    } as unknown as SceneNode)
    expect(withSolid['box-shadow']).toBe('0 0 4px #000')

    const invisibleGradient = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(invisibleGradient, {
      type: 'RECTANGLE',
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 0 } }]
        }
      ]
    } as unknown as SceneNode)
    expect(invisibleGradient).toEqual({})

    const mixedFills = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(mixedFills, {
      type: 'RECTANGLE',
      fills: { mixed: true }
    } as unknown as SceneNode)
    expect(mixedFills).toEqual({})

    const invisibleFill = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(invisibleFill, {
      type: 'RECTANGLE',
      fills: [{ type: 'SOLID', visible: false, opacity: 1, color: { r: 1, g: 0, b: 0 } }]
    } as unknown as SceneNode)
    expect(invisibleFill).toEqual({})

    const zeroOpacityFill = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(zeroOpacityFill, {
      type: 'RECTANGLE',
      fills: [{ type: 'SOLID', visible: true, opacity: 0, color: { r: 1, g: 0, b: 0 } }]
    } as unknown as SceneNode)
    expect(zeroOpacityFill).toEqual({})

    const implicitAlphaGradient = { 'box-shadow': '0 0 4px #000' }
    stripInertShadows(implicitAlphaGradient, {
      type: 'RECTANGLE',
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          gradientStops: [{ position: 0 } as unknown as ColorStop]
        }
      ]
    } as unknown as SceneNode)
    expect(implicitAlphaGradient['box-shadow']).toBe('0 0 4px #000')
  })

  it('converts style map to class names via normal and gradient-border paths', () => {
    const normal = styleToClassNames(
      {
        display: 'flex',
        width: '16px'
      },
      {
        cssUnit: 'rem',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(normal).toEqual(expect.arrayContaining(['flex', 'w-[1rem]']))

    const gradient = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': '1px',
        'border-radius': '8px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )

    expect(gradient.some((item) => item.startsWith('before:'))).toBe(true)
    expect(gradient).toEqual(expect.arrayContaining(['relative', 'isolate', 'border-[1px]']))
    expect(gradient).toEqual(
      expect.arrayContaining([
        "before:content-['']",
        'before:inset-[-1px]',
        'before:p-[1px]',
        'before:rounded-[inherit]'
      ])
    )
    expect(gradient.some((item) => item.startsWith('before:[mask-image:'))).toBe(true)
    expect(gradient.some((item) => item.includes('-webkit-'))).toBe(false)
    expect(gradient.some((item) => item.startsWith('before:[mask:'))).toBe(false)
    expect(gradient.some((item) => item.startsWith('before:[-webkit-mask:'))).toBe(false)
  })

  it('handles gradient-border fallback branches and clipping path', () => {
    const noBorder = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': '0px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(noBorder.some((item) => item.startsWith('before:'))).toBe(false)
    expect(noBorder).toEqual([])

    const clipped = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        border: '2px solid red',
        'overflow-x': 'clip'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(clipped.some((item) => item.includes('before:') && item.includes('inset'))).toBe(true)
    expect(clipped.some((item) => item === 'border-[2px]')).toBe(false)

    const negativeWidth = styleToClassNames(
      {
        'border-image': 'linear-gradient("red", blue) 1',
        'border-width': '-2px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(negativeWidth.some((item) => item.includes('before:') && item.includes('inset'))).toBe(
      true
    )
    expect(
      negativeWidth.some((item) => item.startsWith('before:p-') || item.startsWith('before:-p-'))
    ).toBe(true)

    const sideBorder = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': '3px solid red',
        'border-right': '3px solid red',
        'border-bottom': '3px solid red',
        'border-left': '3px solid red',
        color: ''
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(sideBorder).toEqual(expect.arrayContaining(['border-[3px]']))

    const noGradient = styleToClassNames(
      {
        'border-image': 'url("ring.png") 1',
        'border-width': '1px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(noGradient).toEqual([])

    const malformedGradient = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue',
        'border-width': '1px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(malformedGradient).toEqual([])

    const noWidth = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': '2px solid red'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(noWidth).toEqual([])
    expect(noWidth.some((item) => item.startsWith('before:'))).toBe(false)

    const variableWidth = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': 'var(--ring)'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(variableWidth.some((item) => item.includes('before:') && item.includes('calc'))).toBe(
      true
    )

    const unevenSideWidths = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top-width': '1px',
        'border-right-width': '2px',
        'border-bottom-width': '1px',
        'border-left-width': '2px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(unevenSideWidths).toEqual(expect.arrayContaining(['border-x-[2px]', 'border-y-[1px]']))
    expect(unevenSideWidths.some((item) => item.startsWith('before:'))).toBe(false)

    const preservedPositionIsolation = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': '2px',
        position: 'absolute',
        isolation: 'auto'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(preservedPositionIsolation).toEqual(
      expect.arrayContaining(['absolute', 'isolation-auto', 'border-[2px]'])
    )

    const escapedAndNestedGradient = styleToClassNames(
      {
        'border-image': 'linear-gradient("re\\\\\\"d", var(--ring, blue)) 1',
        'border-width': '1px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(escapedAndNestedGradient.some((item) => item.startsWith('before:'))).toBe(true)

    const blankShorthands = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        border: '   ',
        'border-top': '   ',
        'border-width': '1px 2px'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(blankShorthands).toEqual([])

    const commentOnlyShorthands = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        border: '/* stripped */',
        'border-top': '/* stripped */'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(commentOnlyShorthands).toEqual([])

    const oneTokenSideBorders = styleToClassNames(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': 'solid',
        'border-right': 'solid',
        'border-bottom': 'solid',
        'border-left': 'solid'
      },
      {
        cssUnit: 'px',
        rootFontSize: 16,
        scale: 1
      }
    )
    expect(oneTokenSideBorders.some((item) => item.startsWith('before:'))).toBe(true)
  })
})
