import type { TransformOptions } from '@/types/plugin'
import type { CodegenConfig } from '@/utils/codegen'

import { parseNumber, toDecimalPlace } from './number'
import { kebabToCamel } from './string'

function escapeSingleQuote(value: string) {
  return value.replace(/'/g, "\\'")
}

export const WHITESPACE_RE = /\s+/
export const ALL_WHITESPACE_RE = /\s+/g
export const COMMA_DELIMITER_RE = /,\s*/g
const ZERO_UNITS_RE = /(^|\s)0(px|rem|%|em)(?=$|\s)/g

const SCSS_VARS_RE = /(^|[^\w-])[$@]([a-zA-Z0-9_-]+)/g

const PX_VALUE_RE = /\b(-?\d+(?:\.\d+)?)px\b/g
export const QUOTES_RE = /['"]/g
const NUMBER_RE = /^\d+(\.\d+)?$/

// Figma CSS var naming normalization (matches getCSSAsync output semantics for variable names)
const RE_NON_ASCII = /\P{ASCII}+/gu
const RE_QUOTES = /['"]/g
const RE_SLASH = /\//g
const RE_SPACE_TAB = /[ \t]+/g
const RE_WHITESPACE = /\s+/g
const RE_FAST_PATH = /^[A-Za-z0-9_-]+$/

const RE_BOUND_NON_ALPHANUM = /[^A-Za-z0-9]+/g
const RE_HYPHENS = /-+/g
const RE_BOUND_DIGIT = /([A-Za-z])([0-9])|([0-9])([A-Za-z])/g
const RE_BOUND_CASE = /([a-z])([A-Z])|([A-Z])([A-Z][a-z])/g

const RE_DIGIT = /^\d+$/
const RE_CAPS = /^[A-Z]+$/
const RE_SINGLE = /^[A-Za-z]$/

function hasTopLevelComma(value: string): boolean {
  let depth = 0
  let quote: "'" | '"' | null = null

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]

    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) return true
  }

  return false
}

const BG_SIZE_RE = /\/\s*(cover|contain|auto|[\d.]+(?:px|%)?)/i
const BG_REPEAT_RE = /(?:^|\s)(no-repeat|repeat-x|repeat-y|repeat|space|round)(?=$|\s)/i
const BG_POS_RE =
  /(?:^|\s)(center|top|bottom|left|right|[\d.]+(?:%|px))(?:\s+(?:center|top|bottom|left|right|[\d.]+(?:%|px)))?(?=\s*\/|\s*$)/i
export const BG_URL_RE = /url\((['"]?)(.*?)\1\)/i

const KEEP_PX_PROPS = new Set([
  'border',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'stroke-width',
  'box-shadow',
  'filter',
  'backdrop-filter'
])

const CSS_COMMENTS_RE = /\/\*[\s\S]*?\*\//g

type VarFunctionMatch = {
  full: string
  name: string
  fallback?: string
}

export function replaceVarFunctions(
  input: string,
  replacer: (match: VarFunctionMatch) => string
): string {
  if (!input) return input

  let out = ''
  let i = 0

  while (i < input.length) {
    const start = input.toLowerCase().indexOf('var(', i)
    if (start < 0) {
      out += input.slice(i)
      break
    }

    out += input.slice(i, start)

    let j = start + 4
    let depth = 1
    let nameStart = -1
    let nameEnd = -1
    let commaIndex = -1

    while (j < input.length && /\s/.test(input[j])) j++
    nameStart = j

    for (; j < input.length; j++) {
      const ch = input[j]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) break
      } else if (ch === ',' && depth === 1 && commaIndex < 0) {
        commaIndex = j
        nameEnd = j
      }
    }

    if (depth !== 0) {
      out += input.slice(start)
      break
    }

    if (commaIndex < 0) {
      nameEnd = j
    }

    while (nameEnd > nameStart && /\s/.test(input[nameEnd - 1])) nameEnd--

    const full = input.slice(start, j + 1)
    const name = input.slice(nameStart, nameEnd)
    const fallback = commaIndex >= 0 ? input.slice(commaIndex + 1, j).trim() : undefined

    out += replacer({ full, name, ...(fallback ? { fallback } : {}) })
    i = j + 1
  }

  return out
}

export function extractVarNames(input: string): Set<string> {
  const out = new Set<string>()
  if (!input) return out

  replaceVarFunctions(input, ({ name, full }) => {
    const trimmed = name.trim()
    if (trimmed.startsWith('--')) {
      out.add(normalizeCustomPropertyName(trimmed))
    }
    return full
  })

  return out
}

export function formatHexAlpha(
  color: { r: number; g: number; b: number },
  opacity: number = 1
): string {
  const toHex = (n: number) => {
    const i = Math.min(255, Math.max(0, Math.round(n * 255)))
    return i.toString(16).padStart(2, '0').toUpperCase()
  }

  const r = toHex(color.r)
  const g = toHex(color.g)
  const b = toHex(color.b)

  if (opacity >= 0.99) {
    if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1]) {
      return `#${r[0]}${g[0]}${b[0]}`
    }
    return `#${r}${g}${b}`
  }

  const a = toHex(opacity)
  if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1] && a[0] === a[1]) {
    return `#${r[0]}${g[0]}${b[0]}${a[0]}`
  }

  return `#${r}${g}${b}${a}`
}

