import type { GetStructureResult } from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetStructureToolResult,
  measureCallToolResultBytes
} from '@tempad-dev/shared'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'

import { CANVAS_NODE_KEY_NAME, readAuthoringKey } from './canvas/identity'

const STRUCTURE_NODE_LIMIT_STEPS = [240, 180, 140, 100, 70, 50] as const
const STRUCTURE_MAX_NAME_CHARS = 48
const STRUCTURE_COORD_PRECISION = 10

type StructureNode = GetStructureResult['roots'][number]

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  const tree = buildSemanticTree(roots, { depthLimit: depthLimit || undefined })
  const outline = semanticTreeToOutline(tree.roots)
  const authoringKeys = collectAuthoringKeys(roots, outline, STRUCTURE_NODE_LIMIT_STEPS[0])
  const compactRoots = compactStructure(outline, authoringKeys)
  if (!compactRoots.length && outline.length) {
    throw new Error(
      'Structure tool result exceeded the 64 KiB inline budget. Reduce selection or depth and retry.'
    )
  }

  return { roots: compactRoots }
}

function compactStructure(
  roots: StructureNode[],
  authoringKeys: ReadonlyMap<string, string>
): StructureNode[] {
  if (!roots.length) return roots

  const initial = compactByNodeLimit(roots, STRUCTURE_NODE_LIMIT_STEPS[0], authoringKeys)
  if (estimateToolResultBytes(initial) <= MCP_TOOL_INLINE_BUDGET_BYTES) {
    return initial
  }

  for (const nodeLimit of STRUCTURE_NODE_LIMIT_STEPS.slice(1)) {
    const candidate = compactByNodeLimit(roots, nodeLimit, authoringKeys)
    if (estimateToolResultBytes(candidate) <= MCP_TOOL_INLINE_BUDGET_BYTES) {
      return candidate
    }
  }

  return []
}

function compactByNodeLimit(
  roots: StructureNode[],
  nodeLimit: number,
  authoringKeys: ReadonlyMap<string, string>
): StructureNode[] {
  let seen = 0

  const visit = (node: StructureNode): StructureNode | undefined => {
    if (seen >= nodeLimit) return undefined
    seen += 1
    const authoringKey = authoringKeys.get(node.id)

    const compact: StructureNode = {
      id: sanitizeId(node.id, `node-${seen}`),
      name: sanitizeName(node.name),
      type: sanitizeType(node.type),
      x: sanitizeNumber(node.x),
      y: sanitizeNumber(node.y),
      width: sanitizeNumber(node.width),
      height: sanitizeNumber(node.height),
      ...(authoringKey ? { authoringKey } : {})
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

function collectAuthoringKeys(
  roots: SceneNode[],
  outline: StructureNode[],
  nodeLimit: number
): Map<string, string> {
  const keys = new Map<string, string>()
  const remaining = new Set<string>()

  const addIds = (nodes: StructureNode[]): boolean => {
    for (const node of nodes) {
      remaining.add(node.id)
      if (remaining.size >= nodeLimit || (node.children && addIds(node.children))) return true
    }
    return false
  }
  addIds(outline)
  if (!remaining.size) return keys

  const visit = (node: SceneNode): boolean => {
    if (remaining.delete(node.id)) {
      const key = readAuthoringKey(node, CANVAS_NODE_KEY_NAME)
      if (key) keys.set(node.id, key)
      if (!remaining.size) return true
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (child.visible && visit(child)) return true
      }
    }
    return false
  }

  for (const root of roots) {
    if (visit(root)) break
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

function estimateToolResultBytes(roots: StructureNode[]): number {
  return measureCallToolResultBytes(buildGetStructureToolResult({ roots }))
}
