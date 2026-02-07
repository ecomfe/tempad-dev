import { describe, expect, it } from 'vitest'

import { inferResizingStyles, mergeInferredAutoLayout } from '@/mcp/tools/code/styles/layout'

describe('mcp/code styles layout', () => {
  it('returns original style when node is absent or has no usable auto layout', () => {
    const style: Record<string, string> = { color: 'red' }
    expect(mergeInferredAutoLayout(style, undefined)).toEqual({ color: 'red' })

    const noneNode = { layoutMode: 'NONE' } as unknown as SceneNode
    expect(mergeInferredAutoLayout(style, noneNode)).toEqual({ color: 'red' })
  })

  it('merges inferred auto layout into style map', () => {
    const style: Record<string, string> = {}
    const node = {
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER',
      paddingTop: 4,
      paddingRight: 6,
      paddingBottom: 8,
      paddingLeft: 10
    } as unknown as SceneNode

    const merged = mergeInferredAutoLayout(style, node)
    expect(merged).toEqual({
      display: 'flex',
      'flex-direction': 'row',
      gap: '8px',
      'justify-content': 'space-between',
      'align-items': 'center',
      'padding-top': '4px',
      'padding-right': '6px',
      'padding-bottom': '8px',
      'padding-left': '10px'
    })
  })

  it('uses inferred fallback source when explicit layout mode is NONE', () => {
    const style: Record<string, string> = {}
    const node = {
      layoutMode: 'NONE',
      inferredAutoLayout: {
        layoutMode: 'VERTICAL',
        itemSpacing: 6,
        paddingLeft: 4
      }
    } as unknown as SceneNode

    expect(mergeInferredAutoLayout(style, node)).toEqual({
      display: 'flex',
      'flex-direction': 'column',
      gap: '6px',
      'padding-left': '4px'
    })
  })

  it('keeps existing flex/gap/alignment values and exits on atomic padding', () => {
    const style: Record<string, string> = {
      display: 'inline-flex',
      'flex-direction': 'row',
      'row-gap': '1px',
      'justify-content': 'center',
      'align-items': 'stretch',
      'padding-top': '9px'
    }
    const node = {
      layoutMode: 'HORIZONTAL',
      itemSpacing: 10,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MAX',
      paddingTop: 1,
      paddingRight: 2,
      paddingBottom: 3,
      paddingLeft: 4
    } as unknown as SceneNode

    expect(mergeInferredAutoLayout(style, node)).toEqual({
      display: 'inline-flex',
      'flex-direction': 'row',
      'row-gap': '1px',
      'justify-content': 'center',
      'align-items': 'stretch',
      'padding-top': '9px'
    })
  })

  it('uses inferred auto layout on nodes without layoutMode field', () => {
    const style: Record<string, string> = {}
    const node = {
      inferredAutoLayout: {
        layoutMode: 'HORIZONTAL',
        itemSpacing: 5
      }
    } as unknown as SceneNode

    expect(mergeInferredAutoLayout(style, node)).toEqual({
      display: 'flex',
      'flex-direction': 'row',
      gap: '5px'
    })
  })

  it('handles undefined inferred field when layoutMode is explicitly provided', () => {
    const style: Record<string, string> = {}
    const node = {
      layoutMode: 'HORIZONTAL',
      inferredAutoLayout: undefined
    } as unknown as SceneNode

    expect(mergeInferredAutoLayout(style, node)).toEqual({
      display: 'flex',
      'flex-direction': 'row'
    })
  })

  it('keeps existing grid style and skips inferred merge', () => {
    const style: Record<string, string> = {
      display: 'grid',
      gap: '2px'
    }
    const node = {
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8
    } as unknown as SceneNode

    expect(mergeInferredAutoLayout(style, node)).toEqual({
      display: 'grid',
      gap: '2px'
    })
  })

  it('infers resizing style from stretch, fill and hug settings', () => {
    const stretchNode = {
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
      layoutAlign: 'STRETCH'
    } as unknown as SceneNode

    const stretched = inferResizingStyles(
      {
        width: '100px',
        height: '80px'
      },
      stretchNode,
      { layoutMode: 'HORIZONTAL' } as unknown as SceneNode
    )
    expect(stretched).toEqual({
      'align-self': 'stretch'
    })

    const fillNode = {
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'FIXED',
      layoutAlign: 'INHERIT'
    } as unknown as SceneNode

    const filled = inferResizingStyles({}, fillNode, {
      layoutMode: 'NONE',
      inferredAutoLayout: { layoutMode: 'VERTICAL' }
    } as unknown as SceneNode)
    expect(filled).toEqual({
      'align-self': 'stretch'
    })
  })

  it('handles parent horizontal fill and parentless/unknown-parent fallbacks', () => {
    const horizontalFill = inferResizingStyles(
      {},
      {
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'FILL',
        layoutAlign: 'INHERIT'
      } as unknown as SceneNode,
      { layoutMode: 'HORIZONTAL' } as unknown as SceneNode
    )
    expect(horizontalFill).toEqual({
      'align-self': 'stretch'
    })

    const noParentLayout = inferResizingStyles(
      { width: '120px' },
      {
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'FIXED',
        layoutAlign: 'INHERIT'
      } as unknown as SceneNode,
      {} as unknown as SceneNode
    )
    expect(noParentLayout).toEqual({})

    const parentless = inferResizingStyles({ height: '80px' }, {
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'HUG',
      layoutAlign: 'INHERIT'
    } as unknown as SceneNode)
    expect(parentless).toEqual({})
  })

  it('returns style unchanged when node does not expose auto-layout sizing fields', () => {
    const style = { width: '10px' }
    expect(inferResizingStyles(style, {} as SceneNode)).toEqual({ width: '10px' })
  })

  it('handles missing layoutAlign and parent inferred mode NONE', () => {
    const result = inferResizingStyles(
      {},
      {
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'FIXED'
      } as unknown as SceneNode,
      {
        inferredAutoLayout: { layoutMode: 'NONE' }
      } as unknown as SceneNode
    )

    expect(result).toEqual({})
  })
})
