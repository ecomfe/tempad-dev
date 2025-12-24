import { canonicalizeVarName, normalizeFigmaVarName, toFigmaVarExpr } from '@/utils/css'

import { getVariableRawName } from './indexer'

type VariableAlias = { id?: string } | { type?: string; id?: string }

export type CandidateResult = {
  variableIds: Set<string>
  rewrites: Map<string, { canonical: string; id: string }>
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

function collectVariableIdFromValue(value: unknown, bucket: Set<string>): void {
  if (!value) return

  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableIdFromValue(item, bucket))
    return
  }

  if (typeof value === 'object') {
    if (
      'visible' in (value as { visible?: boolean }) &&
      (value as { visible?: boolean }).visible === false
    ) {
      return
    }

    const alias = value as VariableAlias
    if (alias && typeof alias.id === 'string') {
      bucket.add(alias.id)
      return
    }

    Object.values(value).forEach((nested) => collectVariableIdFromValue(nested, bucket))
  }
}

function collectVariableIds(node: SceneNode, bucket: Set<string>): void {
  if ('boundVariables' in node) {
    const { boundVariables } = node
    if (boundVariables) {
      Object.values(boundVariables).forEach((entry) => collectVariableIdFromValue(entry, bucket))
    }
  }

  if ('inferredVariables' in node) {
    const { inferredVariables } = node
    if (inferredVariables) {
      Object.values(inferredVariables).forEach((entry) => collectVariableIdFromValue(entry, bucket))
    }
  }

  if ('variableReferences' in node) {
    const { variableReferences } = node
    if (variableReferences) {
      Object.values(variableReferences).forEach((entry) =>
        collectVariableIdFromValue(entry, bucket)
      )
    }
  }

  if ('fills' in node) {
    const { fills } = node
    if (Array.isArray(fills)) {
      fills.forEach((fill) => collectVariableIdFromValue(fill, bucket))
    }
  }

  if ('strokes' in node) {
    const { strokes } = node
    if (Array.isArray(strokes)) {
      strokes.forEach((stroke) => collectVariableIdFromValue(stroke, bucket))
    }
  }

  if ('effects' in node) {
    const { effects } = node
    if (Array.isArray(effects)) {
      effects.forEach((effect) => collectVariableIdFromValue(effect, bucket))
    }
  }
}

export function collectCandidateVariableIds(roots: SceneNode[]): CandidateResult {
  const variableIds = new Set<string>()
  const rewrites = new Map<string, { canonical: string; id: string }>()

  const visit = (node: SceneNode) => {
    collectVariableIds(node, variableIds)

    if (hasChildren(node)) {
      node.children.forEach((child) => {
        if (child.visible) visit(child)
      })
    }
  }

  roots.forEach((root) => {
    if (root.visible) visit(root)
  })

  // Build lookup tables based on collected ids.
  for (const id of variableIds) {
    const v = figma.variables.getVariableById(id)
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

  return { variableIds, rewrites }
}