export function parseBackgroundShorthand(value: string) {
  const result: {
    image?: string
    size?: string
    repeat?: string
    position?: string
  } = {}

  const urlMatch = value.match(BG_URL_RE)
  if (urlMatch) result.image = urlMatch[0]

  const sizeMatch = value.match(BG_SIZE_RE)
  if (sizeMatch) result.size = sizeMatch[1]

  const repeatMatch = value.match(BG_REPEAT_RE)
  if (repeatMatch) result.repeat = repeatMatch[1] || repeatMatch[0].trim()

  const posMatch = value.match(BG_POS_RE)
  if (posMatch) result.position = posMatch[0].trim()

  return result
}

function parseBoxValues(value: string): [string, string, string, string] {
  const parts = value.trim().split(WHITESPACE_RE)
  const [t, r = t, b = t, l = r] = parts
  return [t, r, b, l]
}

function parseFlexShorthand(value: string) {
  const parts = value.trim().split(WHITESPACE_RE)

  let grow = '1'
  let shrink = '1'
  let basis = '0%'

  if (parts.length === 1) {
    const p = parts[0]
    if (p === 'initial') {
      grow = '0'
      shrink = '1'
      basis = 'auto'
    } else if (p === 'auto') {
      grow = '1'
      shrink = '1'
      basis = 'auto'
    } else if (p === 'none') {
      grow = '0'
      shrink = '0'
      basis = 'auto'
    } else if (NUMBER_RE.test(p)) {
      grow = p
      shrink = '1'
      basis = '0%'
    } else {
      grow = '1'
      shrink = '1'
      basis = p
    }
  } else if (parts.length === 2) {
    grow = parts[0]
    if (NUMBER_RE.test(parts[1])) {
      shrink = parts[1]
      basis = '0%'
    } else {
      shrink = '1'
      basis = parts[1]
    }
  } else if (parts.length >= 3) {
    grow = parts[0]
    shrink = parts[1]
    basis = parts[2]
  }

  return { grow, shrink, basis }
}

function transformPxValue(value: string, transform: (value: number) => string) {
  return value.replace(PX_VALUE_RE, (_, val) => {
    const parsed = parseNumber(val)
    if (parsed == null) return val
    if (parsed === 0) return '0'
    return transform(toDecimalPlace(parsed, 5))
  })
}

function scalePxValue(value: string, scale: number): string {
  return transformPxValue(value, (val) => `${toDecimalPlace(scale * val)}px`)
}

function pxToRem(value: string, rootFontSize: number) {
  return transformPxValue(value, (val) => `${toDecimalPlace(val / rootFontSize)}rem`)
}

export function normalizeCssValue(value: string, config: CodegenConfig, prop?: string): string {
  if (!value) return value

  let current = value.trim()

  if (prop && KEEP_PX_PROPS.has(prop)) {
    return current
  }

  if (typeof config.scale === 'number' && config.scale !== 1) {
    current = scalePxValue(current, config.scale)
  }

  if (config.cssUnit === 'rem') {
    const root = config.rootFontSize || 16
    current = pxToRem(current, root)
  }

  return current
}

export function normalizeStyleValues(
  style: Record<string, string>,
  config: CodegenConfig
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    normalized[key] = normalizeCssValue(value, config, key)
  }
  return normalized
}

