import type { ApplyCanvasResult } from '@tempad-dev/shared'

import type { ParsedCanvasInput } from './model'

import { resolveCanvasAssets } from './assets'
import { scopeError, specError } from './errors'
import { pageSnapshot } from './identity'
import { applyMask } from './reconcile/appearance'
import { finalizeGridsAfterRemovals } from './reconcile/grid'
import { placeCreatedRoot, finalizeAbsolutePositions } from './reconcile/layout'
import { reconcileNativeUpdate } from './reconcile/native-update'
import {
  lookupNodeById,
  isSupportedSceneNode,
  assertOutsideInstance,
  collectDesiredKeys,
  resolveExplicitNodes,
  preflightExistingNodeIdentities,
  walkSpecs,
  outermostNodes
} from './reconcile/nodes'
import {
  reconcilePageOperation,
  prepareResultPage,
  applyResultPage,
  applyPage
} from './reconcile/pages'
import {
  removeUpdateRoot,
  resolveRemovalNodes,
  loadRemovalPages,
  validateRemovalComponents,
  applyRemovals
} from './reconcile/removals'
import {
  preflightVectorPaths,
  preflightVariableModes,
  preflightResources,
  hasDeclaredResources,
  preflightDeclaredResources,
  prepareMedia,
  prepareResources,
  applyStyleResources,
  removeResources
} from './reconcile/resources'
import { boundedApplyResult, buildVerification } from './reconcile/results'
import { type SupportedCanvasNode, createApplyState } from './reconcile/state'
import {
  preflightMasks,
  preflightContainers,
  preflightMovedChildren
} from './reconcile/structure-preflight'
import { collectSvgColors, finalizeSvgPositions } from './reconcile/svg'
import { reconcileNode, applyCanvasKeyReferences } from './reconcile/tree'
import { withUndoBoundary } from './reconcile/undo'
import { preloadFirstPageModeFonts } from './reconcile/variable-modes'
import { verifyAppliedNode } from './reconcile/verification'
import {
  unboundCreatedResourceWarnings,
  authoredVariableFallbackWarnings,
  layoutWarnings
} from './reconcile/warnings'
export { collectUpdateNodeTypeHints } from './reconcile/nodes'

export async function reconcileCanvas(input: ParsedCanvasInput): Promise<ApplyCanvasResult> {
  if ('bindings' in input) return reconcileNativeUpdate(input)
  if (!('root' in input)) return reconcilePageOperation(input)
  if (input.root === null) return removeUpdateRoot(input.targetNodeId)

  const rootSpec = input.root
  let target: SupportedCanvasNode | null = null
  if (input.mode === 'update') {
    const candidate = await lookupNodeById(input.targetNodeId!)
    if (!isSupportedSceneNode(candidate)) {
      scopeError('The requested update target does not exist or is not a supported scene node.')
    }
    assertOutsideInstance(candidate)
    target = candidate
  }
  if (
    target &&
    rootSpec.type === 'FRAME' &&
    (target.type === 'COMPONENT' || target.type === 'COMPONENT_SET')
  ) {
    rootSpec.type = target.type
  }
  if (target && target.type !== rootSpec.type) {
    const recovery =
      rootSpec.type === 'INSTANCE'
        ? ' A keyed update root cannot become an instance in place. Update a bounded ancestor instead, give the instance a new key, and remove the old keyed node in the same ancestor update.'
        : ' A keyed update root cannot change type in place. Update a bounded ancestor instead, give the replacement a new key, and remove the old keyed node in the same ancestor update.'
    specError(
      `The update root expects ${rootSpec.type}, but target "${target.id}" is ${target.type}.${recovery}`
    )
  }
  const assets = await resolveCanvasAssets(input.assets, collectSvgColors(rootSpec))
  const state = createApplyState(target, collectDesiredKeys(rootSpec), assets)
  const resultPage = await prepareResultPage(input.page, target)
  const removalNodes = resolveRemovalNodes(input, state)
  await resolveExplicitNodes(rootSpec, state)
  preflightExistingNodeIdentities(rootSpec, state, target)
  preflightMasks(rootSpec, state, target)
  preflightContainers(rootSpec, state, target)
  preflightMovedChildren(rootSpec, state)
  for (const spec of walkSpecs(rootSpec)) preflightVectorPaths(spec)
  await loadRemovalPages(removalNodes)
  await validateRemovalComponents(outermostNodes(removalNodes))
  const preflight = async (): Promise<void> => {
    await preflightVariableModes(input.page?.variableModes, state)
    await preflightResources(rootSpec, state, target ?? undefined)
  }
  const declaresResources = hasDeclaredResources(input)
  if (declaresResources) await preflightDeclaredResources(walkSpecs(rootSpec), input, state)
  if (!declaresResources) {
    await preflight()
    if (resultPage) await preloadFirstPageModeFonts(resultPage, input.page?.variableModes, state)
  }
  await prepareMedia(walkSpecs(rootSpec), input, state)

  return withUndoBoundary(async () => {
    const page = applyResultPage(resultPage, input.page, state)
    if (declaresResources) {
      await prepareResources(input, state)
      await preflight()
    }
    applyStyleResources(state)
    if (input.page) await applyPage(page, input.page, state)
    const destination =
      input.mode === 'create' && page.id !== figma.currentPage.id ? page : undefined
    const root = await reconcileNode(
      rootSpec,
      state,
      destination,
      destination?.children.length ?? 0,
      target ?? undefined
    )
    await applyCanvasKeyReferences(rootSpec, state)
    if (input.mode === 'create') {
      placeCreatedRoot(root, page, state)
    }
    applyMask(root, rootSpec, state)
    const removedNodeIds = await applyRemovals(removalNodes, state)
    finalizeGridsAfterRemovals(rootSpec, state)
    finalizeAbsolutePositions(rootSpec, state)
    finalizeSvgPositions(walkSpecs(rootSpec), state)
    await removeResources(state)
    const verified = await verifyAppliedNode(rootSpec, root, state)
    const warnings = [
      ...unboundCreatedResourceWarnings(
        [rootSpec, input.styles, input.variableCollections, input.page],
        state
      ),
      ...authoredVariableFallbackWarnings(walkSpecs(rootSpec), input.variableCollections),
      ...layoutWarnings([rootSpec], state)
    ]
    return boundedApplyResult({
      rootNodeId: root.id,
      nodeIdsByKey: state.nodeIdsByKey,
      createdNodeIds: [...state.createdNodeIds],
      updatedNodeIds: [...state.updatedNodeIds],
      removedNodeIds,
      page: pageSnapshot(page),
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
