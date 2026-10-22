import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import type { ProtectedNodeSnapshot, ApplyState } from './state'

import { createCodedError } from '../../../errors'
import { canvasReadOnlyError, errorMessage } from '../errors'
import {
  CANVAS_KEY_NAMESPACE,
  CANVAS_PAGE_KEY_NAME,
  CANVAS_NODE_KEY_NAME,
  CANVAS_NODE_OWNER_NAME,
  pageById
} from '../identity'
import { isComponentPropertyOwner, walkAuthoringNodes } from '../traversal'
import { nativeValueEqual } from './comparison'
import {
  isSceneNode,
  lookupNodeById,
  isSupportedSceneNode,
  outermostNodes,
  containingPage
} from './nodes'
import {
  snapshotDeclaredResources,
  hasResourceChange,
  verifyResourceRollback,
  createdResourceChecks
} from './undo-resources'

function snapshotProtectedNode(node: BaseNode, captureTextRanges = true): ProtectedNodeSnapshot {
  let textSegments: string | undefined
  if (node.type === 'TEXT' && captureTextRanges) {
    try {
      textSegments = JSON.stringify(
        node.getStyledTextSegments([
          'fontName',
          'fontSize',
          'lineHeight',
          'letterSpacing',
          'paragraphIndent',
          'paragraphSpacing',
          'listSpacing',
          'indentation',
          'listOptions',
          'textStyleId',
          'fillStyleId',
          'fills',
          'boundVariables',
          'textStyleOverrides',
          'hyperlink',
          'textCase',
          'textDecoration',
          'textDecorationStyle',
          'textDecorationOffset',
          'textDecorationThickness',
          'textDecorationColor',
          'textDecorationSkipInk',
          'textWrapStyle',
          'openTypeFeatures'
        ])
      )
    } catch {
      // Some referenced text cannot expose its ranges. The other fields remain usable.
    }
  }
  return {
    // Serialize copied native values so a later in-place paint change cannot also
    // mutate the expected snapshot. This detects content loss, not a full undo log.
    content: JSON.stringify({
      name: node.name,
      ...(node.type === 'PAGE'
        ? {
            backgrounds: node.backgrounds,
            index: figma.root.children.indexOf(node)
          }
        : {}),
      ...('visible' in node ? { visible: node.visible, locked: node.locked } : {}),
      ...('fills' in node
        ? {
            fills: node.fills,
            ...('fillStyleId' in node ? { fillStyleId: node.fillStyleId } : {})
          }
        : {}),
      ...('strokes' in node ? { strokes: node.strokes, strokeStyleId: node.strokeStyleId } : {}),
      ...('effects' in node ? { effects: node.effects, effectStyleId: node.effectStyleId } : {}),
      ...('opacity' in node ? { opacity: node.opacity } : {}),
      ...('boundVariables' in node ? { boundVariables: node.boundVariables } : {}),
      ...('explicitVariableModes' in node
        ? { explicitVariableModes: node.explicitVariableModes }
        : {}),
      ...('componentPropertyReferences' in node
        ? { componentPropertyReferences: node.componentPropertyReferences }
        : {}),
      ...('constraints' in node ? { constraints: node.constraints } : {}),
      ...('blendMode' in node ? { blendMode: node.blendMode } : {}),
      ...('isMask' in node ? { isMask: node.isMask, maskType: node.maskType } : {}),
      ...('strokeWeight' in node
        ? {
            strokeWeight: node.strokeWeight,
            strokeAlign: node.strokeAlign,
            strokeJoin: node.strokeJoin,
            dashPattern: node.dashPattern
          }
        : {}),
      ...('strokeTopWeight' in node
        ? {
            strokeTopWeight: node.strokeTopWeight,
            strokeRightWeight: node.strokeRightWeight,
            strokeBottomWeight: node.strokeBottomWeight,
            strokeLeftWeight: node.strokeLeftWeight
          }
        : {}),
      ...('strokeCap' in node
        ? { strokeCap: node.strokeCap, strokeMiterLimit: node.strokeMiterLimit }
        : {}),
      ...('cornerRadius' in node ? { cornerRadius: node.cornerRadius } : {}),
      ...('cornerSmoothing' in node ? { cornerSmoothing: node.cornerSmoothing } : {}),
      ...('topLeftRadius' in node
        ? {
            topLeftRadius: node.topLeftRadius,
            topRightRadius: node.topRightRadius,
            bottomRightRadius: node.bottomRightRadius,
            bottomLeftRadius: node.bottomLeftRadius
          }
        : {}),
      ...('layoutGrids' in node
        ? { layoutGrids: node.layoutGrids, gridStyleId: node.gridStyleId }
        : {}),
      ...('guides' in node ? { guides: node.guides } : {}),
      ...('arcData' in node ? { arcData: node.arcData } : {}),
      ...('pointCount' in node ? { pointCount: node.pointCount } : {}),
      ...('innerRadius' in node ? { innerRadius: node.innerRadius } : {}),
      ...(node.type === 'VECTOR'
        ? {
            vectorPaths: node.vectorPaths,
            vectorNetwork: node.vectorNetwork,
            handleMirroring: node.handleMirroring
          }
        : {}),
      ...('descriptionMarkdown' in node
        ? {
            descriptionMarkdown: node.descriptionMarkdown,
            documentationLinks: node.documentationLinks
          }
        : {}),
      ...(isComponentPropertyOwner(node)
        ? { componentPropertyDefinitions: node.componentPropertyDefinitions }
        : {}),
      ...(node.type === 'INSTANCE'
        ? {
            componentProperties: node.componentProperties,
            scaleFactor: node.scaleFactor,
            isExposedInstance: node.isExposedInstance
          }
        : {}),
      ...('relativeTransform' in node ? { relativeTransform: node.relativeTransform } : {}),
      ...('clipsContent' in node ? { clipsContent: node.clipsContent } : {}),
      ...('minWidth' in node
        ? {
            minWidth: node.minWidth,
            maxWidth: node.maxWidth,
            minHeight: node.minHeight,
            maxHeight: node.maxHeight
          }
        : {}),
      ...('targetAspectRatio' in node ? { targetAspectRatio: node.targetAspectRatio } : {}),
      ...('layoutSizingHorizontal' in node
        ? {
            layoutSizingHorizontal: node.layoutSizingHorizontal,
            layoutSizingVertical: node.layoutSizingVertical
          }
        : {}),
      ...('layoutPositioning' in node
        ? { layoutPositioning: node.layoutPositioning, layoutGrow: node.layoutGrow }
        : {}),
      ...('layoutMode' in node
        ? {
            layoutMode: node.layoutMode,
            primaryAxisSizingMode: node.primaryAxisSizingMode,
            counterAxisSizingMode: node.counterAxisSizingMode,
            primaryAxisAlignItems: node.primaryAxisAlignItems,
            counterAxisAlignItems: node.counterAxisAlignItems,
            counterAxisAlignContent: node.counterAxisAlignContent,
            layoutWrap: node.layoutWrap,
            itemSpacing: node.itemSpacing,
            counterAxisSpacing: node.counterAxisSpacing,
            paddingTop: node.paddingTop,
            paddingRight: node.paddingRight,
            paddingBottom: node.paddingBottom,
            paddingLeft: node.paddingLeft,
            strokesIncludedInLayout: node.strokesIncludedInLayout,
            itemReverseZIndex: node.itemReverseZIndex,
            ...(node.layoutMode === 'GRID'
              ? {
                  gridRowCount: node.gridRowCount,
                  gridColumnCount: node.gridColumnCount,
                  gridRowSizes: node.gridRowSizes,
                  gridColumnSizes: node.gridColumnSizes,
                  gridRowGap: node.gridRowGap,
                  gridColumnGap: node.gridColumnGap,
                  gridAutoTracks: node.gridAutoTracks,
                  gridItemsPositioning: node.gridItemsPositioning
                }
              : {})
          }
        : {}),
      ...('gridRowAnchorIndex' in node &&
      node.parent &&
      'layoutMode' in node.parent &&
      node.parent.layoutMode === 'GRID'
        ? {
            gridRowAnchorIndex: node.gridRowAnchorIndex,
            gridColumnAnchorIndex: node.gridColumnAnchorIndex,
            gridRowSpan: node.gridRowSpan,
            gridColumnSpan: node.gridColumnSpan,
            gridChildHorizontalAlign: node.gridChildHorizontalAlign,
            gridChildVerticalAlign: node.gridChildVerticalAlign
          }
        : {}),
      ...(node.type === 'TEXT'
        ? {
            characters: node.characters,
            fontName: node.fontName,
            fontSize: node.fontSize,
            textStyleId: node.textStyleId,
            lineHeight: node.lineHeight,
            letterSpacing: node.letterSpacing,
            paragraphIndent: node.paragraphIndent,
            paragraphSpacing: node.paragraphSpacing,
            listSpacing: node.listSpacing,
            autoRename: node.autoRename,
            leadingTrim: node.leadingTrim,
            hangingPunctuation: node.hangingPunctuation,
            hangingList: node.hangingList,
            textAlignHorizontal: node.textAlignHorizontal,
            textAlignVertical: node.textAlignVertical,
            textAutoResize: node.textAutoResize,
            textTruncation: node.textTruncation,
            maxLines: node.maxLines
          }
        : {})
    }),
    childIds: 'children' in node ? node.children.map((child) => child.id) : null,
    componentPropertyNames: isComponentPropertyOwner(node)
      ? Object.keys(node.componentPropertyDefinitions).sort()
      : null,
    geometry: isSceneNode(node)
      ? { height: node.height, width: node.width, x: node.x, y: node.y }
      : null,
    key: node.getSharedPluginData(
      CANVAS_KEY_NAMESPACE,
      node.type === 'PAGE' ? CANVAS_PAGE_KEY_NAME : CANVAS_NODE_KEY_NAME
    ),
    owner: node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_OWNER_NAME),
    parentId: node.parent?.id ?? null,
    type: node.type,
    ...(textSegments === undefined ? {} : { textSegments })
  }
}

