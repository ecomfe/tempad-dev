import type { CanvasVariableBindings, CanvasVariableReference } from '@tempad-dev/shared'

import type { CanvasNodeSpec, ParsedCanvasTreeInput } from '../model'
import type {
  ApplyState,
  VerificationWarning,
  SupportedCanvasNode,
  CanvasFrameContainerNode
} from './state'

import { readOwnedNodeKey } from '../identity'
import {
  DIRECT_VARIABLE_FIELDS,
  type DirectVariableField,
  currentBoundVariableId
} from './binding-values'
import { isRecord, GEOMETRY_TOLERANCE, finiteRect } from './comparison'
import { layoutStrokeWeight, includedLayoutEdgeStroke } from './layout'
import { walkSpecs, isSupportedSceneNode, isFrameContainer, isSceneNode } from './nodes'

const CONTENT_OVERFLOW_TOLERANCE = 0.5

function collectKeyReferences(value: unknown, field: string, references: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyReferences(item, field, references)
    return
  }
  if (!isRecord(value)) return
  if (typeof value[field] === 'string') references.add(value[field])
  for (const nested of Object.values(value)) collectKeyReferences(nested, field, references)
}

function desiredKeyReferences(values: unknown[], field: string): Set<string> {
  const references = new Set<string>()
  for (const value of values) collectKeyReferences(value, field, references)
  return references
}

export function unboundCreatedResourceWarnings(
  desiredValues: unknown[],
  state: ApplyState
): VerificationWarning[] {
  return [
    {
      code: 'unbound-created-variable' as const,
      consumer: 'node or style',
      keys: state.variables.createdVariableKeys,
      referenceField: 'variableKey',
      resource: 'variable'
    },
    {
      code: 'unbound-created-style' as const,
      consumer: 'node',
      keys: state.styles.createdStyleKeys,
      referenceField: 'styleKey',
      resource: 'style'
    }
  ].flatMap(({ code, consumer, keys, referenceField, resource }) => {
    if (!keys.size) return []
    const references = desiredKeyReferences(desiredValues, referenceField)
    return [...keys]
      .filter((key) => !references.has(key))
      .map((key) => ({
        code,
        key,
        message: `This new ${resource} is not referenced by the desired result. Bind it to a representative ${consumer}, or remove it if it is speculative.`
      }))
  })
}

type VariableFallback = boolean | number | string | RGBA

export function ignoredLiteralWarnings(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  nativeOnly: boolean
): VerificationWarning[] {
  const fields: string[] = []
  for (const [field, nativeField] of Object.entries(DIRECT_VARIABLE_FIELDS) as Array<
    [DirectVariableField, VariableBindableNodeField | VariableBindableTextField]
  >) {
    if (spec.variables?.[field] !== undefined || !currentBoundVariableId(node, nativeField))
      continue
    // Native-only specs copy size and characters to preserve live state, not to author literals.
    if (nativeOnly && (field === 'characters' || Object.hasOwn(spec.size, field))) continue
    const literal = variableFallback(spec, field)
    if (literal !== undefined) fields.push(field)
  }
  for (const field of ['fill', 'stroke'] as const) {
    if (
      spec.variables?.[field] !== undefined ||
      spec.styles?.[field] !== undefined ||
      spec.appearance?.[field] === undefined ||
      !('fills' in node)
    )
      continue
    const property = field === 'fill' ? 'fills' : 'strokes'
    const style = field === 'fill' ? node.fillStyleId : node.strokeStyleId
    if (style || node.boundVariables?.[property]?.length) fields.push(field)
  }
  if (node.type === 'TEXT' && node.textStyleId && spec.styles?.text === undefined) {
    for (const field of [
      'fontFamily',
      'fontStyle',
      'fontSize',
      'lineHeight',
      'letterSpacing'
    ] as const) {
      if (spec.text?.[field] !== undefined) fields.push(field)
    }
  }
  return fields.length
    ? [
        {
          code: 'literal-ignored-by-binding',
          key: spec.key,
          message: `Literal values for ${[...new Set(fields)].join(', ')} were ignored because existing variable or style bindings own those fields. Clear the corresponding native.${spec.key}.variables or styles binding with null before setting literal values.`
        }
      ]
    : []
}

