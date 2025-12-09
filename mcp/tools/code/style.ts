import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import {
  CSS_VAR_FUNCTION_RE,
  canonicalizeVariable,
  expandShorthands,
  formatHexAlpha,
  normalizeCssVarName,
  normalizeStyleVariables,
  normalizeStyleValues,
  parseBackgroundShorthand
} from '@/utils/css'
import { cssToClassNames } from '@/utils/tailwind'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i

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

/**
 * Main pipeline function for cleaning and preparing raw Figma CSS.
 * 1. Cleans specific dirty data (e.g. lightgray bug).
 * 2. Expands shorthands (padding -> padding-top/right...).
 * 3. Injects fills if needed.
 */
export function preprocessStyles(
  style: Record<string, string>,
  node?: SceneNode,
  injectFills = true
): Record<string, string> {
  // Step 1: Clean known Figma dirty data BEFORE expansion,
  // because some cleaning logic (like background) relies on the shorthand structure.
  const cleaned = cleanFigmaSpecificStyles(style, node, injectFills)

  // Step 2: Expand shorthands to ensure we only deal with atomic props downstream.
  return expandShorthands(cleaned)
}

function cleanFigmaSpecificStyles(
  style: Record<string, string>,
  node?: SceneNode,
  injectFills = true
): Record<string, string> {
  const processed = { ...style }
  if (!node) return processed

  if (processed.background) {
    const bgValue = processed.background
    if (BG_URL_LIGHTGRAY_RE.test(bgValue) && 'fills' in node && Array.isArray(node.fills)) {
      const parsed = parseBackgroundShorthand(bgValue)

      if (parsed.image) processed['background-image'] = parsed.image
      if (parsed.size) processed['background-size'] = parsed.size
      if (parsed.repeat) processed['background-repeat'] = parsed.repeat
      if (parsed.position) processed['background-position'] = parsed.position

      const solidFill = node.fills.find(
        (f) => f.type === 'SOLID' && f.visible !== false
      ) as SolidPaint

      if (solidFill && solidFill.color) {
        processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
      }

      delete processed.background
    }
  }

  if (
    injectFills &&
    node.type !== 'TEXT' &&
    !processed.background &&
    !processed['background-color'] &&
    'fills' in node &&
    Array.isArray(node.fills)
  ) {
    const solidFill = node.fills.find(
      (f) => f.type === 'SOLID' && f.visible !== false
    ) as SolidPaint
    if (solidFill && solidFill.color) {
      processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
    }
  }

  return processed
}

export function mergeInferredAutoLayout(
  expandedStyle: Record<string, string>,
  node: SceneNode
): Record<string, string> {
  // Respect explicit grid layout from Figma; don't overwrite with inferred flex.
  const display = expandedStyle.display
  if (display === 'grid' || display === 'inline-grid') {
    return expandedStyle
  }

  const source = getAutoLayoutSource(node)
  if (!source || source.layoutMode === 'NONE' || !source.layoutMode) {
    return expandedStyle
  }

  const merged: Record<string, string> = { ...expandedStyle }

  if (!merged.display?.includes('flex')) {
    merged.display = 'flex'
  }
  if (!merged['flex-direction']) {
    merged['flex-direction'] = source.layoutMode === 'HORIZONTAL' ? 'row' : 'column'
  }

  if (typeof source.itemSpacing === 'number' && !hasGap(merged)) {
    merged.gap = `${Math.round(source.itemSpacing)}px`
  }

  const justify = mapAxisAlignToCss(source.primaryAxisAlignItems)
  if (justify && !merged['justify-content']) merged['justify-content'] = justify

  const align = mapAxisAlignToCss(source.counterAxisAlignItems)
  if (align && !merged['align-items']) merged['align-items'] = align

  if (node.type !== 'INSTANCE') {
    // Optimization: Since styles are expanded, we don't need to check "padding".
    // We only check if specific atomic paddings are missing.
    const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = source
    if (t || r || b || l) {
      // Only apply inferred padding if NO padding is present (simplistic heuristic),
      // or we can overwrite. Standard behavior usually prefers manual overrides.
      // Here we check if any specific padding side is set.
      if (!hasAtomicPadding(merged)) {
        merged['padding-top'] = `${t ?? 0}px`
        merged['padding-right'] = `${r ?? 0}px`
        merged['padding-bottom'] = `${b ?? 0}px`
        merged['padding-left'] = `${l ?? 0}px`
      }
    }
  }

  return merged
}

