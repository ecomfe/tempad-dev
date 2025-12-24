import { canonicalizeValue, formatHexAlpha, toFigmaVarExpr } from '@/utils/css'
import { toDecimalPlace } from '@/utils/number'

import {
  CODE_FONT_KEYWORDS,
  TYPO_FIELDS,
  type ResolvedFill,
  type RunStyleEntry,
  type StyledTextSegmentSubset,
  type TokenRef,
  type VariableAlias
} from './types'

export function resolveRunAttrs(
  seg: StyledTextSegmentSubset,
  typography: Record<string, TokenRef>,
  fills: ResolvedFill[]
): Record<string, string> {
  const style: Record<string, string> = {}
  let visibleSolid: ResolvedFill | undefined
  let hasVisiblePaint = false
  for (const fill of fills) {
    if (!isVisiblePaint(fill.raw as Paint)) continue
    hasVisiblePaint = true
    if (fill.type === 'SOLID') {
      visibleSolid = fill
      break
    }
  }

  if (visibleSolid) {
    const rawPaint = visibleSolid.raw as SolidPaint | undefined
    if (rawPaint) {
      const val = formatHexAlpha(rawPaint.color, rawPaint.opacity ?? 1)
      const css = constructCssVar(visibleSolid.token, val)
      if (css) style.color = css
    }
  } else if (fills.length === 0 || !hasVisiblePaint) {
    style.color = 'transparent'
  }

  const { fontFamily, fontSize, lineHeight, letterSpacing, fontWeight } = typography

  const fontVal = constructCssVar(fontFamily, seg.fontName?.family)
  if (fontVal) style['font-family'] = fontVal

  const sizeVal = constructCssVar(
    fontSize,
    typeof seg.fontSize === 'number' ? `${toDecimalPlace(seg.fontSize)}px` : undefined
  )
  if (sizeVal) style['font-size'] = sizeVal

  if (fontWeight || typeof seg.fontWeight === 'number') {
    const wVal = inferFontWeight(seg.fontName?.style, seg.fontWeight)
    const wStr = wVal != null ? String(wVal) : undefined
    const weightCss = constructCssVar(fontWeight, wStr)
    if (weightCss) style['font-weight'] = weightCss
  }

  const lhVal = constructCssVar(lineHeight, formatLineHeightValue(seg.lineHeight))
  if (lhVal) style['line-height'] = lhVal

  const lsVal = constructCssVar(letterSpacing, formatLetterSpacingValue(seg.letterSpacing))
  if (lsVal) style['letter-spacing'] = lsVal

  if (seg.textCase) {
    const transform = mapTextCase(seg.textCase)
    if (transform) style['text-transform'] = transform
  }

  if (seg.textDecoration === 'UNDERLINE' || seg.textDecoration === 'STRIKETHROUGH') {
    style['text-decoration-line'] = seg.textDecoration.toLowerCase().replace('_', '-')
  }

  return style
}

export function resolveTokens(textNode: TextNode, seg: StyledTextSegmentSubset) {
  const typography: Record<string, TokenRef> = {}

  TYPO_FIELDS.forEach((field) => {
    const bindings = seg.boundVariables as Record<string, VariableAlias> | undefined
    let token = resolveAliasToTokenSync(bindings?.[field])

    if (!token && seg.textStyleId && typeof seg.textStyleId === 'string') {
      try {
        const style = figma.getStyleById(seg.textStyleId) as TextStyle
        const styleBindings = style?.boundVariables as Record<string, VariableAlias> | undefined
        token = resolveAliasToTokenSync(styleBindings?.[field])
      } catch {
        // noop
      }
    }

    if (!token) {
      try {
        const alias = textNode.getRangeBoundVariable(
          seg.start,
          seg.end,
          field as VariableBindableTextField
        )
        if (alias !== figma.mixed) {
          token = resolveAliasToTokenSync(alias)
        }
      } catch {
        // noop
      }
    }
    if (token) typography[field] = token
  })

  const fillRaw = Array.isArray(seg.fills) ? seg.fills : []
  const fills: ResolvedFill[] = fillRaw.map((paint) => {
    if (paint.type === 'SOLID') {
      const colorToken = resolveAliasToTokenSync(paint.boundVariables?.color)
      return { type: 'SOLID', token: colorToken, raw: paint }
    }
    return { type: paint.type, raw: paint }
  })

  return { typography, fills }
}

function isVisiblePaint(paint?: Paint): boolean {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

export function computeDominantStyle(runStyles: RunStyleEntry[]): Record<string, string> {
  if (!runStyles.length) return {}

  const counts: Record<string, Record<string, { raw: string; score: number }>> = {}
  let totalWeight = 0

  for (const { style, weight } of runStyles) {
    totalWeight += weight
    for (const [key, value] of Object.entries(style)) {
      const normalized = canonicalizeValue(key, value)
      if (!counts[key]) counts[key] = {}

      if (!counts[key][normalized]) {
        counts[key][normalized] = { raw: value, score: weight }
      } else {
        counts[key][normalized].score += weight
      }
    }
  }

  const dominant: Record<string, string> = {}
  const threshold = totalWeight * 0.5

  for (const key in counts) {
    const bucket = counts[key]
    let bestValue: { raw: string; score: number } | undefined

    for (const norm in bucket) {
      const entry = bucket[norm]
      if (!bestValue || entry.score > bestValue.score) {
        bestValue = entry
      }
    }

    if (bestValue && bestValue.score >= threshold) {
      dominant[key] = bestValue.raw
    }
  }

  return dominant
}

export function omitCommon(
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

export function isCodeFont(family: string): boolean {
  const lower = family.toLowerCase()
  return CODE_FONT_KEYWORDS.some((k) => lower.includes(k))
}

export function inferFontWeight(styleName?: string | null, explicit?: number): number | undefined {
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

function mapTextCase(textCase?: TextCase): string | undefined {
  const map: Record<string, string> = {
    UPPER: 'uppercase',
    LOWER: 'lowercase',
    TITLE: 'capitalize'
  }
  return map[textCase as string]
}

function constructCssVar(token?: TokenRef | null, fallback?: string): string | undefined {
  if (token) return toFigmaVarExpr(token.name)
  return fallback?.trim() || undefined
}

function resolveAliasToTokenSync(alias: VariableAlias | null | undefined): TokenRef | null {
  if (!alias || !alias.id) return null
  try {
    const variable = figma.variables.getVariableById(alias.id)
    if (!variable) return null
    return { id: variable.id, name: variable.name }
  } catch {
    return null
  }
}

function formatLineHeightValue(lineHeight?: LineHeight): string | undefined {
  if (!lineHeight) return undefined
  if (lineHeight.unit === 'AUTO') return 'normal'
  if ('value' in lineHeight) {
    const val = toDecimalPlace(lineHeight.value)
    return lineHeight.unit === 'PERCENT' ? `${val}%` : `${val}px`
  }
  return undefined
}

function formatLetterSpacingValue(letterSpacing?: LetterSpacing): string | undefined {
  if (!letterSpacing || !('value' in letterSpacing)) return undefined
  const val = toDecimalPlace(letterSpacing.value)
  return letterSpacing.unit === 'PERCENT' ? `${val}%` : `${val}px`
}