function parseFallbackColor(value: string): RGBA | undefined {
  const hex = value.slice(1)
  const expanded =
    hex.length === 3 || hex.length === 4
      ? [...hex].map((character) => `${character}${character}`).join('')
      : hex
  if (expanded.length !== 6 && expanded.length !== 8) return undefined
  const channels = expanded.match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16))
  if (!channels || channels.some((channel) => Number.isNaN(channel))) return undefined
  return {
    r: channels[0]! / 255,
    g: channels[1]! / 255,
    b: channels[2]! / 255,
    a: channels[3] === undefined ? 1 : channels[3] / 255
  }
}

function paddingFallback(
  layout: CanvasNodeSpec['layout'],
  side: 'bottom' | 'left' | 'right' | 'top'
): number | undefined {
  if (!layout || layout.mode === 'NONE' || layout.padding === undefined) return undefined
  return typeof layout.padding === 'number' ? layout.padding : layout.padding[side]
}

function metricFallback(value: unknown): number | undefined {
  return isRecord(value) && value.unit === 'PIXELS' && typeof value.value === 'number'
    ? value.value
    : undefined
}

function variableFallback(
  spec: CanvasNodeSpec,
  field: keyof CanvasVariableBindings
): VariableFallback | undefined {
  switch (field) {
    case 'fill':
    case 'stroke': {
      const value = spec.appearance?.[field]
      return typeof value === 'string' ? parseFallbackColor(value) : undefined
    }
    case 'characters':
      return spec.text?.characters
    case 'visible':
      return spec.visible
    case 'width':
    case 'height':
    case 'minWidth':
    case 'maxWidth':
    case 'minHeight':
    case 'maxHeight':
      return spec.size[field] ?? undefined
    case 'gap':
      return spec.layout?.mode === 'HORIZONTAL' || spec.layout?.mode === 'VERTICAL'
        ? spec.layout.gap
        : undefined
    case 'counterAxisSpacing':
      return spec.layout?.mode === 'HORIZONTAL' || spec.layout?.mode === 'VERTICAL'
        ? spec.layout.counterGap
        : undefined
    case 'gridRowGap':
      return spec.layout?.mode === 'GRID' ? spec.layout.rowGap : undefined
    case 'gridColumnGap':
      return spec.layout?.mode === 'GRID' ? spec.layout.columnGap : undefined
    case 'paddingTop':
      return paddingFallback(spec.layout, 'top')
    case 'paddingRight':
      return paddingFallback(spec.layout, 'right')
    case 'paddingBottom':
      return paddingFallback(spec.layout, 'bottom')
    case 'paddingLeft':
      return paddingFallback(spec.layout, 'left')
    case 'cornerRadius':
    case 'topLeftRadius':
    case 'topRightRadius':
    case 'bottomRightRadius':
    case 'bottomLeftRadius':
    case 'strokeWeight':
    case 'strokeTopWeight':
    case 'strokeRightWeight':
    case 'strokeBottomWeight':
    case 'strokeLeftWeight':
    case 'opacity':
      return spec.appearance?.[field]
    case 'fontFamily':
      return spec.text?.fontFamily
    case 'fontStyle':
      return spec.text?.fontStyle
    case 'fontSize':
      return spec.text?.fontSize
    case 'lineHeight':
      return metricFallback(spec.text?.lineHeight)
    case 'letterSpacing':
      return metricFallback(spec.text?.letterSpacing)
    case 'fontWeight':
      return spec.text?.literalFontWeight
    case 'paragraphIndent':
    case 'paragraphSpacing':
      return undefined
  }
}

