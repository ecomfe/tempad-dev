import { toDecimalPlace } from '@/utils/number'

import type { GetCodeCacheContext } from '../cache'
import type { AutoLayoutLike, StyleMap } from './types'

import { getNodeSemanticsCached } from '../cache'

export function mergeInferredAutoLayout(
  expandedStyle: StyleMap,
  node?: SceneNode,
  ctx?: GetCodeCacheContext
): StyleMap {
  if (!node) return expandedStyle
  // Respect explicit grid layout from Figma; don't overwrite with inferred flex.
  const display = expandedStyle.display
  if (display === 'grid' || display === 'inline-grid') {
    return expandedStyle
  }

  const source = getAutoLayoutSource(node, ctx)
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
  parent?: SceneNode,
  ctx?: GetCodeCacheContext
): StyleMap {
  if (!node) return style

  const next = style
  const semantics = ctx ? getNodeSemanticsCached(node, ctx) : null
  const layoutNode = getResizingSource(node, semantics)

  if (!layoutNode.layoutSizingHorizontal && !layoutNode.layoutSizingVertical) return style

  const parentLayoutMode = resolveParentLayoutMode(parent, ctx)
  const layoutAlign =
    semantics?.layout.layoutAlign ?? ('layoutAlign' in node ? node.layoutAlign : undefined)

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

function resolveParentLayoutMode(
  parent?: SceneNode,
  ctx?: GetCodeCacheContext
): AutoLayoutLike['layoutMode'] | undefined {
  if (!parent) return undefined
  const semantics = ctx ? getNodeSemanticsCached(parent, ctx) : null
  if (semantics?.layout.layoutMode && semantics.layout.layoutMode !== 'NONE') {
    return semantics.layout.layoutMode
  }
  if (!semantics && 'layoutMode' in parent) {
    const layoutMode = parent.layoutMode
    if (layoutMode && layoutMode !== 'NONE') return layoutMode
  }
  const inferred =
    semantics?.layout.inferredAutoLayout ??
    ('inferredAutoLayout' in parent ? parent.inferredAutoLayout : undefined)
  if (inferred?.layoutMode && inferred.layoutMode !== 'NONE') {
    return inferred.layoutMode
  }
  return undefined
}

function getAutoLayoutSource(
  node: SceneNode,
  ctx?: GetCodeCacheContext
): AutoLayoutLike | undefined {
  const semantics = ctx ? getNodeSemanticsCached(node, ctx) : null
  const inferred =
    semantics?.layout.inferredAutoLayout ??
    ('inferredAutoLayout' in node ? (node.inferredAutoLayout ?? undefined) : undefined)
  const layoutMode =
    semantics?.layout.layoutMode ?? ('layoutMode' in node ? node.layoutMode : undefined)

  if (layoutMode !== undefined && layoutMode !== null) {
    if (layoutMode && layoutMode !== 'NONE') {
      if (semantics) return buildAutoLayoutSource(layoutMode, semantics)
      return readLiveAutoLayoutSource(node, layoutMode)
    }
    // Fallback to inferred auto layout when Figma CSS doesn’t emit layout props
    if (inferred && inferred.layoutMode && inferred.layoutMode !== 'NONE') {
      return inferred
    }
    return semantics
      ? buildAutoLayoutSource(layoutMode, semantics)
      : readLiveAutoLayoutSource(node, layoutMode)
  }

  return inferred
}

function getResizingSource(
  node: SceneNode,
  semantics: ReturnType<typeof getNodeSemanticsCached> | null
): Pick<AutoLayoutLike, 'layoutSizingHorizontal' | 'layoutSizingVertical'> {
  if (semantics) {
    return {
      layoutSizingHorizontal: semantics.layout.layoutSizingHorizontal ?? undefined,
      layoutSizingVertical: semantics.layout.layoutSizingVertical ?? undefined
    }
  }

  return {
    layoutSizingHorizontal:
      'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : undefined,
    layoutSizingVertical: 'layoutSizingVertical' in node ? node.layoutSizingVertical : undefined
  }
}

function buildAutoLayoutSource(
  layoutMode: AutoLayoutLike['layoutMode'],
  semantics: ReturnType<typeof getNodeSemanticsCached>
): AutoLayoutLike {
  return {
    layoutMode: layoutMode ?? undefined,
    itemSpacing: semantics.layout.itemSpacing ?? undefined,
    primaryAxisAlignItems: semantics.layout.primaryAxisAlignItems ?? undefined,
    counterAxisAlignItems: semantics.layout.counterAxisAlignItems ?? undefined,
    paddingTop: semantics.layout.paddingTop ?? undefined,
    paddingRight: semantics.layout.paddingRight ?? undefined,
    paddingBottom: semantics.layout.paddingBottom ?? undefined,
    paddingLeft: semantics.layout.paddingLeft ?? undefined
  }
}

function readLiveAutoLayoutSource(
  node: SceneNode,
  layoutMode?: AutoLayoutLike['layoutMode'] | null
): AutoLayoutLike {
  return {
    layoutMode: layoutMode ?? undefined,
    itemSpacing: 'itemSpacing' in node ? node.itemSpacing : undefined,
    primaryAxisAlignItems: 'primaryAxisAlignItems' in node ? node.primaryAxisAlignItems : undefined,
    counterAxisAlignItems: 'counterAxisAlignItems' in node ? node.counterAxisAlignItems : undefined,
    paddingTop: 'paddingTop' in node ? node.paddingTop : undefined,
    paddingRight: 'paddingRight' in node ? node.paddingRight : undefined,
    paddingBottom: 'paddingBottom' in node ? node.paddingBottom : undefined,
    paddingLeft: 'paddingLeft' in node ? node.paddingLeft : undefined
  }
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