export function simplifyColorMixToRgba(input: string): string {
  if (!input || !input.includes('color-mix(')) return input

  return input.replace(
    /color-mix\(\s*in\s+srgb\s*,\s*(#[0-9a-fA-F]{3,8})\s+([0-9.]+)%\s*,\s*transparent\s*\)/g,
    (_match, hex: string, pct: string) => {
      const parsed = parseHexColor(hex)
      if (!parsed) return _match
      const weight = Number(pct) / 100
      if (!Number.isFinite(weight)) return _match
      const alpha = toDecimalPlace(parsed.a * weight, 3)
      return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`
    }
  )
}

function parseHexColor(input: string): { r: number; g: number; b: number; a: number } | null {
  let hex = input.trim().replace(/^#/, '')
  if (![3, 4, 6, 8].includes(hex.length)) return null

  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1

  if (![r, g, b, a].every((v) => Number.isFinite(v))) return null
  return { r, g, b, a }
}

function parseBorderShorthand(normalized: string): {
  width?: string
  style?: string
  color?: string
} {
  const matched = normalized.match(/^\s*(\S+)\s+(\S+)\s+(.+)\s*$/)
  if (matched) {
    const [, width, style, color] = matched
    return { width, style, color: color.trim() }
  }

  const parts = normalized.split(WHITESPACE_RE).filter(Boolean)
  return {
    width: parts[0],
    style: parts[1],
    color: parts.slice(2).join(' ').trim() || undefined
  }
}

export function expandShorthands(style: Record<string, string>): Record<string, string> {
  const expanded: Record<string, string> = { ...style }

  const boxKeys = ['padding', 'margin', 'inset']
  boxKeys.forEach((key) => {
    if (expanded[key]) {
      const val = normalizeStyleValue(expanded[key])
      const [t, r, b, l] = parseBoxValues(val)
      if (key === 'inset') {
        expanded['top'] = t
        expanded['right'] = r
        expanded['bottom'] = b
        expanded['left'] = l
      } else {
        expanded[`${key}-top`] = t
        expanded[`${key}-right`] = r
        expanded[`${key}-bottom`] = b
        expanded[`${key}-left`] = l
      }
      delete expanded[key]
    }
  })

  if (expanded['border-radius']) {
    const val = normalizeStyleValue(expanded['border-radius'])
    const [tl, tr, br, bl] = parseBoxValues(val)
    expanded['border-top-left-radius'] = tl
    expanded['border-top-right-radius'] = tr
    expanded['border-bottom-right-radius'] = br
    expanded['border-bottom-left-radius'] = bl
    delete expanded['border-radius']
  }

  if (expanded['gap']) {
    const val = normalizeStyleValue(expanded['gap'])
    const parts = val.trim().split(WHITESPACE_RE)
    expanded['row-gap'] = parts[0]
    expanded['column-gap'] = parts[1] || parts[0]
    delete expanded['gap']
  }

  if (expanded['flex']) {
    const val = normalizeStyleValue(expanded['flex'])
    const { grow, shrink, basis } = parseFlexShorthand(val)
    expanded['flex-grow'] = grow
    expanded['flex-shrink'] = shrink
    expanded['flex-basis'] = basis
    delete expanded['flex']
  }

  if (expanded['background']) {
    const val = normalizeStyleValue(expanded['background'])
    if (!hasTopLevelComma(val)) {
      const parsed = parseBackgroundShorthand(val)
      const hasParsed = !!(parsed.size || parsed.repeat || parsed.position || parsed.image)
      if (hasParsed) {
        if (parsed.size) expanded['background-size'] = parsed.size
        if (parsed.repeat) expanded['background-repeat'] = parsed.repeat
        if (parsed.position) expanded['background-position'] = parsed.position
        if (parsed.image) expanded['background-image'] = parsed.image
        delete expanded['background']
      }
    }
  }

  if (expanded['grid-row']) {
    const val = normalizeStyleValue(expanded['grid-row'])
    const parts = val.split(/\s*\/\s*/)
    if (parts.length > 1) {
      const start = parts[0].trim()
      const end = parts[1].trim()

      if (start.startsWith('span')) {
        expanded['grid-row-span'] = start.replace(/^span\s*/, '')
      } else {
        expanded['grid-row-start'] = start
      }

      if (end.startsWith('span')) {
        expanded['grid-row-span'] = end.replace(/^span\s*/, '')
      } else {
        expanded['grid-row-end'] = end
      }
      delete expanded['grid-row']
    }
  }

  if (expanded['grid-column']) {
    const val = normalizeStyleValue(expanded['grid-column'])
    const parts = val.split(/\s*\/\s*/)
    if (parts.length > 1) {
      const start = parts[0].trim()
      const end = parts[1].trim()

      if (start.startsWith('span')) {
        expanded['grid-column-span'] = start.replace(/^span\s*/, '')
      } else {
        expanded['grid-column-start'] = start
      }

      if (end.startsWith('span')) {
        expanded['grid-column-span'] = end.replace(/^span\s*/, '')
      } else {
        expanded['grid-column-end'] = end
      }
      delete expanded['grid-column']
    }
  }

  const borderKeys: Array<{ key: string; sides: Array<'top' | 'right' | 'bottom' | 'left'> }> = [
    { key: 'border', sides: ['top', 'right', 'bottom', 'left'] },
    { key: 'border-top', sides: ['top'] },
    { key: 'border-right', sides: ['right'] },
    { key: 'border-bottom', sides: ['bottom'] },
    { key: 'border-left', sides: ['left'] }
  ]

  for (const { key, sides } of borderKeys) {
    if (expanded[key]) {
      const val = normalizeStyleValue(expanded[key])
      const { width, style: borderStyle, color } = parseBorderShorthand(val)
      sides.forEach((side) => {
        if (width) expanded[`border-${side}-width`] = width
        if (borderStyle) expanded[`border-${side}-style`] = borderStyle
        if (color) expanded[`border-${side}-color`] = color
      })
      delete expanded[key]
    }
  }

  return expanded
}

type SerializeOptions = {
  toJS?: boolean
  useRem: boolean
  rootFontSize: number
  scale: number
}

export function serializeCSS(
  style: Record<string, string>,
  { toJS = false, useRem, rootFontSize, scale }: SerializeOptions,
  { transform, transformVariable, transformPx }: TransformOptions = {}
) {
  const options = { useRem, rootFontSize, scale }

  function processValue(key: string, value: string) {
    let current = normalizeStyleValue(value)

    if (typeof scale === 'number' && scale !== 1) {
      current = scalePxValue(current, scale)
    }

    if (typeof transformVariable === 'function') {
      current = replaceVarFunctions(current, ({ name, fallback }) => {
        const trimmed = name.trim()
        const normalizedName = trimmed.startsWith('--') ? trimmed.slice(2) : trimmed
        return transformVariable({
          code: current,
          name: normalizedName,
          value: fallback,
          options
        })
      })
    }

    if (KEEP_PX_PROPS.has(key)) {
      return current
    }

    if (typeof transformPx === 'function') {
      current = transformPxValue(current, (value) => transformPx({ value, options }))
    }

    if (useRem) {
      current = pxToRem(current, rootFontSize)
    }

    return current
  }

  function stringifyValue(value: string) {
    if (value.includes('\0')) {
      if (
        value.startsWith('\0') &&
        value.endsWith('\0') &&
        value.indexOf('\0', 1) === value.length - 1
      ) {
        return value.substring(1, value.length - 1)
      }

      const parts = value.split('\0')
      const template = parts
        .map((part, index) => (index % 2 === 0 ? part.replace(/`/g, '\\`') : '${' + part + '}'))
        .join('')

      return '`' + template + '`'
    }

    return `'${escapeSingleQuote(value)}'`
  }

  const processedStyle = Object.fromEntries(
    Object.entries(style)
      .filter(([, value]) => value)
      .map(([key, value]) => [key, processValue(key, value)])
  )

  if (!Object.keys(processedStyle).length) {
    return ''
  }

  let code = toJS
    ? '{\n' +
      Object.entries(processedStyle)
        .map(([key, value]) => `  ${kebabToCamel(key)}: ${stringifyValue(value)}`)
        .join(',\n') +
      '\n}'
    : Object.entries(processedStyle)
        .map(([key, value]) => `${key}: ${value};`)
        .join('\n')

  if (typeof transform === 'function') {
    code = transform({ code, style: processedStyle, options })
  }

  return code
}

