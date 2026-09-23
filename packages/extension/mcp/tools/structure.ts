import type {
  CanvasFigmaLayoutGrid,
  CanvasPageSnapshot,
  GetStructureResult,
  OutlineNativeProperties
} from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetStructureToolResult,
  measureCallToolResultBytes
} from '@tempad-dev/shared'

import { buildBoundedStructureOutline } from '@/mcp/semantic-tree'

import { readOwnedNodeKey } from './canvas/identity'

const STRUCTURE_NODE_LIMIT_STEPS = [240, 180, 140, 100, 70, 50] as const
const STRUCTURE_MAX_NAME_CHARS = 48
const STRUCTURE_COORD_PRECISION = 10

type StructureNode = GetStructureResult['roots'][number]

export function handleGetStructure(
  roots: SceneNode[],
  depthLimit?: number,
  includeNative = false,
  page?: CanvasPageSnapshot
): GetStructureResult {
  const {
    roots: outline,
    physicalNodes,
    observedNodes
  } = buildBoundedStructureOutline(roots, depthLimit, STRUCTURE_NODE_LIMIT_STEPS[0])
  const { authoringKeys, nativeById } = collectStructureMetadata(physicalNodes, includeNative)

  for (const nodeLimit of STRUCTURE_NODE_LIMIT_STEPS) {
    const candidate: GetStructureResult = {
      roots: compactByNodeLimit(outline, nodeLimit, authoringKeys, nativeById),
      ...(page ? { page } : {}),
      ...(observedNodes > nodeLimit ? { truncated: true } : {})
    }
    if (estimateToolResultBytes(candidate) <= MCP_TOOL_INLINE_BUDGET_BYTES) {
      return candidate
    }
    if (!outline.length) break
  }

  throw new Error(
    'Structure tool result exceeded the 64 KiB inline budget. Reduce selection or depth and retry.'
  )
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

function collectStructureMetadata(
  physicalNodes: SceneNode[],
  includeNative: boolean
): {
  authoringKeys: Map<string, string>
  nativeById: Map<string, OutlineNativeProperties>
} {
  const authoringKeys = new Map<string, string>()
  const nativeById = new Map<string, OutlineNativeProperties>()
  for (const node of physicalNodes) {
    const key = readOwnedNodeKey(node)
    if (key) authoringKeys.set(node.id, key)

    if (includeNative) {
      const native = describeNativeProperties(node)
      if (native) nativeById.set(node.id, native)
    }
  }

  return { authoringKeys, nativeById }
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
