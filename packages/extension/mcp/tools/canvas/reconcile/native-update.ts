import type { CanvasBinding, ApplyCanvasResult } from '@tempad-dev/shared'

import type { CanvasSizingMode, CanvasNodeSpec, ParsedCanvasNativeUpdateInput } from '../model'

import { resolveCanvasAssets } from '../assets'
import { specError, scopeError, errorMessage } from '../errors'
import { readOwnedNodeKey, pageSnapshot } from '../identity'
import { validateAssetReferences } from '../markup'
import { componentPropertyOwner } from './components'
import {
  isFrameContainer,
  lookupNodeById,
  isSupportedSceneNode,
  assertOutsideInstance,
  collectKeyedNodes,
  containingPage
} from './nodes'
import {
  preflightVectorPaths,
  preflightResources,
  hasDeclaredResources,
  preflightDeclaredResources,
  prepareMedia,
  prepareResources,
  applyStyleResources,
  removeResources
} from './resources'
import { boundedApplyResult, buildVerification } from './results'
import { type SupportedCanvasNode, type CanvasParentNode, createApplyState } from './state'
import { preflightContainers } from './structure-preflight'
import { collectSvgColorsFromSpecs, finalizeSvgPositions } from './svg'
import { applyNodeProperties, applyCanvasKeyReferences } from './tree'
import { withUndoBoundary } from './undo'
import { verifyAppliedNode } from './verification'
import {
  unboundCreatedResourceWarnings,
  authoredVariableFallbackWarnings,
  layoutWarnings
} from './warnings'

function preservedSizingMode(value: unknown): CanvasSizingMode {
  return value === 'FILL' || value === 'HUG' ? value : 'FIXED'
}

function validateNativeUpdateBinding(
  key: string,
  binding: CanvasBinding,
  node: SupportedCanvasNode
): void {
  const properties = binding.figma
  const declaredTypes: Array<CanvasNodeSpec['type'] | undefined> = [
    binding.component || binding.componentProperties || properties?.instance
      ? 'INSTANCE'
      : undefined,
    properties?.text ? 'TEXT' : undefined,
    properties?.shape?.type,
    properties?.section ? 'SECTION' : undefined,
    properties?.group ? 'GROUP' : undefined,
    properties?.booleanOperation ? 'BOOLEAN_OPERATION' : undefined,
    properties?.component?.type,
    properties?.slot ? 'SLOT' : undefined,
    properties?.svg ? 'FRAME' : undefined
  ]
  for (const type of declaredTypes) {
    if (type !== undefined && type !== node.type) {
      specError(`Native state on "${key}" requires ${type}, but the existing node is ${node.type}.`)
    }
  }
  const requiredFields: Array<[unknown, string]> = [
    [properties?.stroke, 'strokeAlign'],
    [properties?.stroke?.weights, 'strokeTopWeight'],
    [properties?.stroke?.cap, 'strokeCap'],
    [properties?.stroke?.miterLimit, 'strokeMiterLimit'],
    [properties?.corners, 'cornerRadius'],
    [properties?.corners?.radii, 'topLeftRadius'],
    [properties?.corners?.smoothing, 'cornerSmoothing'],
    [properties?.layoutGrids, 'layoutGrids'],
    [properties?.guides, 'guides'],
    [properties?.aspectRatioLocked, 'targetAspectRatio']
  ]
  for (const [value, field] of requiredFields) {
    if (value !== undefined && !(field in node)) {
      specError(`Native field "${field}" is not supported on ${node.type} node "${key}".`)
    }
  }
  if (properties?.text?.fontName) {
    if (binding.variables?.fontFamily || binding.variables?.fontStyle) {
      specError(`Font on "${key}" cannot use both variables and an exact Figma font name.`)
    }
    if (binding.styles?.text) {
      specError(`Font on "${key}" cannot use both a Text style and an exact Figma font name.`)
    }
  }
}

