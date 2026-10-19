import type {
  CanvasVariableBindings,
  CanvasPageProperties,
  CanvasFigmaVectorNetwork
} from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { specError } from '../errors'
import { resolveStyle } from '../styles'
import { variableReferenceCacheKey } from '../variables'
import { vectorPathsEqual, canonicalVectorPaths } from '../vector'
import { currentBoundVariableId } from './binding-values'
import { nativeValueEqual, FIGMA_NATIVE_TOLERANCE, rotationsMatch } from './comparison'
import { preservesComponentPropertyReference } from './components'
import {
  paintStacksEqual,
  nativePaint,
  nativeEffect,
  effectsEqual,
  nativeLayoutGrid,
  layoutGridsEqual,
  comparablePaint
} from './native-values'
import { isFrameContainer, hasCanvasKeyVectorPattern } from './nodes'
import {
  type SupportedCanvasNode,
  type ApplyState,
  markMutation,
  setValue,
  type CanvasFrameContainerNode
} from './state'

function applyPaint(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  field: 'fill' | 'stroke',
  state: ApplyState
): void {
  if (!('fills' in node)) {
    specError(`${field} paints are not supported on ${node.type} node "${spec.key}".`)
  }
  const color = spec.appearance?.[field]
  if (color === undefined) return

  const property = field === 'fill' ? 'fills' : 'strokes'
  const styleProperty = field === 'fill' ? 'fillStyleId' : 'strokeStyleId'
  if (spec.styles?.[field] || (node[styleProperty] && !spec.variables?.[field])) return
  const paints = node[property]
  const desired = color === null ? [] : [figma.util.solidPaint(color)]
  const binding = spec.variables?.[field]
  const currentVariable = node.boundVariables?.[property]?.[0]
  if (!binding && currentVariable) return
  if (binding) {
    if (color === null) {
      const label = field === 'fill' ? 'Fill' : 'Stroke'
      specError(`${label} variable binding on "${spec.key}" requires a solid fallback paint.`)
    }
    const variable = state.variables.variableCache.get(variableReferenceCacheKey(binding))
    if (variable && currentVariable?.id === variable.id) return
  }
  if (paints !== figma.mixed && paintStacksEqual(paints, desired)) {
    return
  }

  node[property] = desired
  markMutation(state, node)
}

const STROKE_WEIGHT_FIELDS = [
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight'
] as const satisfies ReadonlyArray<VariableBindableNodeField>

const CORNER_RADIUS_FIELDS = [
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius'
] as const satisfies ReadonlyArray<VariableBindableNodeField>

function hasDesiredVariable(
  spec: CanvasNodeSpec,
  fields: ReadonlyArray<keyof CanvasVariableBindings>
): boolean {
  return fields.some((field) => spec.variables?.[field] !== undefined)
}

function hasCurrentVariable(
  node: SupportedCanvasNode,
  fields: ReadonlyArray<VariableBindableNodeField>
): boolean {
  return fields.some((field) => currentBoundVariableId(node, field) !== undefined)
}

function applyIndividualValue(
  node: SupportedCanvasNode,
  current: number,
  desired: number | undefined,
  field: VariableBindableNodeField,
  uniformField: VariableBindableNodeField,
  spec: CanvasNodeSpec,
  apply: (value: number) => void,
  state: ApplyState
): void {
  if (spec.variables?.[uniformField as keyof CanvasVariableBindings]) return
  if (currentBoundVariableId(node, uniformField)) return
  if (spec.variables?.[field as keyof CanvasVariableBindings]) return
  if (currentBoundVariableId(node, field)) return
  setValue(node, current, desired, apply, state)
}

