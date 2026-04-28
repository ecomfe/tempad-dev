import type { FigmaLookupReaders } from '@/utils/figma-style/types'

import { canonicalizeVarName, normalizeFigmaVarName, toFigmaVarExpr } from '@/utils/css'
import { collectNodeVariableIdsInto, getVariableRawName } from '@/utils/figma-variables'
import { logger } from '@/utils/log'

import { getVariableByIdCached } from './cache'

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id: string) => figma.getStyleById(id),
  getVariableById: (id: string) => figma.variables.getVariableById(id)
}

export type CandidateResult = {
  variableIds: Set<string>
  rewrites: Map<string, { canonical: string; id: string }>
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

export function collectCandidateVariableIds(
  roots: SceneNode[],
  cache?: Map<string, Variable | null>,
  readers: FigmaLookupReaders = DEFAULT_READERS
): CandidateResult {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = now()
  const variableIds = new Set<string>()
  const rewrites = new Map<string, { canonical: string; id: string }>()

  const visit = (node: SceneNode) => {
    collectNodeVariableIdsInto(node, variableIds, readers)

    if (hasChildren(node)) {
      node.children.forEach((child) => {
        if (child.visible) visit(child)
      })
    }
  }

  roots.forEach((root) => {
    if (root.visible) visit(root)
  })

  const scannedAt = now()

  // Build lookup tables based on collected ids.
  for (const id of variableIds) {
    const v = getVariableByIdCached(id, cache)
    if (!v) continue

    const canonical = normalizeFigmaVarName(getVariableRawName(v))

    const cs = v.codeSyntax?.WEB?.trim()
    if (cs) {
      const canonicalFromSyntax = canonicalizeVarName(cs)
      if (canonicalFromSyntax && !rewrites.has(cs)) {
        rewrites.set(cs, { canonical, id })
      }
    }

    const cssVar = toFigmaVarExpr(v.name ?? '')?.trim()
    if (cssVar) {
      if (!rewrites.has(cssVar)) {
        rewrites.set(cssVar, { canonical, id })
      }
    }
  }

  const total = Math.round((now() - startedAt) * 10) / 10
  const scanMs = Math.round((scannedAt - startedAt) * 10) / 10
  const buildMs = Math.round((now() - scannedAt) * 10) / 10
  logger.debug(
    `vars scan=${scanMs}ms build=${buildMs}ms total=${total}ms ids=${variableIds.size} rewrites=${rewrites.size}`
  )

  return { variableIds, rewrites }
}
