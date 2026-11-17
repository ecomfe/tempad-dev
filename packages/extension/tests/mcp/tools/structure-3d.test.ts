import type {
  CanvasReadTransform3d,
  CanvasScene3d,
  CanvasTransformOrigin
} from '@tempad-dev/shared'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGetStructure } from '@/mcp/tools/structure'
import { readFigma3d } from '@/utils/figma-3d'

import { createFixture } from '../../fakes/figma'

const centeredOrigin: CanvasTransformOrigin = {
  x: { unit: 'PERCENT', value: 50 },
  y: { unit: 'PERCENT', value: 50 }
}
const zeroTransform: CanvasReadTransform3d = {
  type: 'FIXED_ORDER',
  translateZ: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0
}
const transforms: CanvasReadTransform3d[] = [
  zeroTransform,
  { ...zeroTransform, visible: false },
  { ...zeroTransform, translateZ: 60, rotateY: -25, backfaceVisible: false },
  { ...zeroTransform, translateZ: 60, rotateY: -25, visible: false },
  { type: 'FREEFORM', backfaceVisible: true },
  { type: 'FREEFORM', backfaceVisible: false, visible: false }
]
const customOrigins: CanvasTransformOrigin[] = [
  { x: { unit: 'PERCENT', value: 25 }, y: { unit: 'PERCENT', value: 50 } },
  { x: { unit: 'PERCENT', value: 50 }, y: { unit: 'PERCENT', value: 25 } },
  { x: { unit: 'PIXELS', value: 50 }, y: { unit: 'PERCENT', value: 50 } },
  { x: { unit: 'PERCENT', value: 50 }, y: { unit: 'PIXELS', value: 50 } }
]
const configuredScenes: CanvasScene3d[] = [
  { perspective: 800, preserve3d: false },
  { perspective: 800, preserve3d: true, visible: true },
  { perspective: 800, preserve3d: false, visible: false },
  { perspective: 800, preserve3d: true, visible: false },
  { perspective: 0, preserve3d: false },
  { perspective: -20, preserve3d: false },
  { perspective: -1, preserve3d: true },
  { perspective: -1, preserve3d: false, visible: false }
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sparse native 3D structure readback', () => {
  it.each(['FRAME', 'COMPONENT', 'INSTANCE', 'TEXT'] as const)(
    'omits default 3D state and the empty native block on %s without changing native values',
    (type) => {
      const node = createFixture().createNode(type)
      expect(handleGetStructure([node], 0, true).roots[0]).not.toHaveProperty('native')
      expect(readFigma3d(node)).toEqual({
        transform3d: { type: 'NONE' },
        transformOrigin: centeredOrigin,
        ...(type === 'TEXT' ? {} : { scene3d: null })
      })
    }
  )

  it.each([undefined, true])('omits the default scene when visible is %s', (visible) => {
    const node = createFixture().createNode('FRAME')
    const scene3d = { perspective: -1, preserve3d: false, ...(visible ? { visible } : {}) }
    Object.assign(node, { scene3d })
    expect(handleGetStructure([node], 0, true).roots[0]).not.toHaveProperty('native')
    expect(readFigma3d(node).scene3d).toEqual(scene3d)
  })

  it.each(transforms)(
    'preserves configured transform %j, including zero and disabled state',
    (transform3d) => {
      const node = createFixture().createNode('FRAME')
      Object.assign(node, { transform3d })
      expect(handleGetStructure([node], 0, true).roots[0]?.native).toEqual({ transform3d })
      expect(handleGetStructure([node], 0).roots[0]).not.toHaveProperty('native')
    }
  )

  it.each(customOrigins)(
    'preserves nondefault origin %j independently of a transform',
    (transformOrigin) => {
      const node = createFixture().createNode('FRAME')
      Object.assign(node, { transformOrigin })
      expect(handleGetStructure([node], 0, true).roots[0]?.native).toEqual({ transformOrigin })
    }
  )

  it.each(configuredScenes)(
    'preserves configured scene %j, including disabled perspective',
    (scene3d) => {
      const node = createFixture().createNode('FRAME')
      Object.assign(node, { scene3d })
      expect(handleGetStructure([node], 0, true).roots[0]?.native).toEqual({ scene3d })
    }
  )

  it('keeps other native metadata without adding default 3D fields', () => {
    const node = createFixture().createNode('RECTANGLE')
    Object.assign(node, { isMask: true, maskType: 'ALPHA' })
    expect(handleGetStructure([node], 0, true).roots[0]?.native).toEqual({ mask: 'ALPHA' })
  })

  it('omits unavailable 3D fields without manufacturing default values', () => {
    const node = createFixture().createNode('FRAME')
    for (const field of ['transform3d', 'transformOrigin', 'scene3d'])
      Reflect.deleteProperty(node, field)
    expect(handleGetStructure([node], 0, true).roots[0]).not.toHaveProperty('native')
    expect(readFigma3d(node)).toEqual({})
  })

  it('does not spend the structure budget on repeated defaults across 240 nodes', () => {
    const fixture = createFixture()
    const nodes = Array.from({ length: 240 }, () => fixture.createNode('FRAME'))
    const native = handleGetStructure(nodes, 0, true)
    expect(native).toEqual(handleGetStructure(nodes, 0))
    expect(native.roots).toHaveLength(240)
    expect(native).not.toHaveProperty('truncated')
  })
})