export function applyAppearance(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const appearance = spec.appearance
  if (!appearance) return

  if ('fills' in node) {
    applyPaint(node, spec, 'fill', state)
    applyPaint(node, spec, 'stroke', state)
  }
  if ('strokeWeight' in node) {
    setValue(
      node,
      node.strokeWeight,
      appearance.strokeTopWeight !== undefined ||
        spec.variables?.strokeWeight ||
        hasDesiredVariable(spec, STROKE_WEIGHT_FIELDS) ||
        currentBoundVariableId(node, 'strokeWeight') ||
        hasCurrentVariable(node, STROKE_WEIGHT_FIELDS)
        ? undefined
        : appearance.strokeWeight,
      (value) => (node.strokeWeight = value),
      state
    )
    if ('strokeTopWeight' in node) {
      for (const field of STROKE_WEIGHT_FIELDS) {
        applyIndividualValue(
          node,
          node[field],
          appearance[field],
          field,
          'strokeWeight',
          spec,
          (value) => (node[field] = value),
          state
        )
      }
    }
  }
  if ('cornerRadius' in node) {
    setValue(
      node,
      node.cornerRadius,
      appearance.topLeftRadius !== undefined ||
        spec.variables?.cornerRadius ||
        hasDesiredVariable(spec, CORNER_RADIUS_FIELDS) ||
        currentBoundVariableId(node, 'cornerRadius') ||
        hasCurrentVariable(node, CORNER_RADIUS_FIELDS)
        ? undefined
        : appearance.cornerRadius,
      (value) => (node.cornerRadius = value),
      state
    )
    if ('topLeftRadius' in node) {
      for (const field of CORNER_RADIUS_FIELDS) {
        applyIndividualValue(
          node,
          node[field],
          appearance[field],
          field,
          'cornerRadius',
          spec,
          (value) => (node[field] = value),
          state
        )
      }
    }
  }
  if ('clipsContent' in node) {
    setValue(
      node,
      node.clipsContent,
      appearance.clipsContent,
      (value) => (node.clipsContent = value),
      state
    )
  }
  if ('opacity' in node) {
    setValue(
      node,
      node.opacity,
      spec.variables?.opacity || currentBoundVariableId(node, 'opacity')
        ? undefined
        : appearance.opacity,
      (value) => (node.opacity = value),
      state
    )
  }

  const stroke = spec.figma?.stroke
  if (stroke) {
    if (!('strokeAlign' in node)) {
      specError(`Stroke geometry is not supported on ${node.type} node "${spec.key}".`)
    }
    setValue(node, node.strokeAlign, stroke.align, (value) => (node.strokeAlign = value), state)
    if ('strokeCap' in node) {
      setValue(node, node.strokeCap, stroke.cap, (value) => (node.strokeCap = value), state)
    }
    setValue(node, node.strokeJoin, stroke.join, (value) => (node.strokeJoin = value), state)
    if ('strokeMiterLimit' in node) {
      setValue(
        node,
        node.strokeMiterLimit,
        stroke.miterLimit,
        (value) => (node.strokeMiterLimit = value),
        state
      )
    }
    if (
      stroke.dashPattern !== undefined &&
      !nativeValueEqual(node.dashPattern, stroke.dashPattern)
    ) {
      node.dashPattern = stroke.dashPattern
      markMutation(state, node)
    }
  }
  if ('cornerSmoothing' in node) {
    setValue(
      node,
      node.cornerSmoothing,
      spec.figma?.corners?.smoothing,
      (value) => (node.cornerSmoothing = value),
      state
    )
  }
}

export function applyPaintStacks(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  for (const [property, styleProperty] of [
    ['fills', 'fillStyleId'],
    ['strokes', 'strokeStyleId']
  ] as const) {
    const paints = spec.figma?.[property]
    if (paints === undefined) continue
    if (!('fills' in node)) {
      specError(`Direct paints are not supported on ${node.type} node "${spec.key}".`)
    }
    const desired = paints.map((paint) => nativePaint(paint, state))
    const current = node[property]
    if (current !== figma.mixed && !node[styleProperty] && paintStacksEqual(current, desired)) {
      continue
    }
    node[property] = desired
    markMutation(state, node)
  }
}

