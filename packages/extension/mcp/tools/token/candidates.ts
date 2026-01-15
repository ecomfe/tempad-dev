import { canonicalizeVarName, normalizeFigmaVarName, toFigmaVarExpr } from '@/utils/css'
import { logger } from '@/utils/log'

import { getVariableByIdCached } from './cache'
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

  if ('fills' in node) {
    const { fills } = node
    if (Array.isArray(fills)) {
      fills.forEach((fill) => {
        if (!fill || typeof fill !== 'object') return
        if (fill.boundVariables) collectVariableIdFromValue(fill.boundVariables, bucket)
        if (fill.variableReferences) collectVariableIdFromValue(fill.variableReferences, bucket)
      })
    }
  }

  if ('strokes' in node) {
    const { strokes } = node
    if (Array.isArray(strokes)) {
      strokes.forEach((stroke) => {
        if (!stroke || typeof stroke !== 'object') return
        if (stroke.boundVariables) collectVariableIdFromValue(stroke.boundVariables, bucket)
        if (stroke.variableReferences) collectVariableIdFromValue(stroke.variableReferences, bucket)
      })
    }
  }

  if ('effects' in node) {
    const { effects } = node
    if (Array.isArray(effects)) {
      effects.forEach((effect) => {
        if (!effect || typeof effect !== 'object') return
        if (effect.boundVariables) collectVariableIdFromValue(effect.boundVariables, bucket)
        if (effect.variableReferences) collectVariableIdFromValue(effect.variableReferences, bucket)
      })
    }
  }

  if ('fillStyleId' in node) {
    const styleId = node.fillStyleId
    if (styleId && typeof styleId === 'string') {
      try {
        const style = figma.getStyleById(styleId) as PaintStyle | null
        if (style?.paints && Array.isArray(style.paints)) {
          style.paints.forEach((paint) => {
            if (!paint || paint.visible === false) return
            if (paint.boundVariables) collectVariableIdFromValue(paint.boundVariables, bucket)
            if (paint.variableReferences)
              collectVariableIdFromValue(paint.variableReferences, bucket)
          })
        }
      } catch {
        // noop
      }
    }
  }
}

export function collectCandidateVariableIds(
  roots: SceneNode[],
  cache?: Map<string, Variable | null>
): CandidateResult {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = now()
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
