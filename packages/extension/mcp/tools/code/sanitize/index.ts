import type { VisibleTree } from '../model'

import { patchNegativeGapStyles } from './negative-gap'
import { ensureRelativeForAbsoluteChildren } from './relative-parent'

type StyleMap = Map<string, Record<string, string>>

type StylePatch = (tree: VisibleTree, styles: StyleMap, svgRoots?: Set<string>) => void

const STYLE_PATCHES: StylePatch[] = [patchNegativeGapStyles, ensureRelativeForAbsoluteChildren]

export function sanitizeStyles(tree: VisibleTree, styles: StyleMap, svgRoots?: Set<string>): void {
  STYLE_PATCHES.forEach((patch) => patch(tree, styles, svgRoots))
}
