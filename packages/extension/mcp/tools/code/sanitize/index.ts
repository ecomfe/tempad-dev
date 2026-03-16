import type { GetCodeCacheContext } from '../cache'
import type { VisibleTree } from '../model'

import { canonicalizeAutoLayoutStyles } from './auto-layout-canonical'
import { patchNegativeGapStyles } from './negative-gap'
import { ensureRelativeForAbsoluteChildren } from './relative-parent'
import { applyAbsoluteStackingOrder } from './stacking'

type StyleMap = Map<string, Record<string, string>>

type StylePatch = (
  tree: VisibleTree,
  styles: StyleMap,
  svgRoots?: Set<string>,
  cache?: GetCodeCacheContext
) => void

const STYLE_PATCHES: StylePatch[] = [
  patchNegativeGapStyles,
  canonicalizeAutoLayoutStyles,
  ensureRelativeForAbsoluteChildren,
  applyAbsoluteStackingOrder
]

export function sanitizeStyles(
  tree: VisibleTree,
  styles: StyleMap,
  svgRoots?: Set<string>,
  cache?: GetCodeCacheContext
): void {
  STYLE_PATCHES.forEach((patch) => patch(tree, styles, svgRoots, cache))
}
