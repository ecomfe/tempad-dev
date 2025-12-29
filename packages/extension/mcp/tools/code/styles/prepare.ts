import type { VariableMappings } from '../../token/mapping'
import type { VisibleTree } from '../model'

import { normalizeStyleVars } from '../../token/mapping'
import { sanitizeStyles } from '../sanitize'
import { buildLayoutStyles } from './normalize'

type PrepareStylesInput = {
  tree: VisibleTree
  styles: Map<string, Record<string, string>>
  mappings: VariableMappings
  variableCache: Map<string, Variable | null>
  vectorRoots: Set<string>
  trace?: {
    now: () => number
    stamp: (label: string, start: number) => void
  }
}

type PrepareStylesResult = {
  styles: Map<string, Record<string, string>>
  layout: Map<string, Record<string, string>>
  usedCandidateIds: Set<string>
}

export function prepareStyles({
  tree,
  styles,
  mappings,
  variableCache,
  vectorRoots,
  trace
}: PrepareStylesInput): PrepareStylesResult {
  const t0 = trace?.now?.()
  const usedCandidateIds = normalizeStyleVars(styles, mappings, variableCache)
  if (t0 != null) trace?.stamp?.('normalize-vars', t0)

  const t1 = trace?.now?.()
  sanitizeStyles(tree, styles, vectorRoots)
  const layout = buildLayoutStyles(styles, vectorRoots)
  if (t1 != null) trace?.stamp?.('layout', t1)

  return { styles, layout, usedCandidateIds }
}