function colorChannels(value: unknown): RGBA | null {
  if (
    !isRecord(value) ||
    typeof value.r !== 'number' ||
    typeof value.g !== 'number' ||
    typeof value.b !== 'number'
  ) {
    return null
  }
  return {
    r: value.r,
    g: value.g,
    b: value.b,
    a: typeof value.a === 'number' ? value.a : 1
  }
}

function fallbackMatches(value: unknown, fallback: VariableFallback): boolean {
  if (typeof fallback === 'number') {
    return typeof value === 'number' && Math.abs(value - fallback) <= GEOMETRY_TOLERANCE
  }
  if (typeof fallback === 'string' || typeof fallback === 'boolean') return value === fallback
  const channels = colorChannels(value)
  if (!channels) return false
  return (
    Math.abs(channels.r - fallback.r) <= 1 / 255 &&
    Math.abs(channels.g - fallback.g) <= 1 / 255 &&
    Math.abs(channels.b - fallback.b) <= 1 / 255 &&
    Math.abs(channels.a - fallback.a) <= 1 / 255
  )
}

function formatFallback(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const channels = colorChannels(value)
  if (!channels) return JSON.stringify(value)
  const bytes = [channels.r, channels.g, channels.b, channels.a].map((channel) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  )
  return `#${bytes.slice(0, channels.a === 1 ? 3 : 4).join('')}`
}

export function authoredVariableFallbackWarnings(
  specs: Iterable<CanvasNodeSpec>,
  variableCollections: ParsedCanvasTreeInput['variableCollections']
): VerificationWarning[] {
  const authoredValues = new Map<string, unknown[]>()
  for (const collection of Object.values(variableCollections ?? {})) {
    if (!collection) continue
    for (const [key, variable] of Object.entries(collection.variables ?? {})) {
      const values = Object.values(variable?.values ?? {})
      if (values.length) authoredValues.set(key, values)
    }
  }

  const directValues = (key: string, seen = new Set<string>()): unknown[] => {
    if (seen.has(key)) return []
    seen.add(key)
    return (authoredValues.get(key) ?? []).flatMap((value) => {
      if (!isRecord(value) || !isRecord(value.variable)) return [value]
      const alias = value.variable.variableKey
      return typeof alias === 'string' ? directValues(alias, new Set(seen)) : []
    })
  }

  const warnings: VerificationWarning[] = []
  for (const spec of specs) {
    for (const [field, reference] of Object.entries(spec.variables ?? {}) as Array<
      [keyof CanvasVariableBindings, CanvasVariableReference | null]
    >) {
      if (!reference || !('variableKey' in reference)) continue
      if (spec.themeVariableFields?.includes(field)) continue
      const values = directValues(reference.variableKey)
      const fallback = variableFallback(spec, field)
      const nativeFallback =
        field === 'opacity' && typeof fallback === 'number' ? fallback * 100 : fallback
      if (
        !values.length ||
        nativeFallback === undefined ||
        values.some((value) => fallbackMatches(value, nativeFallback))
      ) {
        continue
      }
      const authoredValues = [...new Set(values.map(formatFallback))].join(', ')
      const units =
        field === 'opacity'
          ? ' Opacity variables use 0–100 percentages; literal opacity uses 0–1.'
          : ''
      warnings.push({
        code: 'variable-fallback-mismatch',
        key: spec.key,
        message: `"${spec.key}" binds ${field} ${formatFallback(fallback)} to authored variable "${reference.variableKey}", whose direct mode values are ${authoredValues}.${units} Use a matching literal fallback or bind the variable that owns this value.`
      })
    }
  }
  return warnings
}