export function canonicalizeVarName(value: string): string | null {
  if (!value) return null
  const cleaned = stripFallback(preprocessCssValue(value)).trim()

  if (cleaned.startsWith('var(') && cleaned.endsWith(')')) {
    // stripFallback() guarantees we have no comma at top-level.
    let inner = cleaned.slice(4, -1).trim()
    if (inner.startsWith('--')) {
      inner = inner.slice(2).trim()
      return normalizeCustomPropertyName(inner)
    }
    return null
  }

  if (cleaned.startsWith('--')) {
    return normalizeCustomPropertyName(cleaned)
  }

  return null
}

export function toVarExpr(name: string): string {
  return `var(${normalizeCustomPropertyName(name)})`
}

// Normalize a CSS custom property name (the portion after "--").
// Custom property names are more permissive than regular CSS identifiers.
// We keep it strict enough for MCP schema and Tailwind parsing:
// - allow only [A-Za-z0-9_-]
// - DO NOT add "var-" for numeric-leading names (e.g., "--05" is valid)
// - collapse accidental extra dashes (e.g. var(----foo) -> "--foo")
export function normalizeCustomPropertyBody(name: string): string {
  if (!name) return 'var'
  let raw = name.trim()
  if (raw.startsWith('--')) raw = raw.slice(2)
  raw = raw.replace(/^-+/, '')
  // Remove unsupported characters (Figma's CSS output tends to drop punctuation)
  raw = raw.replace(/[^A-Za-z0-9_-]/g, '')
  return raw || 'var'
}

