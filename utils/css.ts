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
export const ZERO_UNITS_RE = /(^|\s)0(px|rem|%|em)(?=$|\s)/g

export const CSS_VAR_FUNCTION_RE = /var\(--([^,)]+)(?:,\s*([^)]+))?\)/g
export const CSS_VAR_FUNCTION_EXACT_RE = /^var\(\s*(--[A-Za-z0-9-_]+)\s*(?:,.*)?\)$/
const SCSS_VARS_RE = /(^|[^\w-])[$@]([a-zA-Z0-9_-]+)/g
const VAR_DEFAULTS_RE = /var\((--[a-zA-Z0-9_-]+),\s*[^)]+\)/g
const PREPROCESSOR_VAR_RE = /^[$@]([A-Za-z0-9-_]+)$/
const BARE_CSS_CUSTOM_PROP_RE = /^(--[A-Za-z0-9-_]+)$/

export const PX_VALUE_RE = /\b(-?\d+(?:.\d+)?)px\b/g
export const QUOTES_RE = /['"]/g
export const TOP_LEVEL_COMMA_RE = /,(?![^(]*\))/
const NUMBER_RE = /^\d+(\.\d+)?$/

export const BG_SIZE_RE = /\/\s*(cover|contain|auto|[\d.]+(?:px|%)?)/i
export const BG_REPEAT_RE = /(?:^|\s)(no-repeat|repeat-x|repeat-y|repeat|space|round)(?=$|\s)/i
export const BG_POS_RE =
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

export function parseBoxValues(value: string): [string, string, string, string] {
  const parts = value.trim().split(WHITESPACE_RE)
  const [t, r = t, b = t, l = r] = parts
  return [t, r, b, l]
}

export function parseFlexShorthand(value: string) {
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

export function transformPxValue(value: string, transform: (value: number) => string) {
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
    if (!TOP_LEVEL_COMMA_RE.test(val)) {
      const parsed = parseBackgroundShorthand(val)
      if (parsed.size) expanded['background-size'] = parsed.size
      if (parsed.repeat) expanded['background-repeat'] = parsed.repeat
      if (parsed.position) expanded['background-position'] = parsed.position
      if (parsed.image) expanded['background-image'] = parsed.image
      delete expanded['background']
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
      current = current.replace(CSS_VAR_FUNCTION_RE, (_, name: string, value: string) =>
        transformVariable({ code: current, name, value, options })
      )
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

export function canonicalizeVariable(value: string): string | null {
  const v = normalizeStyleValue(value)

  const varFn = v.match(CSS_VAR_FUNCTION_EXACT_RE)
  if (varFn) return `var(${varFn[1]})`

  const pre = v.match(PREPROCESSOR_VAR_RE)
  if (pre) return `var(--${pre[1]})`

  const bare = v.match(BARE_CSS_CUSTOM_PROP_RE)
  if (bare) return `var(${bare[1]})`

  return null
}

export function normalizeCssVarName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
  if (!cleaned) return 'var'
  if (/^[0-9-]/.test(cleaned)) {
    return `var-${cleaned.replace(/^-+/, '')}`
  }
  return cleaned
}

export function normalizeCssVarValue(value: string): string {
  const cleaned = canonicalizeEmbeddedVariables(stripCssComments(value))
  const normalizedVarFns = cleaned.replace(
    CSS_VAR_FUNCTION_RE,
    (_match, name: string, fallback?: string) => {
      const normalized = normalizeCssVarName(name)
      return fallback ? `var(--${normalized}, ${fallback})` : `var(--${normalized})`
    }
  )
  return normalizedVarFns
}

export function normalizeStyleVariables(style: Record<string, string>): Record<string, string> {
  Object.entries(style).forEach(([key, value]) => {
    const normalized = normalizeCssVarValue(value)
    if (normalized !== value) {
      style[key] = normalized
    }
  })
  return style
}

export function stripCssComments(value: string): string {
  return value.replace(CSS_COMMENTS_RE, '')
}

export function canonicalizeEmbeddedVariables(value: string): string {
  return value.replace(SCSS_VARS_RE, '$1var(--$2)')
}

export function isCssVar(value: string): boolean {
  return /^var\(/i.test(stripCssComments(value).trim())
}

export function isZeroValue(value: string): boolean {
  return /^(0+(\.0+)?)([a-z%]+)?$/i.test(value.trim())
}

export function normalizeStyleValue(raw: string): string {
  if (!raw) return ''
  let val = raw
  val = stripCssComments(val)
  val = canonicalizeEmbeddedVariables(val)
  val = val.replace(VAR_DEFAULTS_RE, 'var($1)')
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

export function stripVariantTextProps(
  style: Record<string, string>,
  hasVariants: boolean
): Record<string, string> {
  if (!hasVariants) return style
  return style
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