function matchesProtectedNode(node: BaseNode, expected: ProtectedNodeSnapshot): boolean {
  const actual = snapshotProtectedNode(node, expected.textSegments !== undefined)
  if (expected.textSegments !== undefined && actual.textSegments === undefined)
    throw new Error(`Text ranges on "${node.id}" are unavailable`)
  return nativeValueEqual(actual, expected)
}

export function protectNode(state: ApplyState, node: BaseNode): void {
  if (state.createdNodeIds.has(node.id) || state.createdPageIds.has(node.id)) return
  if (state.protectedNodes.has(node.id)) return
  state.protectedNodes.set(node.id, {
    node,
    ...(state.undoStarted ? { snapshot: snapshotProtectedNode(node) } : {})
  })
}

function topLevelPageChild(node: BaseNode, page: PageNode): BaseNode | null {
  let current: BaseNode | null = node
  while (current?.parent && current.parent.id !== page.id) current = current.parent
  return current?.parent?.id === page.id ? current : null
}

export function protectUnrelatedPageRoots(state: ApplyState, page: PageNode): void {
  const mutableRoot = state.scope ? topLevelPageChild(state.scope, page) : null
  for (const child of page.children) {
    if (child.id !== mutableRoot?.id) protectNode(state, child)
  }
}

async function verifyRollbackProtectedNodes(state: ApplyState): Promise<void> {
  const protectedEntries = [...state.protectedNodes]
  const protectedIds = protectedEntries.map(([id]) => id)
  const nodes = await Promise.all(
    protectedEntries.map(([id, { snapshot }]) =>
      snapshot?.type === 'PAGE' ? (pageById(id) ?? null) : lookupNodeById(id)
    )
  )
  const missing = protectedIds.filter((_, index) => !nodes[index])
  if (missing.length) {
    const shown = missing.slice(0, 8)
    const suffix = missing.length > shown.length ? ` and ${missing.length - shown.length} more` : ''
    throw new Error(
      `Rollback did not preserve pre-existing node${missing.length === 1 ? '' : 's'} ${shown.join(', ')}${suffix}`
    )
  }

  const changed = protectedEntries
    .filter(([, { snapshot: expected }], index) => {
      const node = nodes[index]
      return expected && node && !matchesProtectedNode(node, expected)
    })
    .map(([id]) => id)
  if (!changed.length) return
  const shown = changed.slice(0, 8)
  const suffix = changed.length > shown.length ? ` and ${changed.length - shown.length} more` : ''
  throw new Error(
    `Rollback changed pre-existing node${changed.length === 1 ? '' : 's'} ${shown.join(', ')}${suffix}`
  )
}