export function normalizeCustomPropertyName(name: string): string {
  return `--${normalizeCustomPropertyBody(name)}`
}

// Normalize Figma variable names to CSS custom property names (matches getCSSAsync behavior).
export function normalizeFigmaVarName(input: string): string {
  let raw = (input ?? '').trim()
  if (!raw) return '--unnamed'
  raw = stripFallback(preprocessCssValue(raw)).trim()
  if (raw.startsWith('var(') && raw.endsWith(')')) {
    raw = raw.slice(4, -1).trim()
  }
  if (raw.startsWith('--')) raw = raw.slice(2).trim()
  raw = raw
    .replace(RE_NON_ASCII, '')
    .replace(RE_QUOTES, '')
    .replace(RE_SLASH, '-')
    .replace(RE_SPACE_TAB, '-')
    .replace(RE_WHITESPACE, '')

  if (RE_FAST_PATH.test(raw)) return `--${raw}`

  const s = raw
    .replace(RE_BOUND_NON_ALPHANUM, '-')
    .replace(RE_HYPHENS, '-')
    .replace(RE_BOUND_DIGIT, '$1-$2$3-$4')
    .replace(RE_BOUND_CASE, '$1$3-$2$4')

  const parts = s.split('-').filter(Boolean)
  const stack: string[] = []

  // Merge consecutive digits AND consecutive caps
  for (const part of parts) {
    const prev = stack[stack.length - 1]

    if (prev && RE_DIGIT.test(prev) && RE_DIGIT.test(part)) {
      stack[stack.length - 1] += part
    } else if (prev && RE_CAPS.test(prev) && RE_CAPS.test(part)) {
      stack[stack.length - 1] += part
    } else {
      stack.push(part)
    }
  }

  // Merge runs of single letters (except the first part)
  const merged: string[] = []
  for (let i = 0; i < stack.length; ) {
    if (i === 0) {
      merged.push(stack[0])
      i++
      continue
    }

    if (RE_SINGLE.test(stack[i])) {
      let j = i + 1
      while (j < stack.length && RE_SINGLE.test(stack[j])) {
        j++
      }

      const run = stack.slice(i, j)
      merged.push(run.length >= 2 ? run.join('') : stack[i])
      i = j
    } else {
      merged.push(stack[i])
      i++
    }
  }

  const out = merged.join('-').toLowerCase()
  return out ? `--${out}` : '--unnamed'
}

export function toFigmaVarExpr(input: string): string {
  return `var(${normalizeFigmaVarName(input)})`
}

// Preprocess raw CSS-like values so subsequent var() parsing behaves consistently.
// Intentionally does NOT strip fallbacks.
export function preprocessCssValue(value: string): string {
  if (!value) return value
  return value.replace(CSS_COMMENTS_RE, '').replace(SCSS_VARS_RE, '$1var(--$2)')
}