export function inferResizingStyles(
  style: Record<string, string>,
  node: SceneNode
): Record<string, string> {
  const source = getAutoLayoutSource(node)
  if (!source) return style

  const merged = { ...style }
  const { layoutSizingHorizontal, layoutSizingVertical } = source

  if (layoutSizingHorizontal === 'FILL') {
    merged.width = 'auto'
    merged['flex-grow'] = '1'
    merged['flex-shrink'] = '1'
    merged['flex-basis'] = '0%'
  } else if (layoutSizingHorizontal === 'HUG') {
    merged.width = 'max-content'
  }

  if (layoutSizingVertical === 'FILL') {
    merged.height = 'auto'
    if (style['flex-direction'] === 'column') {
      merged['flex-grow'] = '1'
      merged['flex-basis'] = '0%'
    } else {
      merged['align-self'] = 'stretch'
    }
  } else if (layoutSizingVertical === 'HUG') {
    merged.height = 'max-content'
  }

  return merged
}

function getAutoLayoutSource(node: SceneNode): AutoLayoutLike | undefined {
  const inferred =
    (node as { inferredAutoLayout?: AutoLayoutLike | null }).inferredAutoLayout ?? undefined

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

type VariableReferenceInternal = {
  nodeId: string
  property: string
  code: string
  name: string
  value?: string
}

type PropertyBucket = {
  nodeId: string
  property: string
  value: string
  matchIndices: number[]
}

type ApplyVariableOptions = {
  pluginCode?: string
  config: CodegenConfig
}

export async function applyVariableTransforms(
  styles: Map<string, Record<string, string>>,
  { pluginCode, config }: ApplyVariableOptions
): Promise<void> {
  const { references, buckets } = collectVariableReferences(styles)
  if (!references.length) return

  const transformResults = await runTransformVariableBatch(
    references.map(({ code, name, value }) => ({ code, name, value })),
    {
      useRem: config.cssUnit === 'rem',
      rootFontSize: config.rootFontSize ?? 16,
      scale: config.scale ?? 1
    },
    pluginCode
  )

  const replacements = transformResults.map((result) => {
    return canonicalizeVariable(result) || result
  })

  const safeRegex = new RegExp(CSS_VAR_FUNCTION_RE.source, CSS_VAR_FUNCTION_RE.flags)

  for (const bucket of buckets.values()) {
    const style = styles.get(bucket.nodeId)
    if (!style) continue

    let occurrence = 0
    style[bucket.property] = bucket.value.replace(safeRegex, (match: string) => {
      const refIndex = bucket.matchIndices[occurrence++]
      return replacements[refIndex] ?? match
    })
  }
}

export function stripInertShadows(style: Record<string, string>, node: SceneNode): void {
  if (!style['box-shadow']) return
  if (hasRenderableFill(node)) return
  delete style['box-shadow']
}

function hasRenderableFill(node: SceneNode): boolean {
  if (!('fills' in node)) return false
  const fills = node.fills
  if (!Array.isArray(fills)) return false
  return fills.some((fill) => isFillRenderable(fill as Paint))
}

function isFillRenderable(fill: Paint | undefined): boolean {
  if (!fill || fill.visible === false) {
    return false
  }
  if (typeof fill.opacity === 'number' && fill.opacity <= 0) {
    return false
  }
  if ('gradientStops' in fill && Array.isArray(fill.gradientStops)) {
    return fill.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

function collectVariableReferences(styles: Map<string, Record<string, string>>) {
  const references: VariableReferenceInternal[] = []
  const buckets = new Map<string, PropertyBucket>()
  const regex = new RegExp(CSS_VAR_FUNCTION_RE.source, CSS_VAR_FUNCTION_RE.flags)

  for (const [nodeId, style] of styles.entries()) {
    normalizeStyleVariables(style)

    for (const [property, value] of Object.entries(style)) {
      let match: RegExpExecArray | null
      let hasMatch = false
      const indices: number[] = []

      regex.lastIndex = 0
      while ((match = regex.exec(value))) {
        hasMatch = true
        const [, name, fallback] = match
        const refIndex =
          references.push({
            nodeId,
            property,
            code: match[0],
            name: normalizeCssVarName(name),
            value: fallback?.trim()
          }) - 1
        indices.push(refIndex)
      }

      if (hasMatch) {
        const key = `${nodeId}:${property}`
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.matchIndices.push(...indices)
        } else {
          buckets.set(key, { nodeId, property, value, matchIndices: indices })
        }
      }
    }
  }
  return { references, buckets }
}

export function styleToClassNames(
  style: Record<string, string>,
  config: CodegenConfig,
  node?: SceneNode,
  options: { injectFills?: boolean } = {}
): string[] {
  const { injectFills = true } = options

  // NOTE: If styleToClassNames is called with styles that are ALREADY processed (like in collectSceneData),
  // re-running preprocessStyles might be redundant but harmless (expandShorthands is idempotent).
  // However, for Text Segments which are generated on the fly, this is necessary.
  const processed = preprocessStyles(style, node, injectFills)
  const normalizedStyle = normalizeStyleValues(processed, config)

  return cssToClassNames(normalizedStyle)
}