async function removeRollbackCreatedNodes(state: ApplyState): Promise<void> {
  const created = (
    await Promise.all([...state.createdNodeIds].map((id) => lookupNodeById(id)))
  ).filter(isSupportedSceneNode)
  if (!created.length) return

  for (const node of outermostNodes(created)) node.remove()

  const remaining = (
    await Promise.all([...state.createdNodeIds].map((id) => lookupNodeById(id)))
  ).filter(isSupportedSceneNode)
  if (!remaining.length) return
  const shown = remaining.slice(0, 8).map((node) => node.id)
  const suffix =
    remaining.length > shown.length ? ` and ${remaining.length - shown.length} more` : ''
  throw new Error(
    `Rollback did not remove created node${remaining.length === 1 ? '' : 's'} ${shown.join(', ')}${suffix}`
  )
}

async function removeRollbackCreatedPages(
  state: ApplyState,
  previousPage: PageNode
): Promise<void> {
  const created = figma.root.children.filter((page) => state.createdPageIds.has(page.id))
  if (state.createdPageIds.has(figma.currentPage.id) && !previousPage.removed) {
    await figma.setCurrentPageAsync(previousPage)
  }
  if (!created.length) return
  for (const page of created) {
    if (!page.removed) page.remove()
  }
  const remaining = figma.root.children.filter((page) => state.createdPageIds.has(page.id))
  if (remaining.length) {
    throw new Error(`Rollback did not remove created page ${remaining[0]!.id}`)
  }
}

