import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variable'
import {
  CSS_VAR_FUNCTION_RE,
  canonicalizeVariable,
  formatHexAlpha,
  normalizeCssValue,
  normalizeCssVarName,
  normalizeStyleVariables,
  normalizeStyleValues,
  parseBackgroundShorthand
} from '@/utils/css'
import { cssToClassNames } from '@/utils/tailwind'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i
const CSS_VAR_FALLBACK_RE = /var\(--[^,]+,\s*(.+)\)/

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
  resolveVariables: boolean
}

export async function applyVariableTransforms(
  styles: Map<string, Record<string, string>>,
  { config, pluginCode, resolveVariables }: ApplyVariableOptions
): Promise<void> {
  const { references, buckets } = collectVariableReferences(styles)
  if (!references.length) return

  let replacements: string[] = []

  if (resolveVariables) {
    replacements = references.map((ref) => {
      let rawValue = ref.value
      if (!rawValue) {
        const match = ref.code.match(CSS_VAR_FALLBACK_RE)
        if (match && match[1]) rawValue = match[1]
      }

      const val = (rawValue || ref.code).trim()
      return normalizeCssValue(val, config, ref.property)
    })
  } else {
    const transformResults = await runTransformVariableBatch(
      references.map(({ code, name, value }) => ({ code, name, value })),
      {
        useRem: config.cssUnit === 'rem',
        rootFontSize: config.rootFontSize ?? 16,
        scale: config.scale ?? 1
      },
      pluginCode
    )

    replacements = transformResults.map((result) => {
      return canonicalizeVariable(result) || result
    })
  }

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

export function styleToClassNames(
  style: Record<string, string>,
  config: CodegenConfig,
  node?: SceneNode,
  options: { injectFills?: boolean } = {}
): string[] {
  const { injectFills = true } = options
  const cleanStyle = processFigmaSpecificStyles(style, node, injectFills)
  // Batch normalize values (Scale & Unit conversion) before mapping to Tailwind
  const normalizedStyle = normalizeStyleValues(cleanStyle, config)
  return cssToClassNames(normalizedStyle)
}
