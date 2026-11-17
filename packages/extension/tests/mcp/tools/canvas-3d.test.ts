import type { CanvasFigmaProperties } from '@tempad-dev/shared'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleApplyCanvas } from '@/mcp/tools/canvas'
import { handleGetStructure } from '@/mcp/tools/structure'
import { readFigma3d } from '@/utils/figma-3d'

import { createFixture } from '../../fakes/figma'

const markup =
  '<div data-key="scene" class="flex w-80 h-60"><div data-key="card" class="w-40 h-20 rotate-12"/></div>'
const transform3d = {
  type: 'FIXED_ORDER' as const,
  translateZ: 40,
  rotateX: 10,
  rotateY: -30,
  rotateZ: 5
}
const origin = {
  x: { unit: 'PERCENT' as const, value: 0 },
  y: { unit: 'PIXELS' as const, value: 20 }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas 3D transforms', () => {
  it('creates, reads, preserves, updates, and clears 3D state without changing layout', async () => {
    const fixture = createFixture()
    const native = {
      scene: { figma: { scene3d: { perspective: 800, preserve3d: true } } },
      card: { figma: { transform3d, transformOrigin: origin } }
    }
    const created = await handleApplyCanvas({ mode: 'create', markup, native })
    const scene = fixture.getNode(created.rootNodeId!)
    const card = fixture.getNode(created.nodeIdsByKey.card!)
    const geometry = {
      width: card.width,
      height: card.height,
      relativeTransform: card.relativeTransform
    }
    expect(geometry).toMatchObject({ width: 160, height: 80 })
    expect(created.verification.nativeFieldsChecked).toBe(3)
    expect(handleGetStructure([scene], 1, true).roots[0]).toMatchObject({
      native: { scene3d: { perspective: 800, preserve3d: true } },
      children: [{ native: { transform3d, transformOrigin: origin } }]
    })
    const update = { mode: 'update' as const, targetNodeId: scene.id, native }
    await expect(handleApplyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    await handleApplyCanvas({ ...update, native: { card: { figma: { name: 'Card' } } } })
    expect(readFigma3d(card)).toMatchObject({ transform3d, transformOrigin: origin })
    await handleApplyCanvas({
      ...update,
      native: {
        card: {
          figma: {
            transform3d: { ...transform3d, rotateY: 45, visible: false, backfaceVisible: false }
          }
        }
      }
    })
    expect(card).toMatchObject(geometry)
    const cleared = {
      ...update,
      native: {
        scene: { figma: { scene3d: null } },
        card: { figma: { transform3d: { type: 'NONE' as const } } }
      }
    }
    const clearedResult = await handleApplyCanvas(cleared)
    expect(clearedResult.verification.nativeFieldsChecked).toBe(2)
    expect(readFigma3d(card).transform3d).toEqual({ type: 'NONE' })
    expect(readFigma3d(scene).scene3d).toBeNull()
    const clearedOutline = handleGetStructure([scene], 1, true).roots[0]!
    expect(clearedOutline).not.toHaveProperty('native')
    expect(clearedOutline.children?.[0]?.native).toEqual({ transformOrigin: origin })
    await expect(handleApplyCanvas(cleared)).resolves.toMatchObject({ mutationCount: 0 })
    await handleApplyCanvas({
      ...update,
      native: {
        card: {
          figma: {
            transformOrigin: {
              x: { unit: 'PERCENT', value: 50 },
              y: { unit: 'PERCENT', value: 50 }
            }
          }
        }
      }
    })
    expect(handleGetStructure([scene], 1, true).roots[0]?.children?.[0]).not.toHaveProperty(
      'native'
    )
  })

  it('converges default booleans and a scene normalized to null', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas({ mode: 'create', markup })
    const card = fixture.getNode(created.nodeIdsByKey.card!)
    Object.assign(card, { transform3d: { ...transform3d, visible: true, backfaceVisible: true } })
    await expect(
      handleApplyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: {
          scene: { figma: { scene3d: { perspective: -1, preserve3d: false } } },
          card: { figma: { transform3d } }
        }
      })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })

  it('rejects an unavailable beta API before changing an existing node', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas({ mode: 'create', markup })
    const card = fixture.getNode(created.nodeIdsByKey.card!)
    Reflect.deleteProperty(card, 'transform3d')
    fixture.commitUndo.mockClear()
    await expect(
      handleApplyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { card: { figma: { name: 'Changed', transform3d } } }
      })
    ).rejects.toThrow('transform3d')
    expect(card.name).toBe('card')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it('rejects an ignored clear using full native verification', async () => {
    const fixture = createFixture()
    const created = await handleApplyCanvas({
      mode: 'create',
      markup,
      native: { card: { figma: { transform3d } } }
    })
    const card = fixture.getNode(created.nodeIdsByKey.card!)
    Object.defineProperty(card, 'transform3d', {
      configurable: true,
      get: () => transform3d,
      set: () => {}
    })
    await expect(
      handleApplyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        native: { card: { figma: { transform3d: { type: 'NONE' } } } }
      })
    ).rejects.toThrow('transform3d does not match')
    expect(handleGetStructure([card], 0, true).roots[0]?.native).toEqual({ transform3d })
  })

  it.each(['transform3d', 'transformOrigin', 'scene3d'] as const)(
    'rejects mismatched native %s readback',
    async (field) => {
      const fixture = createFixture()
      const created = await handleApplyCanvas({ mode: 'create', markup })
      const scene = fixture.getNode(created.rootNodeId!)
      const before = readFigma3d(scene)[field]
      Object.defineProperty(scene, field, { configurable: true, get: () => before, set: () => {} })
      const properties: CanvasFigmaProperties = {
        transform3d,
        transformOrigin: origin,
        scene3d: { perspective: 800, preserve3d: true }
      }
      await expect(
        handleApplyCanvas({
          mode: 'update',
          targetNodeId: scene.id,
          native: { scene: { figma: { [field]: properties[field] } } }
        })
      ).rejects.toThrow(`${field} does not match`)
    }
  )

  it('rejects a scene on a shape before creation', async () => {
    const fixture = createFixture()
    await expect(
      handleApplyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="flex w-40 h-40"><div data-key="shape" class="w-20 h-20"/></div>',
        native: {
          shape: {
            figma: { shape: { type: 'RECTANGLE' }, scene3d: { perspective: 800, preserve3d: true } }
          }
        }
      })
    ).rejects.toThrow('scene3d')
    expect(fixture.commitUndo).not.toHaveBeenCalled()
  })

  it('reads imported FREEFORM state without making it writable', () => {
    const fixture = createFixture()
    const shape = fixture.createNode('RECTANGLE')
    Object.assign(shape, {
      transform3d: { type: 'FREEFORM', backfaceVisible: false, visible: false }
    })
    expect(handleGetStructure([shape], 0, true).roots[0]?.native?.transform3d).toEqual({
      type: 'FREEFORM',
      backfaceVisible: false,
      visible: false
    })
    expect(handleGetStructure([shape], 0).roots[0]).not.toHaveProperty('native')
  })

  it.each(['degrees', 'radians'] as const)(
    'converges float32 %s readback while retaining small 3D edits',
    async (unit) => {
      const fixture = createFixture()
      const created = await handleApplyCanvas({ mode: 'create', markup })
      const card = fixture.getNode(created.nodeIdsByKey.card!)
      let value = readFigma3d(card).transform3d
      Object.defineProperty(card, 'transform3d', {
        configurable: true,
        get: () => value,
        set: (next: typeof transform3d) => {
          const angle = (degrees: number) =>
            unit === 'degrees'
              ? Math.fround(degrees)
              : (Math.fround((degrees * Math.PI) / 180) * 180) / Math.PI
          value = {
            ...next,
            rotateX: angle(next.rotateX),
            rotateY: angle(next.rotateY),
            rotateZ: angle(next.rotateZ),
            translateZ: Math.fround(next.translateZ)
          }
        }
      })
      const update = (rotateX: number) =>
        handleApplyCanvas({
          mode: 'update',
          targetNodeId: created.rootNodeId!,
          native: { card: { figma: { transform3d: { ...transform3d, rotateX, translateZ: 0.3 } } } }
        })
      await update(0.3)
      await expect(update(0.3)).resolves.toMatchObject({ mutationCount: 0 })
      await expect(update(0.301)).resolves.toMatchObject({ mutationCount: 1 })
      await expect(update(0.301)).resolves.toMatchObject({ mutationCount: 0 })
    }
  )
})
