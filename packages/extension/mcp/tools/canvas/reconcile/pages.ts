import type { CanvasPageProperties, ApplyCanvasResult } from '@tempad-dev/shared'

import type { ParsedCanvasPageInput } from '../model'

import { specError, scopeError, applyError } from '../errors'
import {
  pageById,
  CANVAS_KEY_NAMESPACE,
  CANVAS_PAGE_KEY_NAME,
  readOwnedNodeKey,
  pageSnapshot
} from '../identity'
import { walkPhysicalNodes } from '../traversal'
import { applyGuides } from './appearance'
import { paintStacksEqual } from './native-values'
import {
  containingPage,
  pageByKey,
  lookupNodeById,
  isSceneNode,
  isSupportedSceneNode
} from './nodes'
import {
  walkRemovalOwnershipNodes,
  validateRemovalAncestors,
  validateRemovalOwnership,
  validateRemovalComponents,
  validateRemovalReferences
} from './removals'
import { preflightVariableModes } from './resources'
import { pageApplyResult, boundedApplyResult, buildVerification } from './results'
import {
  type SupportedCanvasNode,
  type ApplyState,
  markMutation,
  moveIntoParent,
  setValue,
  createApplyState
} from './state'
import { protectNode, protectUnrelatedPageRoots, withUndoBoundary } from './undo'
import { applyVariableModes, preloadFirstPageModeFonts } from './variable-modes'

export async function prepareResultPage(
  properties: CanvasPageProperties | undefined,
  target: SupportedCanvasNode | null
): Promise<PageNode | undefined> {
  const containing = target ? containingPage(target) : figma.currentPage
  const id = properties?.id
  const key = properties?.pageKey
  const explicit = id ? pageById(id) : undefined
  if (id && !explicit) specError(`Page "${id}" does not exist.`)
  const keyed = key ? pageByKey(key) : undefined
  if (explicit && keyed && explicit.id !== keyed.id) {
    specError(`Page key "${key}" does not identify "${explicit.id}".`)
  }

  let page = explicit ?? keyed
  if (target) {
    if (page && page.id !== containing.id) {
      scopeError(`The update target belongs to page "${containing.id}", not "${page.id}".`)
    }
    page = containing
  }
  const createsPage = !page && key !== undefined
  if (createsPage && properties?.name === undefined) {
    specError(`New page "${key}" requires a name.`)
  }
  const index = properties?.index
  const maxIndex = figma.root.children.length - (createsPage ? 0 : 1)
  if (index !== undefined && index > maxIndex) {
    specError(`Page index ${index} exceeds the maximum index ${maxIndex}.`)
  }
  if (createsPage) return undefined
  page ??= containing
  if (page.id !== figma.currentPage.id) await page.loadAsync()
  const currentKey = key ? page.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME) : ''
  if (key && currentKey && currentKey !== key) {
    specError(`Page "${page.id}" is already owned by authoring key "${currentKey}".`)
  }
  return page
}

export function applyResultPage(
  page: PageNode | undefined,
  properties: CanvasPageProperties | undefined,
  state: ApplyState
): PageNode {
  if (!page) {
    page = figma.createPage()
    state.createdPageIds.add(page.id)
    state.mutations.count += 1
  } else {
    protectNode(state, page)
    if (!state.scope) protectUnrelatedPageRoots(state, page)
  }
  const key = properties?.pageKey
  const currentKey = key ? page.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME) : ''
  // Other preflight work can yield after the page was prepared.
  if (key && currentKey && currentKey !== key) {
    specError(`Page "${page.id}" is already owned by authoring key "${currentKey}".`)
  }
  if (key && !currentKey) {
    page.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME, key)
    markMutation(state, page)
  }
  return page
}

export async function applyPage(
  page: PageNode,
  properties: CanvasPageProperties,
  state: ApplyState
): Promise<void> {
  protectNode(state, page)
  if (properties.index !== undefined) {
    moveIntoParent(page, figma.root, properties.index, state)
  }
  setValue(page, page.name, properties.name, (value) => (page.name = value), state)
  if (properties.background) {
    const { a: opacity, ...color } = properties.background
    const background: SolidPaint[] = [{ type: 'SOLID', color, opacity }]
    if (!paintStacksEqual(page.backgrounds, background)) {
      page.backgrounds = background
      markMutation(state, page)
    }
  }
  applyGuides(page, properties.guides, state)
  await applyVariableModes(page, properties.variableModes, state)
}

async function resolveExactPage(properties: CanvasPageProperties): Promise<PageNode> {
  const explicit = properties.id ? pageById(properties.id) : undefined
  if (properties.id && !explicit) specError(`Page "${properties.id}" does not exist.`)
  const keyed = properties.pageKey ? pageByKey(properties.pageKey) : undefined
  if (properties.pageKey && !keyed) {
    specError(`Page key "${properties.pageKey}" does not identify a local page.`)
  }
  if (explicit && keyed && explicit.id !== keyed.id) {
    specError(`Page key "${properties.pageKey}" does not identify "${explicit.id}".`)
  }
  const page = explicit ?? keyed
  if (!page) specError('An exact page id or pageKey is required.')
  if (page.id !== figma.currentPage.id) await page.loadAsync()
  return page
}

async function resolvePageSelection(page: PageNode, ids: string[]): Promise<SceneNode[]> {
  const nodes: SceneNode[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) specError(`Selection node "${id}" is duplicated.`)
    seen.add(id)
    const node = await lookupNodeById(id)
    if (!isSceneNode(node) || node.removed || !node.visible) {
      scopeError(`Selection node "${id}" does not exist, is hidden, or is not a scene node.`)
    }
    if (containingPage(node).id !== page.id) {
      scopeError(`Selection node "${id}" does not belong to page "${page.id}".`)
    }
    nodes.push(node)
  }
  return nodes
}