function layoutAffectingVisibilityWarnings(
  root: CanvasNodeSpec,
  state: ApplyState
): VerificationWarning[] {
  const warnings: VerificationWarning[] = []
  for (const spec of walkSpecs(root)) {
    const property = spec.figma?.componentPropertyReferences?.visible
    if (!property) continue
    const node = state.keyedNodes.get(spec.key)
    const parent = node?.parent
    if (
      !node ||
      !parent ||
      !isSupportedSceneNode(parent) ||
      !isFrameContainer(parent) ||
      parent.layoutMode === 'NONE' ||
      ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE')
    ) {
      continue
    }
    const flowSibling = parent.children.some(
      (child) =>
        child.id !== node.id &&
        isSceneNode(child) &&
        (!('layoutPositioning' in child) || child.layoutPositioning !== 'ABSOLUTE')
    )
    if (
      !flowSibling &&
      parent.primaryAxisSizingMode !== 'AUTO' &&
      parent.counterAxisSizingMode !== 'AUTO'
    ) {
      continue
    }
    warnings.push({
      code: 'layout-affecting-visibility-property',
      key: spec.key,
      message: `Boolean component property "${property}" controls an Auto Layout flow child. Hiding it can resize its parent or move siblings. If geometry must stay stable, put the visible layer inside an always-present fixed slot, make it absolute, or use geometry-equivalent variants; otherwise verify both states and accept the intended reflow.`
    })
  }
  return warnings
}

type ContentOverflow = {
  bottom: number
  left: number
  right: number
  top: number
}

function overflowFromRects(child: Rect, parent: Rect): ContentOverflow | null {
  const overflow = {
    bottom: Math.max(0, child.y + child.height - (parent.y + parent.height)),
    left: Math.max(0, parent.x - child.x),
    right: Math.max(0, child.x + child.width - (parent.x + parent.width)),
    top: Math.max(0, parent.y - child.y)
  }
  return Math.max(overflow.top, overflow.right, overflow.bottom, overflow.left) >
    CONTENT_OVERFLOW_TOLERANCE
    ? overflow
    : null
}

