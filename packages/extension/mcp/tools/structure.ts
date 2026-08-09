import type {
  CanvasFigmaLayoutGrid,
  GetStructureResult,
  OutlineNativeProperties
} from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetStructureToolResult,
  measureCallToolResultBytes
} from '@tempad-dev/shared'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'

import { readOwnedNodeKey } from './canvas/identity'
import { walkPhysicalNodes } from './canvas/traversal'

const STRUCTURE_NODE_LIMIT_STEPS = [240, 180, 140, 100, 70, 50] as const
const STRUCTURE_MAX_NAME_CHARS = 48
const STRUCTURE_COORD_PRECISION = 10

type StructureNode = GetStructureResult['roots'][number]

export function handleGetStructure(
  roots: SceneNode[],
  depthLimit?: number,
  includeNative = false
): GetStructureResult {
  const tree = buildSemanticTree(roots, { depthLimit: depthLimit || undefined })
  const outline = semanticTreeToOutline(tree.roots)
  const authoringKeys = collectAuthoringKeys(roots, outline, STRUCTURE_NODE_LIMIT_STEPS[0])
  const nativeById = includeNative
    ? collectNativeProperties(roots, outline, STRUCTURE_NODE_LIMIT_STEPS[0])
    : new Map<string, OutlineNativeProperties>()
  const compact = compactStructure(outline, authoringKeys, nativeById)
  if (!compact.roots.length && outline.length) {
    throw new Error(
      'Structure tool result exceeded the 64 KiB inline budget. Reduce selection or depth and retry.'
    )
  }

  return compact
}

function compactStructure(
  roots: StructureNode[],
  authoringKeys: ReadonlyMap<string, string>,
  nativeById: ReadonlyMap<string, OutlineNativeProperties>
): GetStructureResult {
  if (!roots.length) return { roots }

  const totalNodes = countStructureNodes(roots)
  const result = (compactRoots: StructureNode[]): GetStructureResult => ({
    roots: compactRoots,
    ...(countStructureNodes(compactRoots) < totalNodes ? { truncated: true as const } : {})
  })

  const initial = compactByNodeLimit(
    roots,
    STRUCTURE_NODE_LIMIT_STEPS[0],
    authoringKeys,
    nativeById
  )
  if (estimateToolResultBytes(result(initial)) <= MCP_TOOL_INLINE_BUDGET_BYTES) {
    return result(initial)
  }

  for (const nodeLimit of STRUCTURE_NODE_LIMIT_STEPS.slice(1)) {
    const candidate = compactByNodeLimit(roots, nodeLimit, authoringKeys, nativeById)
    if (estimateToolResultBytes(result(candidate)) <= MCP_TOOL_INLINE_BUDGET_BYTES) {
      return result(candidate)
    }
  }

  return { roots: [], truncated: true }
}

function countStructureNodes(roots: StructureNode[]): number {
  let count = 0
  const pending = [...roots]
  while (pending.length) {
    const node = pending.pop()!
    count += 1
    if (node.children) pending.push(...node.children)
  }
  return count
}

function compactByNodeLimit(
  roots: StructureNode[],
  nodeLimit: number,
  authoringKeys: ReadonlyMap<string, string>,
  nativeById: ReadonlyMap<string, OutlineNativeProperties>
): StructureNode[] {
  let seen = 0

  const visit = (node: StructureNode): StructureNode | undefined => {
    if (seen >= nodeLimit) return undefined
    seen += 1
    const authoringKey = authoringKeys.get(node.id)
    const native = nativeById.get(node.id)

    const compact: StructureNode = {
      id: sanitizeId(node.id, `node-${seen}`),
      name: sanitizeName(node.name),
      type: sanitizeType(node.type),
      x: sanitizeNumber(node.x),
      y: sanitizeNumber(node.y),
      width: sanitizeNumber(node.width),
      height: sanitizeNumber(node.height),
      ...(authoringKey ? { authoringKey } : {}),
      ...(native ? { native } : {})
    }

    if (Array.isArray(node.children) && node.children.length && seen < nodeLimit) {
      const children: StructureNode[] = []
      for (const child of node.children) {
        const compactChild = visit(child)
        if (!compactChild) break
        children.push(compactChild)
      }
      if (children.length) compact.children = children
    }

    return compact
  }

  const compactRoots: StructureNode[] = []
  for (const root of roots) {
    const compactRoot = visit(root)
    if (!compactRoot) break
    compactRoots.push(compactRoot)
  }
  return compactRoots
}

