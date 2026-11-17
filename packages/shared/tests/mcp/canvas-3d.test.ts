import { describe, expect, it } from 'vitest'

import { CanvasFigmaPropertiesSchema } from '../../src/mcp/canvas'

const transform3d = {
  type: 'FIXED_ORDER',
  translateZ: -24,
  rotateX: 12.5,
  rotateY: -30,
  rotateZ: 360
}

describe('canvas 3D native schema', () => {
  it.each([
    { transform3d },
    { transform3d: { ...transform3d, visible: false, backfaceVisible: false } },
    { transform3d: { type: 'NONE' } },
    { transformOrigin: { x: { unit: 'PERCENT', value: -50 }, y: { unit: 'PIXELS', value: 240 } } },
    { scene3d: { perspective: -1, preserve3d: true, visible: false } },
    { scene3d: { perspective: 0.5, preserve3d: false } },
    { scene3d: null }
  ])('accepts native 3D state %#', (properties) => {
    expect(CanvasFigmaPropertiesSchema.parse(properties)).toEqual(properties)
  })

  it.each([
    { transform3d: { type: 'FREEFORM', backfaceVisible: true } },
    { transform3d: { ...transform3d, rotateY: undefined } },
    { transform3d: { ...transform3d, translateZ: Infinity } },
    { transform3d: { ...transform3d, rotateX: NaN } },
    { transform3d: { type: 'NONE', rotateZ: 0 } },
    { transformOrigin: { x: { unit: 'PERCENT', value: 50 } } },
    { transformOrigin: { x: { unit: 'PX', value: 0 }, y: { unit: 'PIXELS', value: 0 } } },
    { scene3d: { perspective: Infinity, preserve3d: false } },
    { scene3d: { perspective: 800 } },
    { scene3d: { perspective: 800, preserve3d: true, unknown: true } }
  ])('rejects unsupported or incomplete 3D state %#', (properties) => {
    expect(CanvasFigmaPropertiesSchema.safeParse(properties).success).toBe(false)
  })
})
