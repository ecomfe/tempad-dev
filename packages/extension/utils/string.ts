import stringifyObject from 'stringify-object'

export function kebabToCamel(str: string) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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
  return str.replace(ESCAPE_RE, (match) => ESCAPE_MAP[match]!)
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

const JS_PROPERTY_NAME_RE = /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u

export function stringify(value: unknown): string {
  const ancestors = new Set<object>()

  function serialize(value: unknown, pad: string): string {
    if (value === null || typeof value !== 'object') {
      return stringifyObject(value, { indent: '  ' })
    }
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (!array && prototype !== Object.prototype && prototype !== null) {
      return stringifyObject(value, { indent: '  ' })
    }
    if (ancestors.has(value)) return '"[Circular]"'

    // The library drops own __proto__ keys. Serialize data containers directly
    // so this key remains a property when the generated expression is evaluated.
    ancestors.add(value)
    const indent = `${pad}  `
    const entries = array
      ? value.map((item) => `${indent}${serialize(item, indent)}`)
      : Reflect.ownKeys(value)
          .filter((key) => Object.prototype.propertyIsEnumerable.call(value, key))
          .map((key) => {
            const name =
              typeof key === 'symbol' || key === '__proto__'
                ? `[${stringifyObject(key)}]`
                : JS_PROPERTY_NAME_RE.test(key)
                  ? key
                  : stringifyObject(key)
            return `${indent}${name}: ${serialize(Reflect.get(value, key), indent)}`
          })
    ancestors.delete(value)
    const [open, close] = array ? ['[', ']'] : ['{', '}']
    return entries.length ? `${open}\n${entries.join(',\n')}\n${pad}${close}` : `${open}${close}`
  }

  return serialize(value, '')
}

export function indentAll(str: string, indent: string, skipFirst = false) {
  return str
    .split('\n')
    .map((line, index) => (skipFirst && index === 0 ? '' : indent) + line)
    .join('\n')
}
