import { describe, expect, it, vi } from 'vitest'

import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { getInferredAutoLayout, hasClippedOverflow } from '@/mcp/tools/code/layout-parent'
import { sanitizeStyles } from '@/mcp/tools/code/sanitize'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

vi.mock('@/utils/figma-style/style-resolver', () => ({
  resolveStylesFromNodeData: vi.fn((style) => style)
}))

describe('clipped vector layout', () => {
  it.each(['BOOLEAN_OPERATION', 'GROUP'] as const)(
    'positions an exported %s as one asset in its clipping frame',
    async (type) => {
      const child = createSnapshot({ id: 'vector', type, parentId: 'frame' })
      child.bounds = { x: -575.458, y: -213.744, width: 1102.423, height: 956.631 }
      child.node = {
        id: child.id,
        type,
        visible: true,
        width: child.bounds.width,
        height: child.bounds.height,
        relativeTransform: [
          [1, 0, child.bounds.x],
          [0, 1, child.bounds.y]
        ],
        absoluteBoundingBox: child.bounds,
        getCSSAsync: vi.fn(async () => ({ width: '1102.423px', height: '956.631px' }))
      } as unknown as SceneNode
      const frame = createSnapshot({ id: 'frame', children: [child.id] })
      frame.bounds = { x: 0, y: 0, width: 636, height: 743 }
      frame.node = {
        id: frame.id,
        type: 'FRAME',
        visible: true,
        width: 636,
        height: 743,
        layoutMode: 'NONE',
        clipsContent: true,
        overflowDirection: 'NONE',
        children: [child.node],
        absoluteBoundingBox: frame.bounds,
        inferredAutoLayout: { layoutMode: 'VERTICAL', paddingRight: 109.035 },
        getCSSAsync: vi.fn(async () => ({
          display: 'inline-flex',
          'padding-right': '109.035px',
          'align-items': 'center',
          'background-color': '#fff'
        }))
      } as unknown as SceneNode
      const tree = createTree([frame, child])
      const cache = createGetCodeCacheContext()
      const vectorRoots = new Set([child.id])
      const { styles } = await collectNodeData(
        tree,
        { cssUnit: 'px', scale: 1, rootFontSize: 16 },
        new Map(),
        cache,
        undefined,
        undefined,
        vectorRoots
      )
      sanitizeStyles(tree, styles, vectorRoots, cache)
      expect(styles.get(frame.id)).toMatchObject({
        width: '636px',
        height: '743px',
        overflow: 'hidden',
        position: 'relative'
      })
      expect(styles.get(frame.id)).not.toHaveProperty('display')
      expect(styles.get(frame.id)).not.toHaveProperty('padding-right')
      expect(styles.get(child.id)).toMatchObject({
        position: 'absolute',
        left: '-575.458px',
        top: '-213.744px'
      })
      expect(frame.node.getCSSAsync).toHaveBeenCalledOnce()
      expect(child.node.getCSSAsync).toHaveBeenCalledOnce()

      // Structural groups keep their old contract when they are not SVG roots.
      const structural = await collectNodeData(
        tree,
        { cssUnit: 'px', scale: 1, rootFontSize: 16 },
        new Map(),
        cache
      )
      expect(structural.styles.get(child.id)).not.toHaveProperty('position')
    }
  )

  it('preserves valid inference and explicit auto layout, but checks rotated corners', () => {
    const child = {
      visible: true,
      width: 60,
      height: 40,
      relativeTransform: [
        [1, 0, 20],
        [0, 1, 20]
      ]
    }
    const node = {
      layoutMode: 'NONE',
      clipsContent: true,
      width: 100,
      height: 100,
      children: [child],
      inferredAutoLayout: { layoutMode: 'HORIZONTAL' }
    } as unknown as FrameNode
    expect(getInferredAutoLayout(node)).toBe(node.inferredAutoLayout)
    child.relativeTransform = [
      [0, -1, 20],
      [1, 0, 20]
    ]
    expect(hasClippedOverflow(node)).toBe(true)
    expect(getInferredAutoLayout(node)).toBeNull()
    node.layoutMode = 'HORIZONTAL'
    expect(hasClippedOverflow(node)).toBe(false)
    node.layoutMode = 'NONE'
    child.visible = false
    expect(hasClippedOverflow(node)).toBe(false)
  })
})
