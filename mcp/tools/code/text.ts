import type { DevComponent } from '@/types/plugin'

import {
  canonicalizeValue,
  formatHexAlpha,
  normalizeCssValue,
  normalizeCssVarName,
  pruneInheritedTextStyles,
  stripDefaultTextStyles
} from '@/utils/css'
import { joinClassNames } from '@/utils/tailwind'

import type { RenderContext } from './index'

import { applyVariableTransforms, styleToClassNames } from './style'

type TextStyleMap = Record<string, string>

type SegmentFieldForRequest = keyof Omit<StyledTextSegment, 'characters' | 'start' | 'end'>

const REQUESTED_SEGMENT_FIELDS: SegmentFieldForRequest[] = [
  'fontName',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
  'paragraphSpacing',
  'indentation',
  'listOptions',
  'fills',
  'textStyleId',
  'fillStyleId',
  'boundVariables'
]

type StyledTextSegmentSubset = Pick<
  StyledTextSegment,
  SegmentFieldForRequest | 'characters' | 'start' | 'end'
>

type VariableAlias = { id?: string; type?: string }

const TYPO_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent'
] as const

type TokenRef = {
  id: string
  name: string
  collectionName?: string
  codeSyntax?: Record<string, string> | null
}

type SegmentStyleMeta = {
  raw: Partial<StyledTextSegmentSubset>
  tokens: {
    typography: Partial<Record<(typeof TYPO_FIELDS)[number], TokenRef>>
    fills: Array<{
      type: Paint['type']
      color?: TokenRef | null
      other?: Record<string, TokenRef | null>
    }>
  }
  refs: { textStyleId?: string | null; fillStyleId?: string | null }
}

export type RenderTextSegmentsOptions = {
  inheritedTextStyle?: TextStyleMap
  segments?: StyledTextSegmentSubset[] | null
  computeSegmentStyle?: boolean
}

export function getStyledSegments(node: TextNode): StyledTextSegmentSubset[] | null {
  try {
    if (typeof node.getStyledTextSegments !== 'function') return null
    const segments = node.getStyledTextSegments(REQUESTED_SEGMENT_FIELDS)
    return Array.isArray(segments) ? (segments as StyledTextSegmentSubset[]) : null
  } catch {
    return null
  }
}

export async function renderTextSegments(
  node: TextNode,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  options: RenderTextSegmentsOptions
): Promise<{
  segments: Array<DevComponent | string>
  commonStyle: Record<string, string>
  metas: SegmentStyleMeta[]
}> {
  const { inheritedTextStyle, segments: providedSegments, computeSegmentStyle = true } = options
  const segments: Array<DevComponent | string> = []
  const segStyles: Array<Record<string, string>> = []
  const metas: SegmentStyleMeta[] = []

  const rawSegments = providedSegments ?? getStyledSegments(node)

  if (!rawSegments || !rawSegments.length) {
    const literal = formatTextLiteral(node.characters ?? '')
    if (literal) segments.push(literal)
    return { segments, commonStyle: {}, metas }
  }

  rawSegments.forEach((seg) => {
    const literal = formatTextLiteral(seg.characters ?? '')
    if (!literal) return

    const child = wrapTextWithTags(literal, seg)
    segments.push(child)

    if (computeSegmentStyle) {
      const meta = buildSegmentMeta(node, seg)
      metas.push(meta)
      segStyles.push(buildSegmentStyle(meta, ctx.config))
    }
  })

  if (!computeSegmentStyle || !segStyles.length) {
    return { segments, commonStyle: {}, metas }
  }

  const styleMap = new Map<string, Record<string, string>>()
  segStyles.forEach((style, index) => {
    styleMap.set(`${node.id}:seg:${index}`, style)
  })

  await applyVariableTransforms(styleMap, {
    config: ctx.config,
    pluginCode: ctx.pluginCode,
    resolveVariables: ctx.options.resolveVariables ?? false // FIX: Access via ctx.options
  })

  const cleanedStyles = segStyles.map((style) => {
    const cleaned = stripDefaultTextStyles({ ...style })
    pruneInheritedTextStyles(cleaned, inheritedTextStyle)
    return cleaned
  })

  const commonStyle = computeDominantStyle(cleanedStyles)

  segments.forEach((seg, idx) => {
    const style = omitCommon(cleanedStyles[idx], commonStyle)
    if (!Object.keys(style).length) return

    const classNames = styleToClassNames(style, node)
    if (!classNames.length) return

    const cls = joinClassNames(classNames)
    if (typeof seg === 'string') {
      segments[idx] = { name: 'span', props: { [classProp]: cls }, children: [seg] }
    } else {
      segments[idx] = { ...seg, props: { ...(seg.props ?? {}), [classProp]: cls } }
    }
  })

  return { segments, commonStyle, metas }
}