function localNodeBounds(node: SupportedCanvasNode): Rect | null {
  if (![node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) {
    return null
  }
  const transform = node.relativeTransform
  const corners = [
    { x: 0, y: 0 },
    { x: node.width, y: 0 },
    { x: 0, y: node.height },
    { x: node.width, y: node.height }
  ].map(({ x, y }) => ({
    x: transform[0][0] * x + transform[0][1] * y + transform[0][2],
    y: transform[1][0] * x + transform[1][1] * y + transform[1][2]
  }))
  const x = Math.min(...corners.map((corner) => corner.x))
  const y = Math.min(...corners.map((corner) => corner.y))
  const right = Math.max(...corners.map((corner) => corner.x))
  const bottom = Math.max(...corners.map((corner) => corner.y))
  return finiteRect({ x, y, width: right - x, height: bottom - y })
}

function contentOverflow(
  node: SupportedCanvasNode,
  parent: CanvasFrameContainerNode
): ContentOverflow | null {
  const parentBounds = finiteRect(
    'absoluteBoundingBox' in parent ? parent.absoluteBoundingBox : null
  )
  const childBounds = [
    node.type === 'TEXT' && 'absoluteRenderBounds' in node ? node.absoluteRenderBounds : null,
    'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null
  ].map(finiteRect)
  if (parentBounds && childBounds.some(Boolean)) {
    const overflow: ContentOverflow = { bottom: 0, left: 0, right: 0, top: 0 }
    for (const bounds of childBounds) {
      if (!bounds) continue
      const current = overflowFromRects(bounds, parentBounds)
      if (!current) continue
      overflow.bottom = Math.max(overflow.bottom, current.bottom)
      overflow.left = Math.max(overflow.left, current.left)
      overflow.right = Math.max(overflow.right, current.right)
      overflow.top = Math.max(overflow.top, current.top)
    }
    return Math.max(overflow.top, overflow.right, overflow.bottom, overflow.left) >
      CONTENT_OVERFLOW_TOLERANCE
      ? overflow
      : null
  }
  if (parent.layoutMode !== 'NONE') return null
  const local = localNodeBounds(node)
  return local
    ? overflowFromRects(local, { x: 0, y: 0, width: parent.width, height: parent.height })
    : null
}

function formatOverflow(overflow: ContentOverflow): string {
  const edges: Array<[string, number]> = [
    ['top', overflow.top],
    ['right', overflow.right],
    ['bottom', overflow.bottom],
    ['left', overflow.left]
  ]
  return edges
    .filter(([, value]) => value > CONTENT_OVERFLOW_TOLERANCE)
    .map(([edge, value]) => `${edge} ${Math.round(value * 10) / 10}px`)
    .join(', ')
}

function instanceDescendantOverflow(node: InstanceNode): ContentOverflow | null {
  const absoluteRootBounds = finiteRect(node.absoluteBoundingBox)
  const rootBounds = absoluteRootBounds ?? { x: 0, y: 0, width: node.width, height: node.height }
  const overflow: ContentOverflow = { bottom: 0, left: 0, right: 0, top: 0 }
  const stack: SceneNode[] = [...node.children]
  while (stack.length) {
    const descendant = stack.pop()!
    if (descendant.visible === false) continue
    const bounds = absoluteRootBounds
      ? finiteRect(
          descendant.type === 'TEXT'
            ? descendant.absoluteRenderBounds
            : descendant.absoluteBoundingBox
        )
      : descendant.parent === node && isSupportedSceneNode(descendant)
        ? localNodeBounds(descendant)
        : null
    if (bounds) {
      const current = overflowFromRects(bounds, rootBounds)
      if (current) {
        overflow.bottom = Math.max(overflow.bottom, current.bottom)
        overflow.left = Math.max(overflow.left, current.left)
        overflow.right = Math.max(overflow.right, current.right)
        overflow.top = Math.max(overflow.top, current.top)
      }
    }
    if ('children' in descendant) stack.push(...descendant.children)
  }
  return Math.max(overflow.top, overflow.right, overflow.bottom, overflow.left) >
    CONTENT_OVERFLOW_TOLERANCE
    ? overflow
    : null
}

function managedContentOverflowWarnings(
  root: CanvasNodeSpec,
  state: ApplyState
): VerificationWarning[] {
  const warnings: VerificationWarning[] = []
  for (const spec of walkSpecs(root)) {
    const node = state.keyedNodes.get(spec.key)
    if (!node) continue
    const parent = node.parent
    if (!parent || !isSupportedSceneNode(parent) || !isFrameContainer(parent)) continue
    const isFlowChild =
      parent.layoutMode !== 'NONE' &&
      (!('layoutPositioning' in node) || node.layoutPositioning !== 'ABSOLUTE')
    if (node.type !== 'TEXT' && node.type !== 'INSTANCE' && !isFlowChild) continue
    const parentKey = readOwnedNodeKey(parent)
    if (!parentKey) continue
    const overflow = contentOverflow(node, parent)
    if (overflow) {
      warnings.push({
        code: 'managed-content-overflow',
        key: spec.key,
        message: `"${spec.key}" extends beyond parent "${parentKey}" by ${formatOverflow(overflow)}. Parent clipping is ${parent.clipsContent ? 'enabled, so the content will be clipped' : 'disabled, so the content may overlap adjacent content'}. Resize or realign the content when unintended; otherwise verify and retain the intentional overflow.`
      })
    }
    if (node.type !== 'INSTANCE') continue
    const instanceOverflow = instanceDescendantOverflow(node)
    if (!instanceOverflow) continue
    warnings.push({
      code: 'managed-content-overflow',
      key: spec.key,
      message: `"${spec.key}" contains instance content extending beyond its root by ${formatOverflow(instanceOverflow)}. Figma can paint this overflow without expanding the native INSTANCE bounds. Resize the component definition for the real property values, add a size variant, or choose a smaller stable component boundary.`
    })
  }
  return warnings
}

type RoundedCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

function hasVisibleAreaFill(node: SupportedCanvasNode): boolean {
  if (
    node.type === 'TEXT' ||
    node.type === 'LINE' ||
    node.type === 'VECTOR' ||
    !('fills' in node) ||
    node.fills === figma.mixed
  ) {
    return false
  }
  return node.fills.some(
    (paint) => paint.visible !== false && (paint.opacity === undefined || paint.opacity > 0)
  )
}

function roundedCornerRadius(node: SupportedCanvasNode, corner: RoundedCorner): number {
  if (!('topLeftRadius' in node)) return 0
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
    return Number.isFinite(node.cornerRadius) ? node.cornerRadius : 0
  }
  const field =
    corner === 'top-left'
      ? 'topLeftRadius'
      : corner === 'top-right'
        ? 'topRightRadius'
        : corner === 'bottom-right'
          ? 'bottomRightRadius'
          : 'bottomLeftRadius'
  const value = node[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function managedRoundedStrokeOcclusionWarnings(
  root: CanvasNodeSpec,
  state: ApplyState
): VerificationWarning[] {
  const warnings: VerificationWarning[] = []
  for (const parentSpec of walkSpecs(root)) {
    const parent = state.keyedNodes.get(parentSpec.key)
    if (
      !parent ||
      !isFrameContainer(parent) ||
      !parent.clipsContent ||
      parent.strokeAlign === 'OUTSIDE' ||
      !parent.strokes.some(
        (paint) => paint.visible !== false && (paint.opacity === undefined || paint.opacity > 0)
      )
    ) {
      continue
    }

    const innerStrokeWeight = (
      field: 'strokeBottomWeight' | 'strokeLeftWeight' | 'strokeRightWeight' | 'strokeTopWeight'
    ): number => layoutStrokeWeight(parent, field) * (parent.strokeAlign === 'CENTER' ? 0.5 : 1)

    const strokes = {
      bottom: innerStrokeWeight('strokeBottomWeight'),
      left: innerStrokeWeight('strokeLeftWeight'),
      right: innerStrokeWeight('strokeRightWeight'),
      top: innerStrokeWeight('strokeTopWeight')
    }
    for (const child of parent.children) {
      if (
        child.visible === false ||
        !isSupportedSceneNode(child) ||
        !hasVisibleAreaFill(child) ||
        ('rotation' in child && Math.abs(child.rotation) > GEOMETRY_TOLERANCE)
      ) {
        continue
      }
      const childKey = readOwnedNodeKey(child)
      const bounds = localNodeBounds(child)
      if (!childKey || !bounds) continue
      const touches = {
        bottom:
          bounds.y + bounds.height >= parent.height - strokes.bottom - CONTENT_OVERFLOW_TOLERANCE,
        left: bounds.x <= strokes.left + CONTENT_OVERFLOW_TOLERANCE,
        right: bounds.x + bounds.width >= parent.width - strokes.right - CONTENT_OVERFLOW_TOLERANCE,
        top: bounds.y <= strokes.top + CONTENT_OVERFLOW_TOLERANCE
      }
      const affected = (
        [
          ['top-left', touches.top && touches.left, Math.max(strokes.top, strokes.left)],
          ['top-right', touches.top && touches.right, Math.max(strokes.top, strokes.right)],
          [
            'bottom-right',
            touches.bottom && touches.right,
            Math.max(strokes.bottom, strokes.right)
          ],
          ['bottom-left', touches.bottom && touches.left, Math.max(strokes.bottom, strokes.left)]
        ] as Array<[RoundedCorner, boolean, number]>
      ).filter(([corner, touching, stroke]) => {
        if (!touching) return false
        const requiredRadius = Math.max(0, roundedCornerRadius(parent, corner) - stroke)
        return (
          requiredRadius > CONTENT_OVERFLOW_TOLERANCE &&
          roundedCornerRadius(child, corner) + CONTENT_OVERFLOW_TOLERANCE < requiredRadius
        )
      })
      if (!affected.length) continue
      warnings.push({
        code: 'managed-rounded-stroke-occlusion',
        key: childKey,
        message: `"${childKey}" has a visible fill reaching the ${affected
          .map(([corner]) => corner)
          .join(
            ' and '
          )} of rounded, stroked parent "${parentSpec.key}" without a corresponding inner radius. Figma clips to the outer frame but paints the parent stroke behind its children, so the fill can square off or hide that boundary. Inset the child, give its touching corners an inner radius that follows the parent, or add a dedicated foreground boundary; then inspect the rendered pixels.`
      })
    }
  }
  return warnings
}

function includedLayoutTrailingStroke(node: CanvasFrameContainerNode): number {
  return includedLayoutEdgeStroke(
    node,
    node.layoutMode === 'HORIZONTAL' ? 'strokeRightWeight' : 'strokeBottomWeight'
  )
}

function formatGeometry(value: number): string {
  return `${Math.round(value * 10) / 10}px`
}

function managedAutoLayoutInsetWarnings(
  root: CanvasNodeSpec,
  state: ApplyState
): VerificationWarning[] {
  const warnings: VerificationWarning[] = []
  for (const spec of walkSpecs(root)) {
    const node = state.keyedNodes.get(spec.key)
    if (
      !node ||
      !isFrameContainer(node) ||
      (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') ||
      node.primaryAxisSizingMode === 'AUTO' ||
      node.primaryAxisAlignItems !== 'MIN' ||
      node.layoutWrap !== 'NO_WRAP' ||
      (node.layoutMode === 'HORIZONTAL'
        ? spec.size.horizontal !== 'FIXED'
        : spec.size.vertical !== 'FIXED') ||
      Math.abs(node.rotation) > GEOMETRY_TOLERANCE
    ) {
      continue
    }
    const children = node.children.filter(
      (child) =>
        child.visible !== false &&
        (!('layoutPositioning' in child) || child.layoutPositioning !== 'ABSOLUTE')
    )
    if (
      !children.length ||
      children.some(
        (child) =>
          ('layoutGrow' in child && child.layoutGrow > 0) ||
          ('rotation' in child && Math.abs(child.rotation) > GEOMETRY_TOLERANCE)
      )
    ) {
      continue
    }
    const bounds = finiteRect(node.absoluteBoundingBox)
    const childBounds = children.map((child) => finiteRect(child.absoluteBoundingBox))
    if (!bounds || childBounds.some((child) => !child)) continue
    const horizontal = node.layoutMode === 'HORIZONTAL'
    const childEnd = Math.max(
      ...childBounds.map((child) =>
        horizontal ? child!.x + child!.width : child!.y + child!.height
      )
    )
    const actual = (horizontal ? bounds.x + bounds.width : bounds.y + bounds.height) - childEnd
    const padding = horizontal ? node.paddingRight : node.paddingBottom
    const expected = padding + includedLayoutTrailingStroke(node)
    if (Math.abs(actual - expected) <= CONTENT_OVERFLOW_TOLERANCE) continue
    const side = horizontal ? 'right' : 'bottom'
    const diagnosis =
      actual > expected
        ? `The fixed start-aligned main axis leaves ${formatGeometry(actual - expected)} of unmodeled trailing space.`
        : `Resolved content consumes ${formatGeometry(expected - actual)} of the intended trailing inset.`
    warnings.push({
      code: 'managed-auto-layout-inset-mismatch',
      key: spec.key,
      message: `"${spec.key}" resolves to a ${formatGeometry(actual)} ${side} inset after its last in-flow child, while its padding and included inside stroke account for ${formatGeometry(expected)}. ${diagnosis} Use a hugging main axis or resize after content resolves; if the empty space is intentional, express it with main-axis alignment or a growing spacer.`
    })
  }
  return warnings
}

export function layoutWarnings(specs: CanvasNodeSpec[], state: ApplyState): VerificationWarning[] {
  return [
    ...state.ignoredLiteralWarnings,
    ...specs.flatMap((spec) => layoutAffectingVisibilityWarnings(spec, state)),
    ...specs.flatMap((spec) => managedContentOverflowWarnings(spec, state)),
    ...specs.flatMap((spec) => managedRoundedStrokeOcclusionWarnings(spec, state)),
    ...specs.flatMap((spec) => managedAutoLayoutInsetWarnings(spec, state))
  ]
}
