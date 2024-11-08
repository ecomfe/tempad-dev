import type { TransformOptions } from '@/plugins/src'

import { parseNumber, toDecimalPlace } from './number'
import { kebabToCamel } from './string'

function escapeSingleQuote(value: string) {
  return value.replace(/'/g, "\\'")
}

function trimComments(value: string) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '')
}

const PX_VALUE_RE = /\b(-?\d+(?:.\d+)?)px\b/g
const VARIABLE_RE = /var\(--([a-zA-Z\d-]+)(?:,\s*([^)]+))?\)/g
const KEEP_PX_PROPS = ['border', 'box-shadow', 'filter', 'backdrop-filter', 'stroke-width']

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

function pxToRem(value: string, rootFontSize: number) {
  return transformPxValue(value, (val) => `${toDecimalPlace(val / rootFontSize)}rem`)
}

type ProcessValueOptions = {
  useRem: boolean
  rootFontSize: number
}

type SerializeOptions = {
  toJS?: boolean
} & ProcessValueOptions

export function serializeCSS(
  style: Record<string, string>,
  { toJS = false, useRem, rootFontSize }: SerializeOptions,
  { transform, transformVariable, transformPx }: TransformOptions = {}
) {
  function processValue(key: string, value: string) {
    let current = trimComments(value).trim()

    if (typeof transformVariable === 'function') {
      current = current.replace(VARIABLE_RE, (_, name: string, value: string) =>
        transformVariable({ code: current, name, value })
      )
    }

    if (KEEP_PX_PROPS.includes(key)) {
      return current
    }

    if (typeof transformPx === 'function') {
      current = transformPxValue(current, (value) => transformPx({ value }))
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
    code = transform({ code, style: processedStyle })
  }

  return code
}