function formatTextLiteral(value: string): string | null {
  return value.trim() ? value : null
}

function wrapTextWithTags(literal: string, seg: StyledTextSegmentSubset): DevComponent | string {
  let child: DevComponent | string = literal

  const weight = inferFontWeight(seg.fontName?.style, seg.fontWeight)
  const styleName = seg.fontName?.style?.toLowerCase() ?? ''

  const isBold =
    typeof weight === 'number'
      ? weight >= 600 || weight === 500
      : /bold|black|heavy/.test(styleName)

  const isItalic = seg.fontStyle === 'ITALIC' || /italic|oblique/.test(styleName)

  const decorationLine = mapTextDecorationLine(seg.textDecoration)
  const isUnderline = decorationLine === 'underline'
  const isStrike = decorationLine === 'line-through'

  if (isBold) child = { name: 'strong', props: {}, children: [child] }
  if (isItalic) child = { name: 'em', props: {}, children: [child] }
  if (isUnderline) child = { name: 'u', props: {}, children: [child] }
  if (isStrike) child = { name: 'del', props: {}, children: [child] }

  return child
}

function resolveAliasToTokenSync(alias: VariableAlias | null | undefined): TokenRef | null {
  if (!alias || typeof alias !== 'object' || !alias.id) return null
  try {
    const variable = figma.variables.getVariableById(alias.id)
    if (!variable) return null
    const collection = variable.variableCollectionId
      ? figma.variables.getVariableCollectionById(variable.variableCollectionId)
      : null

    return {
      id: variable.id,
      name: variable.name,
      collectionName: collection?.name,
      codeSyntax: (variable as { codeSyntax?: Record<string, string> }).codeSyntax ?? null
    }
  } catch {
    return null
  }
}

function buildSegmentMeta(textNode: TextNode, seg: StyledTextSegmentSubset): SegmentStyleMeta {
  const tokens: SegmentStyleMeta['tokens'] = { typography: {}, fills: [] }

  TYPO_FIELDS.forEach((field) => {
    const bindings = seg.boundVariables as
      | Record<VariableBindableTextField, VariableAlias>
      | undefined
    let token = resolveAliasToTokenSync(bindings?.[field as VariableBindableTextField])

    if (!token && seg.textStyleId && typeof seg.textStyleId === 'string') {
      try {
        const style = figma.getStyleById(seg.textStyleId) as TextStyle
        const styleBindings = style?.boundVariables as
          | Record<VariableBindableTextField, VariableAlias>
          | undefined
        token = resolveAliasToTokenSync(styleBindings?.[field as VariableBindableTextField])
      } catch {
        // Ignore
      }
    }

    if (!token) {
      try {
        const alias = textNode.getRangeBoundVariable(
          seg.start,
          seg.end,
          field as VariableBindableTextField
        )
        token = resolveAliasToTokenSync(alias as VariableAlias)
      } catch {
        // Ignore
      }
    }

    if (token) tokens.typography[field] = token
  })

  const fills = Array.isArray(seg.fills) ? (seg.fills as Paint[]) : []
  fills.forEach((paint) => {
    if (paint.type === 'SOLID') {
      const colorToken = resolveAliasToTokenSync(paint.boundVariables?.color)
      tokens.fills.push({ type: 'SOLID', color: colorToken ?? null })
    } else {
      const other: Record<string, TokenRef | null> = {}
      if ('boundVariables' in paint) {
        const bound = paint.boundVariables as Record<string, VariableAlias> | undefined
        if (bound) {
          Object.entries(bound).forEach(([k, alias]) => {
            other[k] = resolveAliasToTokenSync(alias as VariableAlias)
          })
        }
      }
      tokens.fills.push({ type: paint.type, other })
    }
  })

  return {
    raw: seg,
    tokens,
    refs: { textStyleId: seg.textStyleId as string, fillStyleId: seg.fillStyleId as string }
  }
}