function hasShadowSpread(spec: CanvasNodeSpec): boolean {
  return (
    spec.figma?.effects?.some(
      (effect) =>
        (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') &&
        (effect.spread !== undefined || effect.variables?.spread !== undefined)
    ) ?? false
  )
}

function shadowSpreadError(spec: CanvasNodeSpec): never {
  return specError(
    `Shadow spread on "${spec.key}" requires a rectangle, ellipse, or a clipped frame/instance with a visible fill; authored components and component sets count as frames.`
  )
}

export function preflightShadowSpread(spec: CanvasNodeSpec, existing?: SupportedCanvasNode): void {
  if (!hasShadowSpread(spec) || spec.type === 'RECTANGLE' || spec.type === 'ELLIPSE') return
  // Instance swaps and deferred fills need the final native state. Frame clipping,
  // however, is known before resources are created, including normalized defaults.
  if (spec.type !== 'FRAME' && spec.type !== 'COMPONENT') return
  const clipsContent =
    spec.appearance?.clipsContent ??
    (existing && 'clipsContent' in existing ? existing.clipsContent : false)
  if (!clipsContent) shadowSpreadError(spec)
}

function validateShadowSpread(node: SupportedCanvasNode, spec: CanvasNodeSpec): void {
  if (!hasShadowSpread(spec) || node.type === 'RECTANGLE' || node.type === 'ELLIPSE') return
  const authoredFills = spec.figma?.fills
  const hasLiveVisibleFill =
    'fills' in node &&
    node.fills !== figma.mixed &&
    node.fills.some((paint) => paint.visible ?? true)
  const hasVisibleFill =
    authoredFills === undefined
      ? hasLiveVisibleFill
      : authoredFills.some((paint) => paint.visible ?? true)
  if ((isFrameContainer(node) || node.type === 'INSTANCE') && node.clipsContent && hasVisibleFill) {
    return
  }
  shadowSpreadError(spec)
}

export function applyEffects(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const effects = spec.figma?.effects
  if (effects === undefined) return
  if (!('effects' in node)) {
    specError(`Effects are not supported on ${node.type} node "${spec.key}".`)
  }
  validateShadowSpread(node, spec)
  const desired = effects.map((effect) => nativeEffect(effect, state))
  if (!node.effectStyleId && effectsEqual(node.effects, desired)) return
  node.effects = desired
  markMutation(state, node)
}

export function applyLayoutAids(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  if (!isFrameContainer(node) && node.type !== 'INSTANCE') return
  const layoutGrids = spec.figma?.layoutGrids
  if (layoutGrids !== undefined) {
    const desired = layoutGrids.map((grid) => nativeLayoutGrid(grid, state))
    if (node.gridStyleId || !layoutGridsEqual(node.layoutGrids, desired)) {
      node.layoutGrids = desired
      markMutation(state, node)
    }
  }
  applyGuides(node, spec.figma?.guides, state)
}

export function applyGuides(
  node: CanvasFrameContainerNode | InstanceNode | PageNode,
  guides: CanvasPageProperties['guides'],
  state: ApplyState
): void {
  if (guides === undefined || nativeValueEqual(node.guides, guides)) return
  node.guides = guides
  markMutation(state, node)
}

async function nativeVectorNetwork(
  network: CanvasFigmaVectorNetwork,
  state: ApplyState
): Promise<VectorNetwork> {
  const { regions, ...geometry } = network
  if (!regions) return geometry

  return {
    ...geometry,
    regions: await Promise.all(
      regions.map(async ({ fills, fillStyle, ...region }) => ({
        ...region,
        ...(fills === undefined ? {} : { fills: fills.map((paint) => nativePaint(paint, state)) }),
        ...(fillStyle ? { fillStyleId: (await resolveStyle(fillStyle, state.styles)).id } : {})
      }))
    )
  }
}

function comparableVectorNetwork(network: VectorNetwork, expected: VectorNetwork): unknown {
  return {
    vertices: network.vertices,
    segments: network.segments.map((segment) => ({
      ...segment,
      tangentStart: segment.tangentStart ?? { x: 0, y: 0 },
      tangentEnd: segment.tangentEnd ?? { x: 0, y: 0 }
    })),
    regions: (network.regions ?? []).map(({ fills, fillStyleId, ...region }, regionIndex) => {
      const expectedFills = expected.regions?.[regionIndex]?.fills
      return {
        ...region,
        ...(fillStyleId
          ? { fillStyleId }
          : fills === undefined
            ? {}
            : {
                fills: fills.map((paint, paintIndex) =>
                  comparablePaint(paint, expectedFills?.[paintIndex] ?? paint)
                )
              })
      }
    })
  }
}

function vectorNetworksEqual(current: VectorNetwork, desired: VectorNetwork): boolean {
  return nativeValueEqual(
    comparableVectorNetwork(current, desired),
    comparableVectorNetwork(desired, desired),
    FIGMA_NATIVE_TOLERANCE
  )
}

export async function applyShape(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState,
  resolveCanvasReferences = false
): Promise<void> {
  const shape = spec.figma?.shape
  if (!shape) return

  switch (shape.type) {
    case 'RECTANGLE':
    case 'LINE':
      return
    case 'ELLIPSE': {
      if (!shape.arc) return
      if (node.type !== 'ELLIPSE') specError(`Native shape "${spec.key}" is not an ellipse.`)
      const desired = {
        startingAngle: (shape.arc.startAngle * Math.PI) / 180,
        endingAngle: (shape.arc.endAngle * Math.PI) / 180,
        innerRadius: shape.arc.innerRadius
      }
      const current = node.arcData
      if (
        Math.abs(current.startingAngle - desired.startingAngle) <= 1e-6 &&
        Math.abs(current.endingAngle - desired.endingAngle) <= 1e-6 &&
        Math.abs(current.innerRadius - desired.innerRadius) <= 1e-6
      ) {
        return
      }
      node.arcData = desired
      markMutation(state, node)
      return
    }
    case 'POLYGON':
      if (shape.pointCount === undefined) return
      if (node.type !== 'POLYGON') specError(`Native shape "${spec.key}" is not a polygon.`)
      setValue(node, node.pointCount, shape.pointCount, (value) => (node.pointCount = value), state)
      return
    case 'STAR':
      if (node.type !== 'STAR') specError(`Native shape "${spec.key}" is not a star.`)
      setValue(node, node.pointCount, shape.pointCount, (value) => (node.pointCount = value), state)
      setValue(
        node,
        node.innerRadius,
        shape.innerRadius,
        (value) => (node.innerRadius = value),
        state
      )
      return
    case 'VECTOR': {
      if (node.type !== 'VECTOR') specError(`Native shape "${spec.key}" is not a vector.`)
      setValue(
        node,
        node.handleMirroring,
        shape.handleMirroring,
        (value) => (node.handleMirroring = value),
        state
      )
      if (shape.paths !== undefined) {
        if (vectorPathsEqual(node.vectorPaths, shape.paths)) return
        node.vectorPaths = canonicalVectorPaths(shape.paths)
        markMutation(state, node)
        return
      }
      if (shape.network !== undefined) {
        if (!resolveCanvasReferences && hasCanvasKeyVectorPattern(spec)) return
        const network = await nativeVectorNetwork(shape.network, state)
        if (vectorNetworksEqual(node.vectorNetwork, network)) return
        await node.setVectorNetworkAsync(network)
        markMutation(state, node)
      }
    }
  }
}

export function applySharedLayerState(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  setValue(
    node,
    node.visible,
    preservesComponentPropertyReference(node, spec, 'visible') ||
      spec.variables?.visible ||
      currentBoundVariableId(node, 'visible')
      ? undefined
      : spec.visible,
    (value) => (node.visible = value),
    state
  )
  if ('blendMode' in node) {
    setValue(node, node.blendMode, spec.blendMode, (value) => (node.blendMode = value), state)
  }
  if (
    'rotation' in node &&
    spec.rotation !== undefined &&
    !rotationsMatch(node.rotation, spec.rotation)
  ) {
    node.rotation = spec.rotation
    markMutation(state, node)
  }
  const aspectRatioLocked = spec.figma?.aspectRatioLocked
  if (aspectRatioLocked !== undefined) {
    if (!('targetAspectRatio' in node)) {
      specError(`Aspect-ratio locking is not supported on ${node.type} node "${spec.key}".`)
    }
    if ((node.targetAspectRatio !== null) !== aspectRatioLocked) {
      if (aspectRatioLocked) node.lockAspectRatio()
      else node.unlockAspectRatio()
      markMutation(state, node)
    }
  }
  setValue(node, node.locked, spec.figma?.locked, (value) => (node.locked = value), state)
}

export function applyMask(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): void {
  const mask = spec.figma?.mask
  if (mask === undefined) return
  if (!('isMask' in node)) {
    specError(`Masks are not supported on ${node.type} node "${spec.key}".`)
  }
  if (mask !== null) {
    setValue(node, node.maskType, mask, (value) => (node.maskType = value), state)
  }
  setValue(node, node.isMask, mask !== null, (value) => (node.isMask = value), state)
}