async function hasRollbackChange(state: ApplyState): Promise<boolean> {
  const checks: Array<() => unknown | Promise<unknown>> = [
    ...[...state.createdPageIds].map((id) => () => {
      const page = pageById(id)
      return page && !page.removed
    }),
    ...[...state.createdNodeIds].map((id) => () => lookupNodeById(id)),
    ...createdResourceChecks(state).map((resource) => resource.exists),
    ...[...new Set([...state.updatedNodeIds, ...state.removalNodeIds])].map((id) => async () => {
      if (state.createdNodeIds.has(id) || state.createdPageIds.has(id)) return false
      const protectedNode = state.protectedNodes.get(id)
      if (!protectedNode?.snapshot) return false
      if (protectedNode.node.removed) return true
      const node = protectedNode.snapshot.type === 'PAGE' ? pageById(id) : await lookupNodeById(id)
      return node && !matchesProtectedNode(node, protectedNode.snapshot)
    })
  ]
  for (const check of checks) {
    try {
      if (await check()) return true
    } catch {
      // One unavailable read cannot invalidate independent retained-change evidence.
    }
  }
  return false
}

export async function withUndoBoundary<T>(apply: () => Promise<T>, state: ApplyState): Promise<T> {
  const previousPage = figma.currentPage
  let resourceSnapshots: ReturnType<typeof snapshotDeclaredResources> = []
  let applyStarted = false
  try {
    const mutableNodeIds = new Set(state.explicitNodes.keys())
    if (state.scope) {
      for (const node of walkAuthoringNodes([state.scope])) {
        mutableNodeIds.add(node.id)
        protectNode(state, node)
      }
      protectUnrelatedPageRoots(state, containingPage(state.scope))
    }
    // Preflight can yield for media/fonts while the user edits referenced nodes.
    // Freeze their baseline only when this attempt is about to start writing.
    for (const protectedNode of state.protectedNodes.values()) {
      protectedNode.snapshot = snapshotProtectedNode(
        protectedNode.node,
        mutableNodeIds.has(protectedNode.node.id)
      )
    }
    resourceSnapshots = snapshotDeclaredResources(state)
    state.undoStarted = true
    figma.commitUndo()
    applyStarted = true
    const result = await apply()
    figma.commitUndo()
    return result
  } catch (error) {
    const readOnly = canvasReadOnlyError(error)
    const original = readOnly ?? error
    const code = original instanceof Error && 'code' in original ? original.code : undefined
    const message = errorMessage(original, 'Canvas apply failed.')
    const diagnostic =
      typeof code === 'string' &&
      code !== TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED &&
      code !== TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED
        ? `${message} [${code}]`
        : message
    if (state.mutations.count > 0) {
      try {
        // Counted setters can be no-ops or cancel each other out. Undo would then
        // consume an earlier edit. Partial snapshots only justify an attempt when
        // they show a retained change; equality never certifies an unchanged canvas.
        if (
          !(await hasRollbackChange(state)) &&
          !(await hasResourceChange(resourceSnapshots, state))
        ) {
          throw new Error(
            'A distinct change for this attempt could not be confirmed; Undo was skipped',
            { cause: error }
          )
        }
        // Make this partial attempt the newest history entry before undoing. In a long-lived
        // plugin session, the preceding entry may be an earlier successful apply.
        figma.commitUndo()
        figma.triggerUndo()
        // Figma's undo boundary is authoritative for existing content and resources. Remove any
        // newly created nodes that remain visible after the undo so a failed apply cannot leave
        // partial component or screen roots behind in a long-lived MCP session.
        await removeRollbackCreatedNodes(state)
        await removeRollbackCreatedPages(state, previousPage)
        await verifyRollbackProtectedNodes(state)
        await verifyResourceRollback(resourceSnapshots, state)
      } catch (rollbackError) {
        const rollbackMessage = errorMessage(rollbackError)
        const detail = rollbackMessage ? ` ${rollbackMessage.replace(/\.$/, '')}.` : ''
        const failure = createCodedError(
          TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          `Canvas apply failed: ${diagnostic.replace(/\.$/, '')}; automatic rollback was not available.${detail} Read back the affected canvas before writing again. Inspect retained changes and repair only the affected scope; ask the user to inspect if the partial state is unclear. Do not use Undo without confirming which edit it would revert.`
        )
        failure.cause = error
        throw failure
      }
    }
    if (!applyStarted) {
      if (readOnly) throw readOnly
      if (error instanceof Error && 'code' in error) throw error
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
        errorMessage(error, 'Canvas apply failed.')
      )
    }
    if (error instanceof Error && code === TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED) throw error
    // A native setter can throw before mutation accounting, and protected snapshots
    // cover only part of document state. Neither zero writes nor a verified snapshot
    // proves that every native field or resource was restored.
    const failure = createCodedError(TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED, diagnostic)
    failure.cause = error
    throw failure
  }
}
