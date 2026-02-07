import { describe, expect, it } from 'vitest'

import { applyOverflowStyles } from '@/mcp/tools/code/styles/overflow'

describe('mcp/code styles overflow', () => {
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
})
