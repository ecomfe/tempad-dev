import { afterEach, expect, it, vi } from 'vitest'

import { handleGetCode } from '@/mcp/tools/code'
import { planAssets } from '@/mcp/tools/code/assets/plan'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { applyAbsoluteStackingOrder } from '@/mcp/tools/code/sanitize/stacking'

import { createSnapshot, createTree } from './test-helpers'

vi.mock('@/ui/state', () => ({
  activePlugin: { value: undefined },
  options: { value: { cssUnit: 'rem', rootFontSize: 16, scale: 2 } }
}))

afterEach(() => vi.unstubAllGlobals())

it('removes stored disabled 3D CSS from get_code while retaining native 2D axes', async () => {
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', { mixed: Symbol('mixed'), getStyleById: () => null })
  const root = createSnapshot({ id: 'root' })
  Object.assign(root.node, {
    width: 100,
    height: 100,
    children: [],
    fills: [],
    strokes: [],
    effects: [],
    relativeTransform: [
      [0, -1, 100],
      [1, 0, 80]
    ],
    transform3d: {
      type: 'FIXED_ORDER',
      translateZ: 60,
      rotateX: 10,
      rotateY: -25,
      rotateZ: 5,
      visible: false
    },
    getCSSAsync: async () => ({
      width: '100px',
      height: '100px',
      transform: 'translateZ(60px) rotateX(10deg) rotateY(-25deg) rotateZ(5deg)',
      'transform-origin': '25% 20px',
      'backface-visibility': 'hidden'
    })
  })
  const result = await handleGetCode([root.node])
  expect(result.code).not.toMatch(/translateZ|rotate[XYZ]|backface-visibility/)
  expect(result.code).toContain('[transform:matrix(0,_1,_-1,_0,_0,_0)]')
  expect(result.code).toContain('[transform-origin:0_0]')
})

it.each([undefined, 'none', 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,40,1)'])(
  'reports a missing FREEFORM matrix but preserves native CSS: %s',
  async (transform) => {
    vi.stubGlobal('__DEV__', false)
    vi.stubGlobal('figma', { mixed: Symbol('mixed'), getStyleById: () => null })
    const root = createSnapshot({ id: 'root' })
    Object.assign(root.node, {
      width: 100,
      height: 100,
      children: [],
      fills: [],
      strokes: [],
      effects: [],
      transform3d: { type: 'FREEFORM', backfaceVisible: true },
      getCSSAsync: async () => ({
        width: '100px',
        height: '100px',
        ...(transform ? { transform } : {})
      })
    })
    const result = await handleGetCode([root.node])
    if (transform?.startsWith('matrix3d')) {
      expect(result.code).toContain(transform)
      expect(result.warnings).toBeUndefined()
    } else
      expect(result.warnings).toEqual([
        expect.objectContaining({
          type: '3d-transform',
          message: expect.stringContaining('FREEFORM')
        })
      ])
  }
)

it('keeps a 3D vector as a native snapshot without applying the transform twice', async () => {
  vi.stubGlobal('figma', { getStyleById: () => null })
  const root = createSnapshot({ id: 'vector', type: 'VECTOR' })
  Object.assign(root.node, {
    transform3d: { type: 'FIXED_ORDER', translateZ: 40, rotateX: 0, rotateY: 30, rotateZ: 0 },
    getCSSAsync: async () => ({ width: '100px', height: '100px' })
  })
  const result = await collectNodeData(
    createTree([root]),
    { cssUnit: 'px', rootFontSize: 16, scale: 1 },
    new Map(),
    createGetCodeCacheContext(),
    undefined,
    undefined,
    new Set(['vector'])
  )
  expect(result.styles.get('vector')).not.toHaveProperty('transform')
  expect(result.threeDWarnings?.get('vector')?.type).toBe('3d-transform')
})

it('serializes 3D CSS through get_code with length scaling applied once', async () => {
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', { mixed: Symbol('mixed'), getStyleById: () => null })
  const getCSSAsync = vi.fn(async () => ({ width: '160px', height: '80px' }))
  const root = {
    id: 'root',
    type: 'FRAME',
    name: 'root',
    visible: true,
    width: 160,
    height: 80,
    x: 0,
    y: 0,
    children: [],
    fills: [],
    strokes: [],
    effects: [],
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 80 },
    absoluteRenderBounds: { x: 0, y: 0, width: 160, height: 80 },
    transform3d: {
      type: 'FIXED_ORDER',
      translateZ: 40,
      rotateX: 10,
      rotateY: -30,
      rotateZ: 5,
      backfaceVisible: false
    },
    transformOrigin: { x: { unit: 'PERCENT', value: 25 }, y: { unit: 'PIXELS', value: 20 } },
    scene3d: { perspective: 800, preserve3d: true },
    getCSSAsync
  } as unknown as SceneNode
  const result = await handleGetCode([root])
  expect(result.code).toContain('translateZ(5rem)_rotateX(10deg)_rotateY(-30deg)_rotateZ(5deg)')
  expect(result.code).toContain('[transform-origin:25%_2.5rem]')
  expect(result.code).toContain('[perspective:100rem]')
  expect(result.code).toContain('[transform-style:preserve-3d]')
  expect(result.code).toContain('[backface-visibility:hidden]')
  expect(getCSSAsync).toHaveBeenCalledOnce()
})

it('does not flatten a vector-only 3D scene into one SVG', () => {
  const scene = createSnapshot({ id: 'scene', children: ['card'] })
  const card = createSnapshot({ id: 'card', type: 'RECTANGLE', parentId: 'scene' })
  Object.assign(scene.node, { scene3d: { perspective: 800, preserve3d: true } })
  Object.assign(card.node, {
    transform3d: { type: 'FIXED_ORDER', translateZ: 40, rotateX: 0, rotateY: 30, rotateZ: 0 }
  })
  expect(planAssets(createTree([scene, card])).vectorRoots.size).toBe(0)
})

it('keeps coplanar paint ranks without injecting flattening isolation', () => {
  const tree = createTree([
    createSnapshot({ id: 'scene', children: ['back', 'front'] }),
    createSnapshot({ id: 'back', parentId: 'scene' }),
    createSnapshot({ id: 'front', parentId: 'scene' })
  ])
  const styles = new Map<string, Record<string, string>>([
    ['scene', { display: 'flex', 'transform-style': 'preserve-3d' }],
    ['back', { position: 'absolute' }],
    ['front', { transform: 'translateZ(40px)' }]
  ])
  applyAbsoluteStackingOrder(tree, styles)
  expect(styles.get('scene')).not.toHaveProperty('isolation')
  expect(styles.get('back')?.['z-index']).toBe('0')
  expect(styles.get('front')?.['z-index']).toBe('1')
})
