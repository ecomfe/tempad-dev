import type { GetStructureResult } from '@tempad-dev/shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/shared'

import { buildSemanticTree, semanticTreeToOutline } from '@/mcp/semantic-tree'

const STRUCTURE_NODE_LIMIT_STEPS = [240, 180, 140, 100, 70, 50]
const STRUCTURE_TARGET_PAYLOAD_BYTES = Math.floor(MCP_MAX_PAYLOAD_BYTES * 0.15)
const STRUCTURE_MAX_NAME_CHARS = 48
const STRUCTURE_COORD_PRECISION = 10

type StructureNode = GetStructureResult['roots'][number]

export function handleGetStructure(roots: SceneNode[], depthLimit?: number): GetStructureResult {
  // Prefer semantic-tree suggested cap when no explicit depth provided.
  const resolvedDepthLimit = depthLimit || undefined
  const tree = buildSemanticTree(roots, { depthLimit: resolvedDepthLimit })
  const outline = semanticTreeToOutline(tree.roots)
  const compactRoots = compactStructure(outline)
  const payload = { roots: compactRoots }

  const approxSize = JSON.stringify(payload).length
  if (approxSize > MCP_MAX_PAYLOAD_BYTES) {
    throw new Error('Structure payload too large to return. Reduce selection or depth and retry.')
  }

  return payload
}

function compactStructure(roots: StructureNode[]): StructureNode[] {
  if (!roots.length) return roots

  let best = compactByNodeLimit(roots, STRUCTURE_NODE_LIMIT_STEPS[0])
  if (estimatePayloadBytes(best) <= STRUCTURE_TARGET_PAYLOAD_BYTES) {
    return best
  }

  for (const nodeLimit of STRUCTURE_NODE_LIMIT_STEPS.slice(1)) {
    const candidate = compactByNodeLimit(roots, nodeLimit)
    best = candidate
    if (estimatePayloadBytes(candidate) <= STRUCTURE_TARGET_PAYLOAD_BYTES) {
      return candidate
    }
  }

  return best
}

function compactByNodeLimit(roots: StructureNode[], nodeLimit: number): StructureNode[] {
  let seen = 0

  const visit = (node: StructureNode): StructureNode | undefined => {
    if (seen >= nodeLimit) return undefined
    seen += 1

    const compact: StructureNode = {
      id: sanitizeId(node.id, `node-${seen}`),
      name: sanitizeName(node.name),
      type: sanitizeType(node.type),
      x: sanitizeNumber(node.x),
      y: sanitizeNumber(node.y),
      width: sanitizeNumber(node.width),
      height: sanitizeNumber(node.height)
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

function estimatePayloadBytes(roots: StructureNode[]): number {
  return JSON.stringify({ roots }).length
}
