import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { createCodedError } from '../../../errors'
import { SVG_POLICY_VERSION, resolvedSvgAsset } from '../assets'
import { specError } from '../errors'
import { CANVAS_KEY_NAMESPACE } from '../identity'
import { walkSpecs } from './nodes'
import { type ApplyState, markMutation, type SupportedCanvasNode } from './state'

const CANVAS_SVG_CHILD_NAME = 'svg-child'

export const CANVAS_SVG_COLOR_NAME = 'svg-color'

export const CANVAS_SVG_DIGEST_NAME = 'svg-digest'

export const CANVAS_SVG_POLICY_NAME = 'svg-policy'

export function isOwnedSvgChild(node: SceneNode): node is FrameNode {
  return (
    node.type === 'FRAME' &&
    node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_CHILD_NAME) === 'true'
  )
}

function countSceneNodes(node: SceneNode): number {
  return (
    1 +
    ('children' in node
      ? node.children.reduce((count, child) => count + countSceneNodes(child), 0)
      : 0)
  )
}

function placeSvgChild(child: FrameNode, wrapper: FrameNode, state: ApplyState): void {
  if (
    ![child.width, child.height, wrapper.width, wrapper.height].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_IMPORT_FAILED,
      'SVG import produced invalid geometry.'
    )
  }
  const scale = Math.min(wrapper.width / child.width, wrapper.height / child.height)
  let changed = false
  if (Math.abs(scale - 1) > 0.0001) {
    child.rescale(scale)
    changed = true
  }
  const x = (wrapper.width - child.width) / 2
  const y = (wrapper.height - child.height) / 2
  if (Math.abs(child.x - x) > 0.001 || Math.abs(child.y - y) > 0.001) {
    child.x = x
    child.y = y
    changed = true
  }
  if (changed) state.mutations.count += 1
}

export function finalizeSvgPositions(specs: Iterable<CanvasNodeSpec>, state: ApplyState): void {
  for (const spec of specs) {
    if (!spec.figma?.svg) continue
    const wrapper = state.keyedNodes.get(spec.key)
    if (wrapper?.type !== 'FRAME') continue
    for (const child of wrapper.children) {
      if (isOwnedSvgChild(child)) placeSvgChild(child, wrapper, state)
    }
  }
}

function setSvgMetadata(
  wrapper: FrameNode,
  digest: string,
  color: string | undefined,
  state: ApplyState
): void {
  let changed = false
  for (const [name, value] of [
    [CANVAS_SVG_DIGEST_NAME, digest],
    [CANVAS_SVG_COLOR_NAME, color?.toUpperCase() ?? ''],
    [CANVAS_SVG_POLICY_NAME, SVG_POLICY_VERSION]
  ] as const) {
    if (wrapper.getSharedPluginData(CANVAS_KEY_NAMESPACE, name) === value) continue
    wrapper.setSharedPluginData(CANVAS_KEY_NAMESPACE, name, value)
    changed = true
  }
  if (changed) markMutation(state, wrapper)
}

export async function applySvg(
  node: SupportedCanvasNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const placement = spec.figma?.svg
  if (!placement) return
  if (node.type !== 'FRAME') {
    specError(`SVG binding "${spec.key}" requires a frame wrapper.`)
  }
  const asset = resolvedSvgAsset(state.media.assets, placement.assetKey, placement.color)
  if (!asset) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
      `SVG asset "${placement.assetKey}" was not resolved.`
    )
  }
  const owned = node.children.filter(isOwnedSvgChild)
  const unexpected = node.children.filter((child) => !isOwnedSvgChild(child))
  if (owned.length > 1 || unexpected.length) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_WRAPPER_DIRTY,
      `SVG wrapper "${spec.key}" contains unexpected children.`
    )
  }
  if (
    owned.length === 1 &&
    node.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_DIGEST_NAME) === asset.digest
  ) {
    placeSvgChild(owned[0]!, node, state)
    setSvgMetadata(node, asset.digest, placement.color, state)
    return
  }

  let imported: FrameNode
  try {
    imported = figma.createNodeFromSvg(asset.svg)
  } catch {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_IMPORT_FAILED,
      `SVG asset "${placement.assetKey}" could not be imported by Figma.`
    )
  }
  if (
    !Number.isFinite(imported.width) ||
    !Number.isFinite(imported.height) ||
    imported.width <= 0 ||
    imported.height <= 0 ||
    countSceneNodes(imported) > 500
  ) {
    imported.remove()
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.SVG_IMPORT_FAILED,
      `SVG asset "${placement.assetKey}" produced invalid or excessive Figma layers.`
    )
  }
  imported.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_SVG_CHILD_NAME, 'true')
  node.appendChild(imported)
  markMutation(state, node)
  placeSvgChild(imported, node, state)
  for (const child of owned) {
    child.remove()
    state.mutations.count += 1
  }
  setSvgMetadata(node, asset.digest, placement.color, state)
}

export function collectSvgColorsFromSpecs(
  specs: Iterable<CanvasNodeSpec>
): Map<string, Set<string | undefined>> {
  const colors = new Map<string, Set<string | undefined>>()
  for (const spec of specs) {
    const svg = spec.figma?.svg
    if (svg) {
      const values = colors.get(svg.assetKey) ?? new Set<string | undefined>()
      values.add(svg.color)
      colors.set(svg.assetKey, values)
    }
  }
  return colors
}

export function collectSvgColors(root: CanvasNodeSpec): Map<string, Set<string | undefined>> {
  return collectSvgColorsFromSpecs(walkSpecs(root))
}