export function stripFallback(value: string): string {
  return replaceVarFunctions(value, ({ name, full, fallback }) => {
    if (!fallback) return full
    return `var(${name.trim()})`
  })
}

export function normalizeStyleValue(raw: string): string {
  if (!raw) return ''
  let val = preprocessCssValue(raw)
  val = stripFallback(val)
  val = val.replace(ZERO_UNITS_RE, '$10')
  return val.trim()
}

const TEXT_STYLE_DEFAULTS = new Map<string, string>([
  ['text-decoration-skip-ink', 'auto'],
  ['text-underline-offset', 'auto'],
  ['text-underline-position', 'from-font'],
  ['text-decoration-style', 'solid'],
  ['text-decoration-line', 'none'],
  ['text-decoration-thickness', 'auto'],
  ['font-style', 'normal'],
  ['font-weight', '400'],
  ['line-height', 'normal'],
  ['letter-spacing', '0'],
  ['letter-spacing-zero', '0'],
  ['text-transform', 'none']
])

const TEXT_STYLE_PROP_KEYS = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-decoration-thickness',
  'text-decoration-skip-ink',
  'text-underline-offset',
  'text-underline-position'
] as const

export const TEXT_STYLE_PROPS = new Set<string>(
  TEXT_STYLE_PROP_KEYS.filter((key) => !key.endsWith('-zero'))
)

export function stripDefaultTextStyles(style: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {}
  Object.entries(style).forEach(([key, value]) => {
    const defaultValue = TEXT_STYLE_DEFAULTS.get(key)
    if (defaultValue && canonicalizeValue(key, defaultValue) === canonicalizeValue(key, value)) {
      return
    }
    cleaned[key] = value
  })
  return cleaned
}

export function pruneInheritedTextStyles(
  style: Record<string, string>,
  ...bases: Array<Record<string, string> | undefined>
): void {
  Object.entries(style).forEach(([key, value]) => {
    const normalizedCurrent = canonicalizeValue(key, value)

    for (const base of bases) {
      const inheritedValue = base?.[key]
      if (inheritedValue && canonicalizeValue(key, inheritedValue) === normalizedCurrent) {
        delete style[key]
        return
      }
    }

    const defaultValue = TEXT_STYLE_DEFAULTS.get(key)
    if (defaultValue && canonicalizeValue(key, defaultValue) === normalizedCurrent) {
      delete style[key]
    }
  })
}

export function canonicalizeValue(key: string, value: string): string {
  const trimmed = value.trim().toLowerCase()

  if (/^0+(\.0+)?(px|%|rem|em)?$/.test(trimmed)) {
    return '0'
  }

  if (key === 'color') {
    const hex = canonicalizeColor(trimmed)
    if (hex) return hex
  }

  if (key === 'font-weight') {
    if (trimmed === 'normal') return '400'
    if (trimmed === 'bold') return '700'
  }

  if (key === 'line-height' && trimmed === 'normal') {
    return 'normal'
  }

  return trimmed.replace(ALL_WHITESPACE_RE, '')
}

export function canonicalizeColor(value: string): string | null {
  if (value.startsWith('#')) {
    return compressHex(value)
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => p.trim())
    const [r, g, b, a = '1'] = parts
    const toInt = (v: string) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.round(n) : null
    }
    const ri = toInt(r)
    const gi = toInt(g)
    const bi = toInt(b)
    const an = Number(a)
    if (
      ri != null &&
      gi != null &&
      bi != null &&
      ri >= 0 &&
      ri <= 255 &&
      gi >= 0 &&
      gi <= 255 &&
      bi >= 0 &&
      bi <= 255
    ) {
      const hex = compressHex(formatHex(ri, gi, bi))
      if (an >= 1 || Number.isNaN(an)) return hex
      const opacity = Math.max(0, Math.min(100, Math.round(an * 100)))
      return `${hex}/${opacity}`
    }
  }
  return null
}

function compressHex(hex: string): string {
  if (hex.length === 7 && hex[1] === hex[2] && hex[3] === hex[4] && hex[5] === hex[6]) {
    return `#${hex[1]}${hex[3]}${hex[5]}`
  }
  return hex
}
