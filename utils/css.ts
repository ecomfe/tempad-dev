import type { TransformOptions } from '@/types/plugin'

import { compressHex, formatHex } from './color'
import { parseNumber, toDecimalPlace } from './number'
import { kebabToCamel } from './string'

function escapeSingleQuote(value: string) {
  return value.replace(/'/g, "\\'")
}

const PX_VALUE_RE = /\b(-?\d+(?:.\d+)?)px\b/g
export const CSS_VAR_FUNCTION_RE = /var\(--([^,)]+)(?:,\s*([^)]+))?\)/g
const KEEP_PX_PROPS = ['border', 'box-shadow', 'filter', 'backdrop-filter', 'stroke-width']
const CSS_COMMENTS_RE = /\/\*[\s\S]*?\*\//g
const SCSS_VARS_RE = /(^|[^\w-])[$@]([a-zA-Z0-9_-]+)/g
const VAR_DEFAULTS_RE = /var\((--[a-zA-Z0-9_-]+),\s*[^)]+\)/g
const ZERO_UNITS_RE = /(^|\s)0(px|rem|%|em)(?=$|\s)/g

function transformPxValue(value: string, transform: (value: number) => string) {
  return value.replace(PX_VALUE_RE, (_, val) => {
    const parsed = parseNumber(val)
    if (parsed == null) {
      return val
    }
    if (parsed === 0) {
      return '0'
    }
    return transform(toDecimalPlace(parsed, 5))
  })
}

function scalePxValue(value: string, scale: number): string {
  return transformPxValue(value, (val) => `${toDecimalPlace(scale * val)}px`)
}

function pxToRem(value: string, rootFontSize: number) {
  return transformPxValue(value, (val) => `${toDecimalPlace(val / rootFontSize)}rem`)
}

type ProcessValueOptions = {
  useRem: boolean
  rootFontSize: number
  scale: number
}

type SerializeOptions = {
  toJS?: boolean
} & ProcessValueOptions

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

    if (KEEP_PX_PROPS.includes(key)) {
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
      // Check if the entire string is a single variable enclosed by \0
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

const CSS_VAR_FUNCTION_EXACT_RE = /^var\(\s*(--[A-Za-z0-9-_]+)\s*(?:,.*)?\)$/
const PREPROCESSOR_VAR_RE = /^[$@]([A-Za-z0-9-_]+)$/
const BARE_CSS_CUSTOM_PROP_RE = /^(--[A-Za-z0-9-_]+)$/

/**
 * Normalize any variable-shaped value into CSS var(--name).
 *
 * Supported input forms:
 * 1) CSS var():
 *    - "var(--ui-foo, 20px)" -> "var(--ui-foo)"
 *    - "var(--ui-foo, $ui-foo)" -> "var(--ui-foo)"
 *    - "var(--ui-foo)" -> "var(--ui-foo)"
 * 2) Preprocessor variables:
 *    - "$ui-foo" -> "var(--ui-foo)"
 *    - "@ui-foo" -> "var(--ui-foo)"
 * 3) Bare CSS custom property (optional):
 *    - "--ui-foo" -> "var(--ui-foo)"
 *
 * If the value is not recognized as a variable form, returns null.
 */
export function canonicalizeVariable(value: string): string | null {
  const v = normalizeStyleValue(value)

  // 1) CSS var(--name, fallback) or var(--name)
  const varFn = v.match(CSS_VAR_FUNCTION_EXACT_RE)
  if (varFn) {
    const name = varFn[1] // already like "--ui-foo"
    return `var(${name})`
  }

  // 2) SCSS / Less variables: $name / @name
  const pre = v.match(PREPROCESSOR_VAR_RE)
  if (pre) {
    const name = pre[1] // like "ui-foo"
    return `var(--${name})`
  }

  // 3) Bare CSS custom property: --name
  const bare = v.match(BARE_CSS_CUSTOM_PROP_RE)
  if (bare) {
    const name = bare[1] // like "--ui-foo"
    return `var(${name})`
  }

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

/**
 * Normalize all variable-like tokens in a style map in place.
 */
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

// Text style helpers
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
  ['letter-spacing', 'normal'],
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
    if (
      defaultValue &&
      normalizeComparableValue(key, defaultValue) === normalizeComparableValue(key, value)
    ) {
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
  // When mixed segments exist, we conservatively keep only properties that are present on all segments (handled by caller).
  // This helper is retained for API compatibility; it simply returns the original style when variants are present.
  return style
}

export function pruneInheritedTextStyles(
  style: Record<string, string>,
  ...bases: Array<Record<string, string> | undefined>
): void {
  Object.entries(style).forEach(([key, value]) => {
    const normalizedCurrent = normalizeComparableValue(key, value)

    for (const base of bases) {
      const inheritedValue = base?.[key]
      if (inheritedValue && normalizeComparableValue(key, inheritedValue) === normalizedCurrent) {
        delete style[key]
        return
      }
    }

    const defaultValue = TEXT_STYLE_DEFAULTS.get(key)
    if (defaultValue && normalizeComparableValue(key, defaultValue) === normalizedCurrent) {
      delete style[key]
    }
  })
}

export function mapTextCase(textCase: TextCase): string | undefined {
  switch (textCase) {
    case 'UPPER':
      return 'uppercase'
    case 'LOWER':
      return 'lowercase'
    case 'TITLE':
      return 'capitalize'
    case 'ORIGINAL':
    default:
      return undefined
  }
}

export function normalizeComparableValue(key: string, value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (key === 'color') {
    const hex = normalizeColorComparable(trimmed)
    if (hex) return hex
  }
  if (key === 'letter-spacing') {
    if (trimmed === 'normal') return '0'
    const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(px|%)?$/)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && Math.abs(n) < 1e-6) {
        return '0'
      }
    }
  }
  if (key === 'line-height' && trimmed === 'normal') {
    return 'normal'
  }
  return trimmed.replace(/\s+/g, '')
}

function normalizeColorComparable(value: string): string | null {
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
