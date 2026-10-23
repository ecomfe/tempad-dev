import type { CanvasVariableBindings } from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'
import type { SupportedCanvasNode, ApplyState } from './state'

import { getMainComponent } from '../../../local-resources'
import { resolvedSvgAsset, SVG_POLICY_VERSION } from '../assets'
import { applyError } from '../errors'
import { readOwnedNodeKey, CANVAS_KEY_NAMESPACE } from '../identity'
import { resolveStyle } from '../styles'
import { resolvedVariable, resolvedCollection, resolvedModeId } from '../variables'
import {
  currentBoundVariableId,
  DIRECT_VARIABLE_FIELDS,
  STYLE_FIELDS,
  styleLinkMatches,
  isTextVariableField,
  textVariableLinkRanges,
  variableLinkMatches
} from './binding-values'
import { clearedVariableMatches, verifyTextRangeBinding } from './bindings'
import { GEOMETRY_TOLERANCE, nativeValueEqual } from './comparison'
import {
  componentDefinitionOwner,
  componentPropertyName,
  componentPropertyMatches,
  resolvedComponent,
  componentLinkMatches
} from './components'
import { supportsLayoutSizing, crossAxisFill } from './layout'
import {
  nativePaint,
  paintStacksEqual,
  nativeEffect,
  effectsEqual,
  describeEffectMismatch,
  nativeLayoutGrid,
  layoutGridsEqual
} from './native-values'
import { isIntrinsicNode, isFrameContainer, isSupportedSceneNode } from './nodes'
import {
  isOwnedSvgChild,
  CANVAS_SVG_DIGEST_NAME,
  CANVAS_SVG_POLICY_NAME,
  CANVAS_SVG_COLOR_NAME
} from './svg'
import { textFillsMatch } from './text-paints'
import { textParagraphs } from './text-paragraphs'
import {
  rangeNeedsTextStyleComposition,
  rangeTextStyleMatches,
  resolvedRangeTextStyle
} from './text-range-style'
import { textMetricRange } from './text-ranges'

function textVariableMismatchHint(
  node: SupportedCanvasNode,
  field: keyof CanvasVariableBindings,
  expected: string | undefined,
  spec: CanvasNodeSpec
): string {
  if (node.type !== 'TEXT' || !expected || field === 'fill' || field === 'stroke') return ''
  const nativeField = DIRECT_VARIABLE_FIELDS[field]
  if (!isTextVariableField(nativeField)) return ''
  for (const scope of textVariableLinkRanges(node, nativeField, spec.figma?.text?.ranges)) {
    const alias = node.getRangeBoundVariable(scope.start, scope.end, nativeField)
    if (alias !== figma.mixed && alias?.id === expected) continue
    return ` Inspect range ${scope.start}:${scope.end}: native whole-node binding can retain local overrides. Explicitly bind the affected text range to "${expected}" to replace those overrides; repeating only the node binding will not repair them.`
  }
  return ''
}

