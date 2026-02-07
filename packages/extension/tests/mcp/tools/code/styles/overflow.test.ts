import { describe, expect, it } from 'vitest'

import { applyOverflowStyles } from '@/mcp/tools/code/styles/overflow'

describe('mcp/code styles overflow', () => {
  it('returns style unchanged for missing node or node without overflowDirection', () => {
    expect(applyOverflowStyles({ color: 'red' }, undefined)).toEqual({ color: 'red' })
    expect(
      applyOverflowStyles({ color: 'red' }, {
        type: 'FRAME'
      } as unknown as SceneNode)
    ).toEqual({ color: 'red' })
  })

  it('applies directional overflow for explicit horizontal scrolling with clipping', () => {
    const node = {
      type: 'FRAME',
      overflowDirection: 'HORIZONTAL',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{ visible: true, absoluteBoundingBox: { x: 10, y: 120, width: 30, height: 20 } }]
    } as unknown as SceneNode

    expect(applyOverflowStyles({}, node)).toEqual({
      'overflow-x': 'auto',
      'overflow-y': 'hidden'
    })

    expect(
      applyOverflowStyles(
        {
          'overflow-x': 'scroll',
          'overflow-y': 'clip'
        },
        node
      )
    ).toEqual({
      'overflow-x': 'scroll',
      'overflow-y': 'clip'
    })

    expect(
      applyOverflowStyles({}, {
        ...node,
        clipsContent: false
      } as SceneNode)
    ).toEqual({
      'overflow-x': 'auto'
    })
  })

  it('keeps existing explicit overflow values and handles BOTH direction', () => {
    const node = {
      type: 'FRAME',
      overflowDirection: 'BOTH',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: []
    } as unknown as SceneNode

    expect(applyOverflowStyles({ overflow: 'scroll' }, node)).toEqual({
      overflow: 'scroll'
    })
    expect(applyOverflowStyles({}, node)).toEqual({
      overflow: 'auto'
    })
  })

  it('uses hidden overflow when clipsContent is enabled and children exceed bounds', () => {
    const node = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 20, width: 10, height: 10 } }]
    } as unknown as SceneNode

    expect(applyOverflowStyles({}, node)).toEqual({
      overflow: 'hidden'
    })
  })

  it('supports vertical scrolling and invalid explicit directions', () => {
    const verticalNode = {
      type: 'FRAME',
      overflowDirection: 'VERTICAL',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 10, width: 20, height: 20 } }]
    } as unknown as SceneNode

    expect(applyOverflowStyles({}, verticalNode)).toEqual({
      'overflow-y': 'auto',
      'overflow-x': 'hidden'
    })
    expect(
      applyOverflowStyles(
        {
          'overflow-y': 'scroll',
          'overflow-x': 'clip'
        },
        verticalNode
      )
    ).toEqual({
      'overflow-y': 'scroll',
      'overflow-x': 'clip'
    })

    expect(
      applyOverflowStyles({}, {
        ...verticalNode,
        clipsContent: false
      } as SceneNode)
    ).toEqual({
      'overflow-y': 'auto'
    })

    const invalidDirectionNode = {
      type: 'FRAME',
      overflowDirection: 'DIAGONAL',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 20, width: 10, height: 10 } }]
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, invalidDirectionNode)).toEqual({
      overflow: 'hidden'
    })
  })

  it('ignores vector-like nodes and handles transform-based bounds fallback', () => {
    const vectorNode = {
      type: 'VECTOR',
      overflowDirection: 'HORIZONTAL'
    } as unknown as SceneNode
    expect(applyOverflowStyles({ color: 'red' }, vectorNode)).toEqual({ color: 'red' })

    const transformNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      width: 100,
      height: 100,
      children: [
        {
          visible: true,
          absoluteTransform: [
            [1, 0, 120],
            [0, 1, 0]
          ],
          width: 10,
          height: 10
        }
      ]
    } as unknown as SceneNode

    expect(applyOverflowStyles({}, transformNode)).toEqual({
      overflow: 'hidden'
    })
  })

  it('handles bounds/children fallbacks and early overflow break conditions', () => {
    const noChildrenNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, noChildrenNode)).toEqual({})

    const nonFiniteParentNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteBoundingBox: { x: Number.NaN, y: 0, width: 100, height: 100 },
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 20, width: 10, height: 10 } }]
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, nonFiniteParentNode)).toEqual({})

    const zeroSizedParentNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 100 },
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 20, width: 10, height: 10 } }]
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, zeroSizedParentNode)).toEqual({})

    const breakEarlyNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        { visible: true },
        { visible: true, absoluteBoundingBox: { x: 120, y: 120, width: 10, height: 10 } }
      ]
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, breakEarlyNode)).toEqual({ overflow: 'hidden' })
    expect(applyOverflowStyles({ overflow: 'clip' }, breakEarlyNode)).toEqual({
      overflow: 'clip'
    })

    const noTransformBoundsNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteTransform: [[1, 0, 0]],
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 20, width: 10, height: 10 } }]
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, noTransformBoundsNode)).toEqual({})

    const noSizeTransformNode = {
      type: 'FRAME',
      overflowDirection: 'NONE',
      clipsContent: true,
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      children: [{ visible: true, absoluteBoundingBox: { x: 120, y: 20, width: 10, height: 10 } }]
    } as unknown as SceneNode
    expect(applyOverflowStyles({}, noSizeTransformNode)).toEqual({})
  })
})