function collectNativeProperties(
  roots: SceneNode[],
  outline: StructureNode[],
  nodeLimit: number
): Map<string, OutlineNativeProperties> {
  const properties = new Map<string, OutlineNativeProperties>()
  const remaining = collectOutlineIds(outline, nodeLimit)

  for (const node of walkPhysicalNodes(roots)) {
    if (!remaining.delete(node.id)) continue
    const native = describeNativeProperties(node)
    if (native) properties.set(node.id, native)
    if (!remaining.size) break
  }

  return properties
}

function describeNativeProperties(node: SceneNode): OutlineNativeProperties | undefined {
  const native: OutlineNativeProperties = {}

  if ('isMask' in node && node.isMask && 'maskType' in node) {
    native.mask = node.maskType
  }

  if ('fills' in node && Array.isArray(node.fills)) {
    const imageFills = node.fills
      .filter((fill): fill is ImagePaint => fill.type === 'IMAGE')
      .map((fill) => ({
        imageHash: fill.imageHash,
        scaleMode: fill.scaleMode,
        visible: fill.visible ?? true,
        opacity: fill.opacity ?? 1
      }))
    if (imageFills.length) native.imageFills = imageFills
  }

  if ('layoutGrids' in node && Array.isArray(node.layoutGrids) && node.layoutGrids.length) {
    native.layoutGrids = node.layoutGrids.map(describeLayoutGrid)
  }

  if ('guides' in node && Array.isArray(node.guides) && node.guides.length) {
    native.guides = node.guides.map(({ axis, offset }) => ({ axis, offset }))
  }

  return Object.keys(native).length ? native : undefined
}

function describeLayoutGrid(grid: LayoutGrid): CanvasFigmaLayoutGrid {
  const { boundVariables, ...fields } = grid
  const variableEntries = Object.entries(boundVariables ?? {}).flatMap(([field, variable]) =>
    variable ? [[field, { id: variable.id }] as const] : []
  )
  const variables = variableEntries.length ? Object.fromEntries(variableEntries) : undefined

  return {
    ...fields,
    ...(grid.pattern === 'GRID'
      ? {}
      : {
          count: grid.count === Infinity ? ('AUTO' as const) : grid.count
        }),
    ...(variables ? { variables } : {})
  } as CanvasFigmaLayoutGrid
}

function collectOutlineIds(outline: StructureNode[], nodeLimit: number): Set<string> {
  const ids = new Set<string>()

  const addIds = (nodes: StructureNode[]): boolean => {
    for (const node of nodes) {
      ids.add(node.id)
      if (ids.size >= nodeLimit || (node.children && addIds(node.children))) return true
    }
    return false
  }

  addIds(outline)
  return ids
}

function collectAuthoringKeys(
  roots: SceneNode[],
  outline: StructureNode[],
  nodeLimit: number
): Map<string, string> {
  const keys = new Map<string, string>()
  const remaining = collectOutlineIds(outline, nodeLimit)
  if (!remaining.size) return keys

  for (const node of walkPhysicalNodes(roots)) {
    if (!remaining.delete(node.id)) continue
    const key = readOwnedNodeKey(node)
    if (key) keys.set(node.id, key)
    if (!remaining.size) break
  }
  return keys
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= STRUCTURE_MAX_NAME_CHARS) return normalized
  return `${normalized.slice(0, Math.max(0, STRUCTURE_MAX_NAME_CHARS - 3))}...`
}

function sanitizeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function sanitizeType(value: unknown): string {
  if (typeof value !== 'string') return 'UNKNOWN'
  const trimmed = value.trim()
  return trimmed || 'UNKNOWN'
}

function sanitizeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.round(value * STRUCTURE_COORD_PRECISION) / STRUCTURE_COORD_PRECISION
}

function estimateToolResultBytes(result: GetStructureResult): number {
  return measureCallToolResultBytes(buildGetStructureToolResult(result))
}
