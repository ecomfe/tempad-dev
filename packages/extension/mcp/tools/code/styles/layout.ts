import { toDecimalPlace } from '@/utils/number'

import type { AutoLayoutLike, StyleMap } from './types'

export function mergeInferredAutoLayout(expandedStyle: StyleMap, node?: SceneNode): StyleMap {
  if (!node) return expandedStyle
  // Respect explicit grid layout from Figma; don't overwrite with inferred flex.
  const display = expandedStyle.display
  if (display === 'grid' || display === 'inline-grid') {
    return expandedStyle
  }

  const source = getAutoLayoutSource(node)
  if (!source || source.layoutMode === 'NONE' || !source.layoutMode) {
    return expandedStyle
  }

  const merged: StyleMap = expandedStyle

  if (!merged.display?.includes('flex')) {
    merged.display = 'flex'
  }
  if (!merged['flex-direction']) {
    merged['flex-direction'] = source.layoutMode === 'HORIZONTAL' ? 'row' : 'column'
  }

  if (typeof source.itemSpacing === 'number' && !hasGap(merged)) {
    merged.gap = `${toDecimalPlace(source.itemSpacing)}px`
  }

  const justify = mapAxisAlignToCss(source.primaryAxisAlignItems)
  if (justify && !merged['justify-content']) {
    merged['justify-content'] = justify
  }

  const align = mapAxisAlignToCss(source.counterAxisAlignItems)
  if (align && !merged['align-items']) {
    merged['align-items'] = align
  }

  if (hasAtomicPadding(merged)) {
    return merged
  }

  if (typeof source.paddingTop === 'number') {
    merged['padding-top'] = `${toDecimalPlace(source.paddingTop)}px`
  }
  if (typeof source.paddingRight === 'number') {
    merged['padding-right'] = `${toDecimalPlace(source.paddingRight)}px`
  }
  if (typeof source.paddingBottom === 'number') {
    merged['padding-bottom'] = `${toDecimalPlace(source.paddingBottom)}px`
  }
  if (typeof source.paddingLeft === 'number') {
    merged['padding-left'] = `${toDecimalPlace(source.paddingLeft)}px`
  }

  return merged
}

export function inferResizingStyles(
  style: StyleMap,
  node?: SceneNode,
  parent?: SceneNode
): StyleMap {
  if (!node || !('layoutSizingHorizontal' in node)) return style

  const next = style
  const layoutNode: AutoLayoutLike = node

  const parentLayoutMode = resolveParentLayoutMode(parent)
  const layoutAlign = 'layoutAlign' in node ? node.layoutAlign : undefined

  if (layoutAlign === 'STRETCH') {
    next['align-self'] = next['align-self'] || 'stretch'
  } else if (parentLayoutMode) {
    const parentIsHorizontal = parentLayoutMode === 'HORIZONTAL'
    if (parentIsHorizontal && layoutNode.layoutSizingVertical === 'FILL') {
      next['align-self'] = next['align-self'] || 'stretch'
    }
    if (!parentIsHorizontal && layoutNode.layoutSizingHorizontal === 'FILL') {
      next['align-self'] = next['align-self'] || 'stretch'
    }
  }

  if (layoutNode.layoutSizingHorizontal === 'HUG') {
    delete next.width
  }

  if (layoutNode.layoutSizingVertical === 'HUG') {
    delete next.height
  }

  return next
}

function resolveParentLayoutMode(parent?: SceneNode): AutoLayoutLike['layoutMode'] | undefined {
  if (!parent) return undefined
  if ('layoutMode' in parent) {
    const layoutMode = parent.layoutMode
    if (layoutMode && layoutMode !== 'NONE') return layoutMode
  }
  if ('inferredAutoLayout' in parent) {
    const inferred = parent.inferredAutoLayout
    if (inferred?.layoutMode && inferred.layoutMode !== 'NONE') {
      return inferred.layoutMode
    }
  }
  return undefined
}

function getAutoLayoutSource(node: SceneNode): AutoLayoutLike | undefined {
  const inferred = 'inferredAutoLayout' in node ? (node.inferredAutoLayout ?? undefined) : undefined
  if ('layoutMode' in node) {
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      return node
    }
    // Fallback to inferred auto layout when Figma CSS doesn’t emit layout props
    if (inferred && inferred.layoutMode && inferred.layoutMode !== 'NONE') {
      return inferred
    }
    return node
  }

  return inferred
}

function mapAxisAlignToCss(value?: string): string | undefined {
  const map: Record<string, string> = {
    MIN: 'flex-start',
    MAX: 'flex-end',
    CENTER: 'center',
    SPACE_BETWEEN: 'space-between',
    STRETCH: 'stretch'
  }
  return value ? map[value] : undefined
}

function hasGap(s: StyleMap) {
  return !!(s.gap || s['row-gap'] || s['column-gap'])
}

function hasAtomicPadding(s: StyleMap) {
  return !!(s['padding-top'] || s['padding-right'] || s['padding-bottom'] || s['padding-left'])
}
