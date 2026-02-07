import { describe, expect, it } from 'vitest'

import { inferResizingStyles, mergeInferredAutoLayout } from '@/mcp/tools/code/styles/layout'

describe('mcp/code styles layout', () => {
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
})