function buildSegmentStyle(meta: SegmentStyleMeta, config: CodegenConfig): Record<string, string> {
  const { raw, tokens } = meta
  const style: Record<string, string> = {}

  const solid = raw.fills?.find((f) => f.type === 'SOLID' && f.visible !== false) as SolidPaint
  const colorToken = tokens.fills.find((f) => f.color)?.color
  const color = formatTokenExpression(colorToken, formatSolidPaintColor(solid))
  if (color) style.color = color

  if (raw.fontName?.family) {
    const fontFamily = formatTokenExpression(tokens.typography.fontFamily, raw.fontName.family)
    if (fontFamily) style['font-family'] = fontFamily
  }

  const weight = inferFontWeight(raw.fontName?.style, raw.fontWeight)
  if (weight != null) {
    style['font-weight'] = formatTokenExpression(tokens.typography.fontWeight, `${weight}`)!
  }

  const fontStyle = formatTokenExpression(
    tokens.typography.fontStyle,
    raw.fontStyle === 'ITALIC' ? 'italic' : 'normal'
  )
  if (fontStyle) style['font-style'] = fontStyle

  const size = typeof raw.fontSize === 'number' ? `${raw.fontSize}px` : undefined
  const normalizedSize = size ? normalizeCssValue(size, config, 'font-size') : undefined
  const fontSize = formatTokenExpression(tokens.typography.fontSize, normalizedSize)
  if (fontSize) style['font-size'] = fontSize

  const lineHeight = formatTokenExpression(
    tokens.typography.lineHeight,
    formatLineHeightValue(raw.lineHeight, config)
  )
  if (lineHeight) style['line-height'] = lineHeight

  const letterSpacing = formatTokenExpression(
    tokens.typography.letterSpacing,
    formatLetterSpacingValue(raw.letterSpacing, config)
  )
  if (letterSpacing) style['letter-spacing'] = letterSpacing

  const textTransform = raw.textCase ? mapTextCase(raw.textCase) : undefined
  if (textTransform) style['text-transform'] = textTransform

  const decorationLine = mapTextDecorationLine(raw.textDecoration)
  if (decorationLine) style['text-decoration-line'] = decorationLine

  if (raw.textDecorationStyle) {
    style['text-decoration-style'] = raw.textDecorationStyle.toLowerCase()
  }

  const decorationThickness = formatTextDecorationThickness(raw.textDecorationThickness, config)
  if (decorationThickness) style['text-decoration-thickness'] = decorationThickness

  const decorationOffset = formatTextDecorationOffset(raw.textDecorationOffset, config)
  if (decorationOffset) style['text-underline-offset'] = decorationOffset

  if (typeof raw.textDecorationSkipInk === 'boolean') {
    style['text-decoration-skip-ink'] = raw.textDecorationSkipInk ? 'auto' : 'none'
  }

  const decorationColor = formatTextDecorationColor(raw.textDecorationColor)
  if (decorationColor) style['text-decoration-color'] = decorationColor

  if (typeof raw.paragraphSpacing === 'number' && raw.paragraphSpacing > 0) {
    const spacing = normalizeCssValue(`${raw.paragraphSpacing}px`, config, 'margin-bottom')
    const paraSpacing = formatTokenExpression(tokens.typography.paragraphSpacing, spacing)
    if (paraSpacing) style['margin-bottom'] = paraSpacing
  }

  if (typeof raw.indentation === 'number' && raw.indentation > 0) {
    const indentVal = normalizeCssValue(`${raw.indentation}px`, config, 'text-indent')
    const indent = formatTokenExpression(tokens.typography.paragraphIndent, indentVal)
    if (indent) style['text-indent'] = indent
  }

  return style
}

function formatTokenExpression(token?: TokenRef | null, fallback?: string): string | undefined {
  if (token) return `var(--${normalizeCssVarName(token.name)})`
  const safeFallback = fallback?.trim()
  return safeFallback && safeFallback.length ? safeFallback : undefined
}

function formatSolidPaintColor(paint?: SolidPaint): string | undefined {
  if (!paint || paint.type !== 'SOLID') return undefined
  return paint.color ? formatHexAlpha(paint.color, paint.opacity) : undefined
}

