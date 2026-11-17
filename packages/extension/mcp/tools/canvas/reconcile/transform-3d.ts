import type { CanvasFigmaProperties } from '@tempad-dev/shared'

import { readFigma3d, type Figma3dProperties } from '@/utils/figma-3d'

import type { CanvasNodeSpec } from '../model'
import type { ApplyState, SupportedCanvasNode } from './state'

import { specError, applyError } from '../errors'
import { nativeValueEqual, scalarValuesEqual } from './comparison'
import { markMutation } from './state'

const FIELDS = ['transform3d', 'transformOrigin', 'scene3d'] as const

export function validateFigma3d(
  key: string,
  type: SceneNode['type'],
  properties?: CanvasFigmaProperties,
  node?: SceneNode | null
): void {
  for (const field of FIELDS) {
    if (properties?.[field] === undefined) continue
    const supported =
      field === 'scene3d'
        ? type === 'FRAME' || type === 'COMPONENT' || type === 'INSTANCE'
        : type !== 'SECTION' && type !== 'COMPONENT_SET'
    if (!supported || (node && !(field in node))) {
      specError(
        `Native field "${field}" is not supported on ${type} node "${key}" in this Figma runtime.`
      )
    }
  }
}

function normalized3d(field: (typeof FIELDS)[number], value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (field === 'transform3d') {
    const transform = value as NonNullable<Figma3dProperties['transform3d']>
    return transform.type === 'NONE'
      ? transform
      : {
          ...transform,
          backfaceVisible: transform.backfaceVisible ?? true,
          visible: transform.visible ?? true
        }
  }
  if (field === 'scene3d') {
    const scene = value as NonNullable<Figma3dProperties['scene3d']>
    if (scene.perspective === -1 && !scene.preserve3d && scene.visible !== false) return null
    return { ...scene, visible: scene.visible ?? true }
  }
  return value
}

function matches(field: (typeof FIELDS)[number], current: unknown, desired: unknown): boolean {
  if (field === 'transform3d') {
    const actual = current as Figma3dProperties['transform3d']
    const expected = desired as Figma3dProperties['transform3d']
    if (actual?.type === 'FIXED_ORDER' && expected?.type === 'FIXED_ORDER') {
      // Native angles can round-trip through float32 radians as well as degrees.
      // Compare the native storage precision without a broad angle tolerance.
      if (
        !(['rotateX', 'rotateY', 'rotateZ'] as const).every(
          (axis) =>
            scalarValuesEqual(actual[axis], expected[axis]) ||
            Math.fround((actual[axis] * Math.PI) / 180) ===
              Math.fround((expected[axis] * Math.PI) / 180)
        )
      )
        return false
      current = {
        ...actual,
        rotateX: expected.rotateX,
        rotateY: expected.rotateY,
        rotateZ: expected.rotateZ
      }
    }
  }
  return nativeValueEqual(
    normalized3d(field, current),
    normalized3d(field, desired),
    scalarValuesEqual
  )
}

export function applyFigma3d(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  validateFigma3d(spec.key, node.type, spec.figma, node)
  const current = readFigma3d(node)
  for (const field of FIELDS) {
    const desired = spec.figma?.[field]
    if (desired === undefined || matches(field, current[field], desired)) continue
    Reflect.set(node, field, desired)
    markMutation(state, node)
  }
}

export function verifyFigma3d(spec: CanvasNodeSpec, node: SupportedCanvasNode): number {
  const current = readFigma3d(node)
  let fields = 0
  for (const field of FIELDS) {
    const desired = spec.figma?.[field]
    if (desired === undefined) continue
    fields += 1
    if (!matches(field, current[field], desired)) {
      applyError(
        `Verification failed for "${spec.key}": ${field} does not match. Actual: ${JSON.stringify(current[field])}; expected: ${JSON.stringify(desired)}.`
      )
    }
  }
  return fields
}