function nativeUpdateLayout(
  key: string,
  binding: CanvasBinding,
  node: SupportedCanvasNode
): CanvasNodeSpec['layout'] {
  const autoLayout = binding.figma?.autoLayout
  if (!autoLayout) return

  if (
    !isFrameContainer(node) ||
    (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL')
  ) {
    specError(
      `Figma Auto Layout properties on "${key}" require an existing linear Auto Layout container.`
    )
  }
  if (autoLayout.counterAxisSpacing !== undefined && node.layoutWrap !== 'WRAP') {
    specError(
      `Figma counter-axis spacing on "${key}" requires an existing wrapping Auto Layout container.`
    )
  }
  if (autoLayout.counterAxisSpacing === null && binding.variables?.counterAxisSpacing) {
    specError(
      `Synchronized counter-axis spacing and a counter-axis variable cannot be combined on "${key}".`
    )
  }
  return { mode: node.layoutMode }
}

function nativeUpdateSpec(
  key: string,
  binding: CanvasBinding,
  node: SupportedCanvasNode
): CanvasNodeSpec {
  validateNativeUpdateBinding(key, binding, node)
  const layout = nativeUpdateLayout(key, binding, node)
  const stroke = binding.figma?.stroke
  const corners = binding.figma?.corners
  const size: CanvasNodeSpec['size'] = {
    ...(node.type === 'INSTANCE'
      ? {}
      : {
          width: node.width,
          height: node.height,
          horizontal: preservedSizingMode(
            'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : undefined
          ),
          vertical: preservedSizingMode(
            'layoutSizingVertical' in node ? node.layoutSizingVertical : undefined
          )
        }),
    ...('minWidth' in node ? { minWidth: node.minWidth } : {}),
    ...('maxWidth' in node ? { maxWidth: node.maxWidth } : {}),
    ...('minHeight' in node ? { minHeight: node.minHeight } : {}),
    ...('maxHeight' in node ? { maxHeight: node.maxHeight } : {})
  }
  return {
    key,
    type: node.type,
    ...(binding.figma?.name !== undefined ? { displayName: binding.figma.name } : {}),
    size,
    ...(layout ? { layout } : {}),
    ...(stroke || corners
      ? {
          appearance: {
            strokeWeight: stroke?.weight,
            strokeTopWeight: stroke?.weights?.top,
            strokeRightWeight: stroke?.weights?.right,
            strokeBottomWeight: stroke?.weights?.bottom,
            strokeLeftWeight: stroke?.weights?.left,
            cornerRadius: corners?.radius,
            topLeftRadius: corners?.radii?.topLeft,
            topRightRadius: corners?.radii?.topRight,
            bottomRightRadius: corners?.radii?.bottomRight,
            bottomLeftRadius: corners?.radii?.bottomLeft
          }
        }
      : {}),
    ...(node.type !== 'INSTANCE' && 'layoutGrow' in node ? { grow: node.layoutGrow > 0 } : {}),
    ...(node.type === 'TEXT'
      ? {
          text: {
            characters: node.characters,
            autoResize: node.textAutoResize,
            ...(binding.figma?.text?.fontName
              ? {
                  fontFamily: binding.figma.text.fontName.family,
                  fontStyle: binding.figma.text.fontName.style
                }
              : {}),
            ...(binding.figma?.text?.verticalAlign !== undefined
              ? { alignVertical: binding.figma.text.verticalAlign }
              : {})
          }
        }
      : {}),
    ...binding
  }
}

function nativeUpdateParent(node: SupportedCanvasNode): CanvasParentNode | undefined {
  const parent = node.parent
  if (!parent || parent.type === 'DOCUMENT' || parent.type === 'INSTANCE') return undefined
  return parent as CanvasParentNode
}

export async function reconcileNativeUpdate(
  input: ParsedCanvasNativeUpdateInput
): Promise<ApplyCanvasResult> {
  const candidate = await lookupNodeById(input.targetNodeId)
  if (!isSupportedSceneNode(candidate)) {
    scopeError('The requested update target does not exist or is not a supported scene node.')
  }
  assertOutsideInstance(candidate)
  if (!readOwnedNodeKey(candidate)) {
    scopeError('A markup-less native update requires an exact managed root.')
  }

  const keyedNodes = collectKeyedNodes(candidate)
  const specsByKey = new Map<string, CanvasNodeSpec>()
  for (const [key, binding] of Object.entries(input.bindings)) {
    const node = keyedNodes.get(key)
    if (!node) scopeError(`Canvas key "${key}" does not exist inside the update scope.`)
    assertOutsideInstance(node)
    if (binding.figma?.mask !== undefined) {
      specError(
        `Mask state on "${key}" requires a structural markup update that describes its sibling scope.`
      )
    }
    specsByKey.set(key, nativeUpdateSpec(key, binding, node))
  }
  // Apply owners before sublayers, regardless of the binding order.
  const specs: CanvasNodeSpec[] = []
  for (const key of keyedNodes.keys()) {
    const spec = specsByKey.get(key)
    if (spec) specs.push(spec)
  }
  try {
    validateAssetReferences(specs, input.assets, input.styles)
  } catch (error) {
    specError(errorMessage(error))
  }
  const assets = await resolveCanvasAssets(input.assets, collectSvgColorsFromSpecs(specs))
  const state = createApplyState(candidate, new Set(Object.keys(input.bindings)), assets)
  for (const spec of specs) {
    const node = state.keyedNodes.get(spec.key)!
    state.nodeIdsByKey[spec.key] = node.id
    preflightVectorPaths(spec)
    preflightContainers(spec, state, node)
  }

  const preflight = async (): Promise<void> => {
    for (const spec of specs) {
      const node = state.keyedNodes.get(spec.key)!
      const owner = componentPropertyOwner(node)
      const inherited = owner
        ? { existing: owner, spec: specsByKey.get(readOwnedNodeKey(owner) ?? '') }
        : undefined
      await preflightResources(spec, state, node, inherited)
    }
  }
  const declaresResources = hasDeclaredResources(input)
  if (declaresResources) await preflightDeclaredResources(specs, input, state)
  if (!declaresResources) await preflight()
  await prepareMedia(specs, input, state)
  return withUndoBoundary(async () => {
    if (declaresResources) {
      await prepareResources(input, state)
      await preflight()
    }
    applyStyleResources(state)
    for (const spec of specs) {
      const node = state.keyedNodes.get(spec.key)!
      await applyNodeProperties(node, spec, state, nativeUpdateParent(node), true)
    }
    for (const spec of specs) {
      const node = state.keyedNodes.get(spec.key)!
      await applyCanvasKeyReferences(spec, state, nativeUpdateParent(node))
    }
    finalizeSvgPositions(specs, state)
    await removeResources(state)

    const verified = { nodes: 0, references: 0, nativeFields: 0 }
    for (const spec of specs) {
      const node = state.keyedNodes.get(spec.key)!
      const result = await verifyAppliedNode(
        spec,
        node,
        state,
        isSupportedSceneNode(node.parent) ? node.parent : undefined
      )
      verified.nodes += result.nodes
      verified.references += result.references
      verified.nativeFields += result.nativeFields
    }
    const warnings = [
      ...unboundCreatedResourceWarnings([...specs, input.styles, input.variableCollections], state),
      ...authoredVariableFallbackWarnings(specs, input.variableCollections),
      ...layoutWarnings(specs, state)
    ]
    return boundedApplyResult({
      rootNodeId: candidate.id,
      nodeIdsByKey: state.nodeIdsByKey,
      createdNodeIds: [],
      updatedNodeIds: [...state.updatedNodeIds],
      removedNodeIds: [],
      page: pageSnapshot(containingPage(candidate)),
      mutationCount: state.mutations.count,
      verification: buildVerification(
        verified.nodes,
        verified.references,
        verified.nativeFields,
        warnings
      )
    })
  }, state)
}
