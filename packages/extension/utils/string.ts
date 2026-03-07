import stringifyObject from 'stringify-object'

export function kebabToCamel(str: string) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function camelToKebab(str: string) {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

export function snakeToKebab(str: string) {
  return str.replace(/_/g, '-').toLowerCase()
}

export function toPascalCase(str: string) {
  return str.replace(/(^\w|-+\w|_+\w|\s+\w)/g, (match) =>
    match.replace(/[-_\s]+/, '').toUpperCase()
  )
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}

const ESCAPE_RE = /[&<>"]/g

export function escapeHTML(str: string) {
  return str.replace(ESCAPE_RE, (match) => ESCAPE_MAP[match])
}

export function looseEscapeHTML(str: string) {
  return str.replaceAll('"', '&quot;')
}

const JS_SINGLE_QUOTE_ESCAPE_RE = /['\\\r\n\u2028\u2029]/g
const JS_TEMPLATE_LITERAL_ESCAPE_RE = /[`\\]|\$\{/g

const JS_SINGLE_QUOTE_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\r': '\\r',
  '\n': '\\n',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
}

const JS_TEMPLATE_LITERAL_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '`': '\\`',
  '${': '\\${'
}

export function escapeJsSingleQuotedString(str: string) {
  return str.replace(JS_SINGLE_QUOTE_ESCAPE_RE, (match) => JS_SINGLE_QUOTE_ESCAPES[match] ?? match)
}

export function escapeJsTemplateLiteralText(str: string) {
  return str.replace(
    JS_TEMPLATE_LITERAL_ESCAPE_RE,
    (match) => JS_TEMPLATE_LITERAL_ESCAPES[match] ?? match
  )
}

export function stringify(value: unknown) {
  return stringifyObject(value, { indent: '  ' })
}

export function indentAll(str: string, indent: string, skipFirst = false) {
  return str
    .split('\n')
    .map((line, index) => (skipFirst && index === 0 ? '' : indent) + line)
    .join('\n')
}
