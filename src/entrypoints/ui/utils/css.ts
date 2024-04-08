import { parseNumber, toDecimalPlace } from "./number"
import { kebabToCamel } from "./string"

function escapeSingleQuote(value: string) {
  return value.replace(/'/g, "\\'")
}

function trimComments(value: string) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '')
}

const PX_VALUE_RE = /\b(\d+(?:.\d+)?)px\b/g
const KEEP_PX_PROPS = ['border', 'box-shadow', 'filter', 'backdrop-filter']
function pxToRem(value: string, rootFontSize: number) {
  if (rootFontSize <= 0) {
    return value
  }

  return value.replace(PX_VALUE_RE, (_, val) => {
    const parsed = parseNumber(val)
    if (parsed == null) {
      return val
    }
    if (parsed === 0) {
      return '0'
    }
    return `${toDecimalPlace(parsed / rootFontSize, 5)}rem`
  })
}

type ProcessValueOptions = {
  useRem: boolean
  rootFontSize: number
}

type SerializeOptions = {
  toJS?: boolean
} & ProcessValueOptions

function processValue(key: string, value: string, { useRem, rootFontSize }: ProcessValueOptions) {
  let current: string | number = trimComments(value).trim()

  return (
    parseNumber(current) ??
    (useRem && !KEEP_PX_PROPS.includes(key) ? pxToRem(current, rootFontSize) : current)
  )
}

function stringifyValue(value: string | number) {
  return typeof value === 'string' ? `'${escapeSingleQuote(value)}'` : value
}

function trimStyleObject(style: Record<string, string>) {
  return Object.entries(style).reduce((acc, [key, value]) => {
    if (value) {
      acc[key] = value
    }
    return acc
  }, {} as Record<string, string>)
}

export function serializeCSS(
  style: Record<string, string>,
  { toJS = false, useRem, rootFontSize }: SerializeOptions
) {
  const trimmedStyle = trimStyleObject(style)

  if (toJS) {
    return (
      '{\n' +
      Object.entries(trimmedStyle)
        .map(
          ([key, value]) =>
            `  ${kebabToCamel(key)}: ${stringifyValue(processValue(key, value, { useRem, rootFontSize }))}`
        )
        .join(',\n') +
      '\n}'
    )
  }

  return Object.entries(trimmedStyle)
    .map(([key, value]) => `${key}: ${processValue(key, value, { useRem, rootFontSize })};`)
    .join('\n')
}
