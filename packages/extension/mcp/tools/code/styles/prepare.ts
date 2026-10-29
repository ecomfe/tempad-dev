import type { GetCodeCacheContext } from '../cache'
import type { VisibleTree } from '../model'

import { sanitizeStyles } from '../sanitize'
import { buildLayoutStyles } from './normalize'

type PrepareStylesInput = {
  tree: VisibleTree
  styles: Map<string, Record<string, string>>
  vectorRoots: Set<string>
  cache: GetCodeCacheContext
  trace?: {
    now: () => number
    stamp: (label: string, start: number) => void
  }
}

type PrepareStylesResult = {
  styles: Map<string, Record<string, string>>
  layout: Map<string, Record<string, string>>
}

export function prepareStyles({
  tree,
  styles,
  vectorRoots,
  cache,
  trace
}: PrepareStylesInput): PrepareStylesResult {
  const startedAt = trace?.now?.()
  sanitizeStyles(tree, styles, vectorRoots, cache)
  const layout = buildLayoutStyles(styles, vectorRoots)
  if (startedAt != null) trace?.stamp?.('layout', startedAt)

  return { styles, layout }
}