function formatLineHeightValue(
  lineHeight: LineHeight | undefined,
  config: CodegenConfig
): string | undefined {
  if (!lineHeight) return undefined
  if (lineHeight.unit === 'AUTO') return 'normal'
  if ('value' in lineHeight) {
    if (lineHeight.unit === 'PERCENT') return `${lineHeight.value}%`
    return normalizeCssValue(`${lineHeight.value}px`, config, 'line-height')
  }
  return undefined
}

function formatLetterSpacingValue(
  letterSpacing: LetterSpacing | undefined,
  config: CodegenConfig
): string | undefined {
  if (!letterSpacing || !('value' in letterSpacing)) return undefined
  if (letterSpacing.unit === 'PERCENT') return `${letterSpacing.value}%`
  return normalizeCssValue(`${letterSpacing.value}px`, config, 'letter-spacing')
}

function formatTextDecorationThickness(
  thickness: TextDecorationThickness | null | undefined,
  config: CodegenConfig
): string | undefined {
  if (!thickness || thickness.unit === 'AUTO') return undefined
  if (thickness.unit === 'PERCENT') return `${thickness.value}%`
  return normalizeCssValue(`${thickness.value}px`, config, 'text-decoration-thickness')
}

function formatTextDecorationOffset(
  offset: TextDecorationOffset | null | undefined,
  config: CodegenConfig
): string | undefined {
  if (!offset || offset.unit === 'AUTO') return undefined
  if (offset.unit === 'PERCENT') return `${offset.value}%`
  return normalizeCssValue(`${offset.value}px`, config, 'text-underline-offset')
}

function formatTextDecorationColor(color?: TextDecorationColor | null): string | undefined {
  if (!color || color.value === 'AUTO') return undefined
  return formatSolidPaintColor(color.value as SolidPaint)
}

function inferFontWeight(styleName?: string | null, explicit?: number): number | undefined {
  if (typeof explicit === 'number') return explicit
  if (!styleName) return undefined
  const matched = styleName.match(/(\d{3})/)
  if (matched) return Number(matched[1])

  const lowered = styleName.toLowerCase()
  const mapping: Record<string, number> = {
    black: 900,
    extrabold: 800,
    ultrabold: 800,
    bold: 700,
    semibold: 600,
    demibold: 600,
    medium: 500,
    light: 300,
    thin: 200
  }

  for (const [k, v] of Object.entries(mapping)) {
    if (lowered.includes(k)) return v
  }

  return undefined
}

function mapTextDecorationLine(decoration?: TextDecoration): string | undefined {
  if (decoration === 'UNDERLINE') return 'underline'
  if (decoration === 'STRIKETHROUGH') return 'line-through'
  return undefined
}

function mapTextCase(textCase?: TextCase): string | undefined {
  switch (textCase) {
    case 'UPPER':
      return 'uppercase'
    case 'LOWER':
      return 'lowercase'
    case 'TITLE':
      return 'capitalize'
    case 'ORIGINAL':
      return 'none'
    case 'SMALL_CAPS':
      return 'small-caps'
    case 'SMALL_CAPS_FORCED':
      return 'small-caps'
    default:
      return undefined
  }
}

function computeDominantStyle(styles: Array<Record<string, string>>): Record<string, string> {
  if (!styles.length) return {}
  const counts = new Map<string, Map<string, { raw: string; count: number }>>()

  for (const style of styles) {
    for (const [key, value] of Object.entries(style)) {
      const normalized = canonicalizeValue(key, value)
      if (!counts.has(key)) counts.set(key, new Map())
      const perProp = counts.get(key)!
      const entry = perProp.get(normalized)
      perProp.set(normalized, { raw: entry?.raw ?? value, count: (entry?.count ?? 0) + 1 })
    }
  }

  const dominant: Record<string, string> = {}
  for (const [key, perProp] of counts.entries()) {
    const total = Array.from(perProp.values()).reduce((sum, item) => sum + item.count, 0)
    let best: { raw: string; count: number } | undefined
    for (const entry of perProp.values()) {
      if (!best || entry.count > best.count) best = entry
    }
    if (best && best.count > 1 && best.count >= total / 2) {
      dominant[key] = best.raw
    }
  }

  return dominant
}

function omitCommon(
  style: Record<string, string>,
  common: Record<string, string>
): Record<string, string> {
  if (!common || !Object.keys(common).length) return style
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(style)) {
    if (!common[key] || canonicalizeValue(key, value) !== canonicalizeValue(key, common[key])) {
      result[key] = value
    }
  }
  return result
}
