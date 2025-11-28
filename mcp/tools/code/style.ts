import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variable'
import {
  CSS_VAR_FUNCTION_RE,
  canonicalizeVariable,
  formatHexAlpha,
  normalizeCssVarName,
  normalizeStyleVariables
} from '@/utils/css'
import { styleToClassNames as coreStyleToClassNames } from '@/utils/tailwind'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i
const EXTRACT_URL_RE = /url\((['"]?)(.*?)\1\)/
const EXTRACT_SIZE_RE = /\/\s*(cover|contain|auto|[\d.]+(?:px|%)?)/i
const EXTRACT_REPEAT_RE = /(no-repeat|repeat-x|repeat-y|repeat|space|round)/i
const EXTRACT_POS_RE =
  /(?:^|\s)(center|top|bottom|left|right|[\d.]+(?:%|px))(?:\s+(?:center|top|bottom|left|right|[\d.]+(?:%|px)))?(?=\s*\/|\s*$)/i

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
  style: Record<string, string>,
  node: SceneNode
): Record<string, string> {
  const source = getAutoLayoutSource(node)
  if (!source || source.layoutMode === 'NONE' || !source.layoutMode) {
    return style
  }

  const merged: Record<string, string> = { ...style }

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

  if (node.type !== 'INSTANCE' && !hasPadding(merged)) {
    const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = source
    if (t || r || b || l) {
      merged['padding-top'] = `${t ?? 0}px`
      merged['padding-right'] = `${r ?? 0}px`
      merged['padding-bottom'] = `${b ?? 0}px`
      merged['padding-left'] = `${l ?? 0}px`
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
  if ('layoutMode' in node) return node as AutoLayoutLike
  const candidate = node as { inferredAutoLayout?: AutoLayoutLike | null }
  return candidate.inferredAutoLayout ?? undefined
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

function hasPadding(s: Record<string, string>) {
  return !!(
    s.padding ||
    s.paddingTop ||
    s.paddingRight ||
    s.paddingBottom ||
    s.paddingLeft ||
    s['padding-top'] ||
    s['padding-right'] ||
    s['padding-bottom'] ||
    s['padding-left']
  )
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
  config: CodegenConfig
  pluginCode?: string
}

export async function applyVariableTransforms(
  styles: Map<string, Record<string, string>>,
  { config, pluginCode }: ApplyVariableOptions
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

function processFigmaSpecificStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  const processed = { ...style }
  if (!node) return processed

  if (processed.background) {
    const bgValue = processed.background
    if (BG_URL_LIGHTGRAY_RE.test(bgValue) && 'fills' in node && Array.isArray(node.fills)) {
      const urlMatch = bgValue.match(EXTRACT_URL_RE)
      if (urlMatch) processed['background-image'] = urlMatch[0]

      const sizeMatch = bgValue.match(EXTRACT_SIZE_RE)
      if (sizeMatch) processed['background-size'] = sizeMatch[1]

      const repeatMatch = bgValue.match(EXTRACT_REPEAT_RE)
      if (repeatMatch) processed['background-repeat'] = repeatMatch[0]

      const posMatch = bgValue.match(EXTRACT_POS_RE)
      if (posMatch) processed['background-position'] = posMatch[0].trim()

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

export function styleToClassNames(style: Record<string, string>, node?: SceneNode): string[] {
  const cleanStyle = processFigmaSpecificStyles(style, node)
  return coreStyleToClassNames(cleanStyle)
}