async function appliedVariableMatches(
  node: SupportedCanvasNode,
  field: keyof CanvasVariableBindings,
  expected: string | undefined,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<boolean> {
  if (field === 'fill' || field === 'stroke') {
    const paintField = field === 'fill' ? 'fills' : 'strokes'
    return node.boundVariables?.[paintField]?.[0]?.id === expected
  }
  if (expected === undefined) {
    return clearedVariableMatches(
      node,
      DIRECT_VARIABLE_FIELDS[field],
      spec.figma?.text?.ranges,
      state
    )
  }
  return variableLinkMatches(
    node,
    DIRECT_VARIABLE_FIELDS[field],
    expected,
    spec.figma?.text?.ranges
  )
}

function verifySizingGeometry(
  spec: CanvasNodeSpec,
  node: SupportedCanvasNode,
  parent?: SupportedCanvasNode
): void {
  if (parent && spec.absoluteOffsets) {
    const { right, bottom } = spec.absoluteOffsets
    if (
      (right !== undefined &&
        Math.abs(parent.width - node.x - node.width - right) > GEOMETRY_TOLERANCE) ||
      (bottom !== undefined &&
        Math.abs(parent.height - node.y - node.height - bottom) > GEOMETRY_TOLERANCE)
    ) {
      applyError(`Verification failed for "${spec.key}": absolute edge placement does not match.`)
    }
  }
  if (!isIntrinsicNode(node) && supportsLayoutSizing(node, parent)) {
    if (
      (spec.size.horizontal !== undefined &&
        node.layoutSizingHorizontal !== spec.size.horizontal) ||
      (spec.size.vertical !== undefined && node.layoutSizingVertical !== spec.size.vertical) ||
      (spec.grow !== undefined && node.layoutGrow !== (spec.grow ? 1 : 0))
    ) {
      applyError(
        `Verification failed for "${spec.key}": sizing modes do not match (declared horizontal=${spec.size.horizontal}, vertical=${spec.size.vertical}, grow=${spec.grow ?? false}; applied horizontal=${node.layoutSizingHorizontal}, vertical=${node.layoutSizingVertical}, grow=${node.layoutGrow === 1}).`
      )
    }
  }

  const fixedWidth =
    spec.size.horizontal === 'FIXED' &&
    spec.size.width !== undefined &&
    !spec.variables?.width &&
    !currentBoundVariableId(node, 'width')
      ? spec.size.width
      : null
  const fixedHeight =
    spec.size.vertical === 'FIXED' &&
    spec.size.height !== undefined &&
    !spec.variables?.height &&
    !currentBoundVariableId(node, 'height')
      ? spec.size.height
      : null
  if (
    (fixedWidth !== null && Math.abs(node.width - fixedWidth) > GEOMETRY_TOLERANCE) ||
    (fixedHeight !== null && Math.abs(node.height - fixedHeight) > GEOMETRY_TOLERANCE)
  ) {
    applyError(`Verification failed for "${spec.key}": fixed geometry does not match.`)
  }

  const fill = crossAxisFill(node, spec, parent)
  if (fill) {
    const actual = fill.axis === 'horizontal' ? node.width : node.height
    if (actual < GEOMETRY_TOLERANCE) {
      applyError(`Verification failed for "${spec.key}": fill geometry does not match.`)
    }
  }

  if (node.type !== 'TEXT') return
  if (node.textAutoResize !== spec.text?.autoResize) {
    applyError(`Verification failed for "${spec.key}": text auto-resize does not match.`)
  }
  if (
    node.characters.length > 0 &&
    (node.textAutoResize === 'HEIGHT' || node.textAutoResize === 'WIDTH_AND_HEIGHT') &&
    node.height <= GEOMETRY_TOLERANCE
  ) {
    applyError(`Verification failed for "${spec.key}": auto-resizing text has no height.`)
  }
  if (
    node.characters.length > 0 &&
    node.textAutoResize === 'WIDTH_AND_HEIGHT' &&
    node.width <= GEOMETRY_TOLERANCE
  ) {
    applyError(`Verification failed for "${spec.key}": auto-resizing text has no width.`)
  }
  if (
    node.characters.length > 0 &&
    node.textAutoResize === 'HEIGHT' &&
    node.layoutGrow > 0 &&
    node.width <= GEOMETRY_TOLERANCE &&
    (node.minWidth ?? 0) <= GEOMETRY_TOLERANCE
  ) {
    applyError(
      `Verification failed for "${spec.key}": growing text collapsed to zero width; provide a positive min-width.`
    )
  }
}

async function verifyInstanceState(
  spec: CanvasNodeSpec,
  node: SupportedCanvasNode,
  state: ApplyState
): Promise<void> {
  if (!spec.componentProperties && !spec.figma?.instance) return
  if (node.type !== 'INSTANCE') {
    applyError(`Verification failed for "${spec.key}": expected an instance.`)
  }
  const instance = spec.figma?.instance
  if (
    instance?.scaleFactor !== undefined &&
    Math.abs(node.scaleFactor - instance.scaleFactor) > GEOMETRY_TOLERANCE
  ) {
    applyError(`Verification failed for "${spec.key}": instance scale does not match.`)
  }
  if (instance?.exposed !== undefined && node.isExposedInstance !== instance.exposed) {
    applyError(`Verification failed for "${spec.key}": instance exposure does not match.`)
  }
  if (!spec.componentProperties) return
  const component = await getMainComponent(node)
  if (!component) {
    applyError(`Verification failed for "${spec.key}": instance has no main component.`)
  }
  const owner = componentDefinitionOwner(component)
  for (const [key, value] of Object.entries(spec.componentProperties)) {
    const name = componentPropertyName(owner, key, state) ?? key
    if (!componentPropertyMatches(node.componentProperties[name], value, state)) {
      applyError(
        `Verification failed for "${spec.key}": component property "${name}" does not match.`
      )
    }
  }
}

function verifyNativeNodeState(
  spec: CanvasNodeSpec,
  node: SupportedCanvasNode,
  state: ApplyState
): number {
  let fields = 0
  for (const [property, styleProperty] of [
    ['fills', 'fillStyleId'],
    ['strokes', 'strokeStyleId']
  ] as const) {
    const paints = spec.figma?.[property]
    if (paints === undefined) continue
    fields += 1
    if (!('fills' in node)) {
      applyError(`Verification failed for "${spec.key}": direct ${property} are unsupported.`)
    }
    const desired = paints.map((paint) => nativePaint(paint, state))
    const current = node[property]
    const matches =
      node.type === 'TEXT' && property === 'fills'
        ? textFillsMatch(node, desired, spec.figma?.text?.ranges)
        : current !== figma.mixed && !node[styleProperty] && paintStacksEqual(current, desired)
    if (!matches) {
      applyError(`Verification failed for "${spec.key}": direct ${property} do not match.`)
    }
  }

  const effects = spec.figma?.effects
  if (effects !== undefined) {
    fields += 1
    if (!('effects' in node)) {
      applyError(`Verification failed for "${spec.key}": direct effects are unsupported.`)
    }
    const desired = effects.map((effect) => nativeEffect(effect, state))
    if (node.effectStyleId) {
      applyError(
        `Verification failed for "${spec.key}": expected direct effects, but effect style "${node.effectStyleId}" remains applied.`
      )
    }
    if (!effectsEqual(node.effects, desired)) {
      applyError(
        `Verification failed for "${spec.key}": direct ${describeEffectMismatch(node.effects, desired)}`
      )
    }
  }

  const layoutGrids = spec.figma?.layoutGrids
  if (layoutGrids !== undefined) {
    fields += 1
    if ((!isFrameContainer(node) && node.type !== 'INSTANCE') || !('layoutGrids' in node)) {
      applyError(`Verification failed for "${spec.key}": layout grids are unsupported.`)
    }
    const desired = layoutGrids.map((grid) => nativeLayoutGrid(grid, state))
    if (!!node.gridStyleId || !layoutGridsEqual(node.layoutGrids, desired)) {
      applyError(`Verification failed for "${spec.key}": layout grids do not match.`)
    }
  }

  const guides = spec.figma?.guides
  if (guides !== undefined) {
    fields += 1
    if ((!isFrameContainer(node) && node.type !== 'INSTANCE') || !('guides' in node)) {
      applyError(`Verification failed for "${spec.key}": guides are unsupported.`)
    }
    if (!nativeValueEqual(node.guides, guides)) {
      applyError(`Verification failed for "${spec.key}": guides do not match.`)
    }
  }

  return fields
}

export async function verifyAppliedNode(
  spec: CanvasNodeSpec,
  node: SupportedCanvasNode,
  state: ApplyState,
  parent?: SupportedCanvasNode
): Promise<{ nodes: number; references: number; nativeFields: number }> {
  if (node.type !== spec.type) {
    applyError(`Verification failed for "${spec.key}": expected ${spec.type}, found ${node.type}.`)
  }
  if (state.nodeIdsByKey[spec.key] !== node.id) {
    applyError(
      `Verification failed for "${spec.key}": stable identity did not resolve to its node.`
    )
  }
  if (readOwnedNodeKey(node) !== spec.key) {
    applyError(`Verification failed for "${spec.key}": native stable identity is missing.`)
  }
  if (parent && node.parent?.id !== parent.id) {
    applyError(`Verification failed for "${spec.key}": parent does not match the desired tree.`)
  }
  const geometry = [
    node.x,
    node.y,
    node.width,
    node.height,
    ...('rotation' in node ? [node.rotation] : [])
  ]
  if (!geometry.every(Number.isFinite)) {
    applyError(`Verification failed for "${spec.key}": geometry is not finite.`)
  }
  verifySizingGeometry(spec, node, parent)

  let references = 0
  let nativeFields = verifyNativeNodeState(spec, node, state)
  if (spec.component) {
    const expected = resolvedComponent(spec.component, state)
    const actual = node.type === 'INSTANCE' ? await getMainComponent(node) : null
    references += 1
    if (node.type !== 'INSTANCE' || !componentLinkMatches(spec, node, expected, actual, state)) {
      applyError(`Verification failed for "${spec.key}": component link does not match.`)
    }
  }
  await verifyInstanceState(spec, node, state)
  for (const [field, reference] of Object.entries(spec.variables ?? {}) as Array<
    [keyof CanvasVariableBindings, CanvasVariableBindings[keyof CanvasVariableBindings]]
  >) {
    const expected = reference ? resolvedVariable(reference, state.variables).id : undefined
    references += 1
    if (!(await appliedVariableMatches(node, field, expected, spec, state))) {
      applyError(
        `Verification failed for "${spec.key}": variable link "${field}" does not match.${textVariableMismatchHint(node, field, expected, spec)}`
      )
    }
  }
  for (const field of STYLE_FIELDS) {
    const reference = spec.styles?.[field]
    if (reference === undefined) continue
    const expected = reference ? (await resolveStyle(reference, state.styles)).id : ''
    references += 1
    if (!styleLinkMatches(node, field, expected, spec.figma?.text?.ranges)) {
      applyError(`Verification failed for "${spec.key}": style link "${field}" does not match.`)
    }
  }
  if (node.type === 'TEXT') {
    const ranges = spec.figma?.text?.ranges ?? []
    const paragraphs = textParagraphs(node.characters, ranges)
    for (const [index, range] of ranges.entries()) {
      for (const field of ['fontSize', 'lineHeight', 'letterSpacing'] as const) {
        const reference = range.variables?.[field]
        if (!reference) continue
        references += 1
        verifyTextRangeBinding(
          node,
          textMetricRange(node.characters, range, field, ranges[index + 1]),
          field,
          resolvedVariable(reference, state.variables).id,
          spec.key
        )
      }
      for (const field of ['textStyle', 'fillStyle'] as const) {
        const reference = range[field]
        if (reference === undefined) continue
        const composed =
          field === 'textStyle' ? await resolvedRangeTextStyle(node, range, state) : null
        // Semantic overrides and variable-font weights retain the previous
        // acceptance path until their native style projection can be proved.
        if (field === 'textStyle' && !composed && rangeNeedsTextStyleComposition(range)) continue
        if (composed) {
          nativeFields += 1
          if (!rangeTextStyleMatches(node, range, composed, paragraphs[index]!.effective)) {
            applyError(
              `Verification failed for "${spec.key}": range ${range.start}:${range.end} TextStyle typography does not match.`
            )
          }
          continue
        }
        const expected = reference ? (await resolveStyle(reference, state.styles)).id : ''
        const current =
          field === 'textStyle'
            ? node.getRangeTextStyleId(range.start, range.end)
            : node.getRangeFillStyleId(range.start, range.end)
        references += 1
        if (current !== expected) {
          applyError(
            `Verification failed for "${spec.key}": range ${range.start}:${range.end} ${field} does not match.`
          )
        }
      }
      if (range.fills !== undefined) {
        const current = node.getRangeFills(range.start, range.end)
        const desired = range.fills.map((paint) => nativePaint(paint, state))
        nativeFields += 1
        if (
          current === figma.mixed ||
          node.getRangeFillStyleId(range.start, range.end) !== '' ||
          !paintStacksEqual(current, desired)
        ) {
          applyError(
            `Verification failed for "${spec.key}": range ${range.start}:${range.end} fills do not match.`
          )
        }
      }
    }
  }
  for (const [collectionReference, modeReference] of Object.entries(spec.variableModes ?? {})) {
    const collection = resolvedCollection(collectionReference, state.variables)
    const expected =
      modeReference === null
        ? undefined
        : resolvedModeId(collection, modeReference, state.variables)
    references += 1
    if (node.explicitVariableModes[collection.id] !== expected) {
      applyError(`Verification failed for "${spec.key}": variable mode does not match.`)
    }
  }
  if (spec.figma?.mask !== undefined) {
    nativeFields += 1
    const mask = spec.figma.mask
    if (
      !('isMask' in node) ||
      node.isMask !== (mask !== null) ||
      (mask !== null && (!('maskType' in node) || node.maskType !== mask))
    ) {
      applyError(`Verification failed for "${spec.key}": mask state does not match.`)
    }
  }
  if (spec.figma?.svg) {
    nativeFields += 1
    if (node.type !== 'FRAME') {
      applyError(`Verification failed for "${spec.key}": SVG wrapper is not a frame.`)
    }
    const asset = resolvedSvgAsset(
      state.media.assets,
      spec.figma.svg.assetKey,
      spec.figma.svg.color
    )
    const owned = node.children.filter(isOwnedSvgChild)
    const unexpected = node.children.filter((child) => !isOwnedSvgChild(child))
    if (
      !asset ||
      owned.length !== 1 ||
      unexpected.length ||
      node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_DIGEST_NAME) !== asset.digest ||
      node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_POLICY_NAME) !==
        SVG_POLICY_VERSION ||
      node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_COLOR_NAME) !==
        (spec.figma.svg.color?.toUpperCase() ?? '')
    ) {
      applyError(`Verification failed for "${spec.key}": SVG import state does not match.`)
    }
    const child = owned[0]!
    if (
      child.x < -0.01 ||
      child.y < -0.01 ||
      child.x + child.width > node.width + 0.01 ||
      child.y + child.height > node.height + 0.01
    ) {
      applyError(`Verification failed for "${spec.key}": SVG is outside its wrapper.`)
    }
    references += 1
  }

  const childSpecs = spec.children ?? []
  const childNodes = childSpecs.map((child) => {
    const candidate = state.keyedNodes.get(child.key) ?? null
    if (!isSupportedSceneNode(candidate)) {
      applyError(`Verification failed for "${child.key}": desired child is missing.`)
    }
    return candidate
  })
  if (childNodes.length) {
    if (!('children' in node)) {
      applyError(`Verification failed for "${spec.key}": desired children have no container.`)
    }
    let previous = -1
    for (const child of childNodes) {
      const index = node.children.findIndex((candidate) => candidate.id === child.id)
      if (index <= previous) {
        applyError(`Verification failed for "${spec.key}": desired child order does not match.`)
      }
      previous = index
    }
  }
  let nodes = 1
  for (const [index, childSpec] of childSpecs.entries()) {
    const verified = await verifyAppliedNode(childSpec, childNodes[index]!, state, node)
    nodes += verified.nodes
    references += verified.references
    nativeFields += verified.nativeFields
  }
  return { nodes, references, nativeFields }
}