function collectPageRemovalRoots(page: PageNode, state: ApplyState): SupportedCanvasNode[] {
  const roots: SupportedCanvasNode[] = []
  for (const child of page.children) {
    if (!isSupportedSceneNode(child)) {
      scopeError(`Page "${page.id}" contains an unsupported canvas root.`)
    }
    roots.push(child)
    for (const node of walkRemovalOwnershipNodes([child], state)) {
      if (!isSupportedSceneNode(node)) {
        scopeError(`Page "${page.id}" contains an unsupported canvas node.`)
      }
      const key = readOwnedNodeKey(node)
      if (!key) {
        scopeError(`Page "${page.id}" contains content not owned by apply_canvas.`)
      }
      const existing = state.keyedNodes.get(key)
      if (existing && existing.id !== node.id) {
        scopeError(`Canvas key "${key}" is duplicated on page "${page.id}".`)
      }
      state.keyedNodes.set(key, node)
    }
  }
  for (const root of roots) {
    validateRemovalAncestors(root)
    validateRemovalOwnership(root, state)
  }
  return roots
}

async function createPageOnly(input: ParsedCanvasPageInput): Promise<ApplyCanvasResult> {
  if (pageByKey(input.page.pageKey!)) {
    specError(`Page key "${input.page.pageKey}" already identifies a local page.`)
  }
  const state = createApplyState(null, new Set())
  const preparedPage = await prepareResultPage(input.page, null)
  if (preparedPage) specError('Page-only create requires a new pageKey.')
  await preflightVariableModes(input.page.variableModes, state)
  return withUndoBoundary(async () => {
    const page = applyResultPage(preparedPage, input.page, state)
    await applyPage(page, input.page, state)
    page.selection = []
    if (page.selection.length !== 0) {
      applyError(`Verification failed: page "${page.id}" does not have an empty selection.`)
    }
    return pageApplyResult(pageSnapshot(page), state)
  }, state)
}

async function updatePageOnly(input: ParsedCanvasPageInput): Promise<ApplyCanvasResult> {
  const page = await resolveExactPage(input.page)
  const state = createApplyState(null, new Set())
  await preflightVariableModes(input.page.variableModes, state)
  await preloadFirstPageModeFonts(page, input.page.variableModes, state)
  return withUndoBoundary(async () => {
    protectUnrelatedPageRoots(state, page)
    await applyPage(page, input.page, state)
    return pageApplyResult(pageSnapshot(page), state)
  }, state)
}

async function activatePage(input: ParsedCanvasPageInput): Promise<ApplyCanvasResult> {
  const page = await resolveExactPage(input.page)
  const selection =
    input.selection === undefined ? undefined : await resolvePageSelection(page, input.selection)
  await figma.setCurrentPageAsync(page)
  if (selection) page.selection = selection
  if (figma.currentPage.id !== page.id) {
    applyError(`Verification failed: page "${page.id}" is not active.`)
  }
  if (
    selection &&
    (page.selection.length !== selection.length ||
      page.selection.some((node, index) => node.id !== selection[index]?.id))
  ) {
    applyError(`Verification failed: page "${page.id}" selection does not match.`)
  }
  return pageApplyResult(pageSnapshot(page), createApplyState(null, new Set()))
}

async function removePage(input: ParsedCanvasPageInput): Promise<ApplyCanvasResult> {
  const page = await resolveExactPage(input.page)
  const ownedKey = page.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME)
  if (!ownedKey || ownedKey !== input.page.pageKey) {
    scopeError(`Page "${page.id}" is not owned by pageKey "${input.page.pageKey}".`)
  }
  if (figma.root.children.length <= 1) {
    scopeError('The last Figma page cannot be removed.')
  }
  const state = createApplyState(null, new Set())
  const roots = collectPageRemovalRoots(page, state)
  await validateRemovalComponents(roots)
  await validateRemovalReferences(roots, state)
  const previousPage = figma.currentPage
  const fallback = figma.root.children.find((candidate) => candidate.id !== page.id)!
  const snapshot = pageSnapshot(page, { active: false, removed: true, selectionCount: 0 })
  const removedNodeIds = roots.flatMap((root) =>
    [...walkPhysicalNodes([root])].map((node) => node.id)
  )

  try {
    return await withUndoBoundary(async () => {
      protectNode(state, page)
      if (figma.currentPage.id === page.id) await figma.setCurrentPageAsync(fallback)
      page.remove()
      state.mutations.count += 1
      if (figma.root.children.some((candidate) => candidate.id === page.id)) {
        applyError(`Verification failed: page "${page.id}" is still present.`)
      }
      return boundedApplyResult({
        nodeIdsByKey: {},
        createdNodeIds: [],
        updatedNodeIds: [],
        removedNodeIds,
        page: snapshot,
        mutationCount: state.mutations.count,
        verification: buildVerification()
      })
    }, state)
  } catch (error) {
    if (!previousPage.removed && figma.currentPage.id !== previousPage.id) {
      try {
        await figma.setCurrentPageAsync(previousPage)
      } catch {
        // Preserve the apply error; rollback state remains authoritative.
      }
    }
    throw error
  }
}

export async function reconcilePageOperation(
  input: ParsedCanvasPageInput
): Promise<ApplyCanvasResult> {
  if (input.mode === 'create') return createPageOnly(input)
  if (input.mode === 'update') return updatePageOnly(input)
  if (input.mode === 'remove') return removePage(input)
  return activatePage(input)
}
