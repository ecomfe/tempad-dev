import { toDecimalPlace } from '@/utils/number'

type AutoLayoutLike = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  itemSpacing?: number
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
}

export function mergeInferredAutoLayout(
  expandedStyle: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
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

  const merged: Record<string, string> = expandedStyle

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
  style: Record<string, string>,
  node?: SceneNode,
  parent?: SceneNode
): Record<string, string> {
  if (!node || !('layoutSizingHorizontal' in node)) return style

  const next = style
  const layoutNode = node as AutoLayoutLike

  const parentLayoutMode = resolveParentLayoutMode(parent)
  const layoutAlign =
    'layoutAlign' in node ? (node as { layoutAlign?: string }).layoutAlign : undefined

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
    const layoutMode = (parent as AutoLayoutLike).layoutMode
    if (layoutMode && layoutMode !== 'NONE') return layoutMode
  }
  if ('inferredAutoLayout' in parent) {
    const inferred = (parent as { inferredAutoLayout?: AutoLayoutLike }).inferredAutoLayout
    if (inferred?.layoutMode && inferred.layoutMode !== 'NONE') {
      return inferred.layoutMode
    }
  }
  return undefined
}

function getAutoLayoutSource(node: SceneNode): AutoLayoutLike | undefined {
  const inferred = (node as { inferredAutoLayout?: AutoLayoutLike }).inferredAutoLayout
  if ('layoutMode' in node) {
    const layoutNode = node as AutoLayoutLike
    if (layoutNode.layoutMode && layoutNode.layoutMode !== 'NONE') {
      return layoutNode
    }
    // Fallback to inferred auto layout when Figma CSS doesn’t emit layout props
    if (inferred && inferred.layoutMode && inferred.layoutMode !== 'NONE') {
      return inferred
    }
    return layoutNode
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

function hasGap(s: Record<string, string>) {
  return !!(s.gap || s['row-gap'] || s['column-gap'])
}

function hasAtomicPadding(s: Record<string, string>) {
  return !!(s['padding-top'] || s['padding-right'] || s['padding-bottom'] || s['padding-left'])
}
