import type { Fill, Variable } from '@tempad-dev/plugins'

import { RAW_TAG_NAME } from '@tempad-dev/plugins'

import type {
  SupportedLang,
  TransformOptions,
  ComponentPropertyValue,
  DesignNode,
  DesignComponent,
  DevComponent
} from '@/types/plugin'

import { prune } from './object'
import { camelToKebab, escapeHTML, looseEscapeHTML, stringify, indentAll } from './string'

export function getDesignComponent(node: SceneNode): DesignComponent | null {
  if (!('componentProperties' in node)) {
    return null
  }

  const { name, componentProperties, mainComponent } = node
  const properties: Record<string, ComponentPropertyValue> = {}

  for (const [name, data] of Object.entries(componentProperties)) {
    const key = name.split('#')[0]
    if (data.type === 'INSTANCE_SWAP') {
      const component = figma.getNodeById(data.value as string)
      if (component?.type === 'COMPONENT') {
        properties[key] = {
          name: component.name,
          type: 'INSTANCE',
          properties: {},
          children: [],
          visible: true
        }
      }
    } else {
      properties[key] = data.value
    }
  }

  const main = mainComponent ? { id: mainComponent.id, name: mainComponent.name } : null

  return {
    name,
    type: 'INSTANCE',
    properties,
    visible: node.visible,
    mainComponent: main,
    children: getChildren(node) ?? []
  }
}

function getChildren(node: SceneNode): DesignNode[] | null {
  if (!('children' in node)) {
    return null
  }

  const result: DesignNode[] = []
  for (const child of node.children) {
    const { visible } = child
    switch (child.type) {
      case 'INSTANCE': {
        const component = getDesignComponent(child)
        if (component) {
          result.push(component)
        }
        break
      }
      case 'TEXT': {
        result.push({
          name: child.name,
          type: 'TEXT',
          visible,
          characters: child.characters
        })
        break
      }
      case 'FRAME':
      case 'GROUP': {
        result.push({
          name: child.name,
          type: child.type,
          visible,
          children: getChildren(child) ?? []
        })
        break
      }
      case 'VECTOR': {
        type FillArray = Exclude<typeof child.fills, symbol>
        if (!Array.isArray(child.fills)) {
          break
        }
        const fills: Fill[] = []
        ;(child.fills as FillArray).forEach((fill) => {
          if (fill.type !== 'SOLID') {
            return
          }

          const { color: rgb, boundVariables } = fill
          const hex = rgbToHex(rgb)
          let color: string | Variable

          if (figma && boundVariables?.color) {
            const variable = figma.variables.getVariableById(boundVariables.color.id)
            color = variable ? { name: variable.name, value: hex } : hex
          } else {
            color = hex
          }

          fills.push({ color })
        })

        result.push({
          name: child.name,
          type: 'VECTOR',
          visible,
          fills
        })
        break
      }
      default:
        break
    }
  }

  return result
}

export type StringifyOptions = {
  lang: SupportedLang
  isInline?: (tagName: string) => boolean
}

export function stringifyComponent(
  component: DevComponent,
  optionsOrLang: SupportedLang | StringifyOptions
): string {
  const options: StringifyOptions =
    typeof optionsOrLang === 'string' ? { lang: optionsOrLang } : optionsOrLang

  switch (options.lang) {
    case 'vue': {
      return stringifyVueComponent(component, 0, options.isInline)
    }
    case 'jsx':
    case 'tsx':
    default: {
      return stringifyJSXComponent(component, 0, options.isInline)
    }
  }
}

const INDENT_UNIT = '  '

function stringifyBaseComponent(
  component: DevComponent,
  stringifyProp: (key: string, value: unknown) => string,
  indentLevel = 0,
  isInline?: (tagName: string) => boolean
) {
  const indent = INDENT_UNIT.repeat(indentLevel)
  const { name, props, children: rawChildren } = component

  if (name === RAW_TAG_NAME) {
    const content = String(props.content || '')
    const injectedProps = props.injectedProps as Record<string, string> | undefined
    let result = content
    if (injectedProps) {
      result = mergeAttributes(content, injectedProps)
    }
    return indentAll(result, indent)
  }

  const propItems = Object.entries(props)
    .filter(([, value]) => value != null)
    .map((entry) => stringifyProp(...entry))
    .filter(Boolean)

  const firstItem = propItems[0]

  const propsString =
    propItems.length === 0
      ? ''
      : propItems.length === 1
        ? firstItem.includes('\n')
          ? ` ${indentAll(firstItem, indent, true)}`
          : ` ${firstItem}`
        : `\n${propItems
            .map((prop) => `${indentAll(prop, indent + INDENT_UNIT)}`)
            .join('\n')}\n${indent}`

  const children = rawChildren.filter((child) => child != null)

  // Compact Mode Check
  const shouldCompact = isInline?.(name) ?? false

  let childrenString = ''

  if (shouldCompact) {
    // Compact Mode: No newlines, no extra indent, join with empty string
    childrenString = children
      .map((child): string => {
        if (typeof child === 'string') {
          return escapeHTML(child)
        }
        return stringifyBaseComponent(child, stringifyProp, 0, isInline)
      })
      .join('')
  } else {
    // Block Mode: Newlines and Indentation
    childrenString =
      children.length === 0
        ? ''
        : `\n${children
            .map((child): string => {
              if (typeof child === 'string') {
                const content = escapeHTML(child)
                return `${indent + INDENT_UNIT}${content}`
              }
              return stringifyBaseComponent(child, stringifyProp, indentLevel + 1, isInline)
            })
            .join('\n')}\n${indent}`
  }

  const appendFinalNewline = indentLevel === 0 && !shouldCompact
  const isVoidTag = VOID_HTML_TAGS.has(name.toLowerCase())
  const isCustomTag = isCustomComponentTag(name)

  let opening = ''
  let closing = ''

  if (childrenString) {
    opening = `<${name}${propsString}>`
    closing = `</${name}>`
  } else if (isVoidTag || isCustomTag) {
    opening = `<${name}${propsString} />`
    closing = ''
  } else {
    opening = `<${name}${propsString}></${name}>`
    closing = ''
  }

  return `${indent}${opening}${childrenString}${closing}${appendFinalNewline ? '\n' : ''}`
}

function isCustomComponentTag(tag: string): boolean {
  // React/Vue components are usually PascalCase; custom elements contain a hyphen.
  if (!tag) return false
  const first = tag[0]
  return first === first.toUpperCase() || tag.includes('-')
}

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

const EVENT_HANDLER_RE = /^on[A-Z]/

function getEventName(key: string) {
  if (EVENT_HANDLER_RE.test(key)) {
    return key[2].toLowerCase() + key.slice(3)
  }

  if (key.startsWith('@')) {
    return key.slice(1)
  }

  if (key.startsWith('v-on:')) {
    return key.slice(5)
  }

  return null
}

function stringifyVueComponent(
  component: DevComponent,
  indentLevel = 0,
  isInline?: (tag: string) => boolean
) {
  return stringifyBaseComponent(
    component,
    (key, value) => {
      const eventName = getEventName(key)
      if (eventName) {
        const callback = typeof value === 'string' ? looseEscapeHTML(value) : '() => {}'
        return `@${camelToKebab(eventName)}="${callback.trim()}"`
      }

      const name = key === 'className' ? 'class' : camelToKebab(key)

      if (typeof value === 'string') {
        return `${name}="${escapeHTML(value).trim()}"`
      }

      if (typeof value === 'boolean') {
        return value ? name : `:${name}="false"`
      }

      if (typeof value === 'object' && value != null) {
        const pruned = prune(value)
        if (pruned == null) {
          return ''
        }
        return `:${name}="${looseEscapeHTML(stringify(pruned)).trim()}"`
      }

      return `:${name}="${looseEscapeHTML(stringify(value)).trim()}"`
    },
    indentLevel,
    isInline
  )
}

function stringifyJSXComponent(
  component: DevComponent,
  indentLevel = 0,
  isInline?: (tag: string) => boolean
) {
  return stringifyBaseComponent(
    component,
    (key, value) => {
      if (EVENT_HANDLER_RE.test(key)) {
        const callback = typeof value === 'string' ? value : '() => {}'
        return `${key}="{${callback.trim()}}"`
      }

      if (typeof value === 'string') {
        return `${key}="${escapeHTML(value).trim()}"`
      }

      if (typeof value === 'boolean') {
        return value ? key : `${key}={false}`
      }

      if (typeof value === 'object' && value != null) {
        const pruned = prune(value)
        if (pruned == null) {
          return ''
        }
        return `${key}={${stringify(pruned)}}`
      }

      return `${key}={${stringify(value)}}`
    },
    indentLevel,
    isInline
  )
}

type SerializeOptions = {
  lang?: SupportedLang
}

export function serializeComponent(
  component: DesignComponent,
  { lang = 'jsx' }: SerializeOptions,
  { transformComponent }: TransformOptions = {}
) {
  if (typeof transformComponent === 'function') {
    const result = transformComponent({ component })
    if (typeof result === 'string') {
      return result
    }

    return stringifyComponent(result, { lang })
  }

  return ''
}

export function mergeAttributes(code: string, attrs: Record<string, string>): string {
  if (!code || !Object.keys(attrs).length) return code

  let i = 0
  // Skip leading whitespace
  while (i < code.length && /\s/.test(code[i])) i++

  if (code[i] !== '<') return code
  i++

  // Scan Tag Name
  while (i < code.length && /[a-zA-Z0-9\-_:.]/.test(code[i])) i++
  const tagNameEnd = i

  const existingAttrs = new Map<
    string,
    { nameStart: number; valueStart: number; valueEnd: number; quote: string }
  >()

  while (i < code.length) {
    // Skip whitespace
    while (i < code.length && /\s/.test(code[i])) i++

    if (i >= code.length) break

    // Check for end of tag
    if (code[i] === '>') {
      break
    }
    if (code[i] === '/' && code[i + 1] === '>') {
      break
    }

    // Attribute Name
    const attrNameStart = i
    while (i < code.length && /[^=\s/>]/.test(code[i])) i++
    const attrName = code.slice(attrNameStart, i)

    // Skip whitespace after name
    while (i < code.length && /\s/.test(code[i])) i++

    // Check for equals
    if (code[i] === '=') {
      i++ // skip =
      // Skip whitespace after =
      while (i < code.length && /\s/.test(code[i])) i++

      // Attribute Value
      let quote = ''
      let valueStart = i
      let valueEnd

      if (code[i] === '"' || code[i] === "'") {
        quote = code[i]
        i++
        valueStart = i
        while (i < code.length && code[i] !== quote) {
          if (code[i] === '\\') i++ // skip escaped char
          i++
        }
        valueEnd = i
        if (i < code.length) i++ // skip closing quote
      } else {
        // Unquoted value
        while (i < code.length && /[^>\s]/.test(code[i])) i++
        valueEnd = i
      }

      existingAttrs.set(attrName, { nameStart: attrNameStart, valueStart, valueEnd, quote })
    } else {
      // Boolean attribute
      existingAttrs.set(attrName, {
        nameStart: attrNameStart,
        valueStart: i,
        valueEnd: i,
        quote: ''
      })
    }
  }

  let newCode = code
  const insertions: string[] = []
  const replacements: { start: number; end: number; content: string }[] = []

  for (const [key, value] of Object.entries(attrs)) {
    // Case insensitive lookup for HTML/SVG attributes?
    // For now, let's do exact match or lowercase match if not found.
    let existing = existingAttrs.get(key)
    if (!existing) {
      const lowerKey = key.toLowerCase()
      for (const [k, v] of existingAttrs) {
        if (k.toLowerCase() === lowerKey) {
          existing = v
          break
        }
      }
    }

    if (existing) {
      if (key === 'class' || key === 'className') {
        const currentVal = code.slice(existing.valueStart, existing.valueEnd)
        const merged = mergeClasses(currentVal, String(value))
        if (existing.quote) {
          replacements.push({
            start: existing.valueStart,
            end: existing.valueEnd,
            content: escapeHTML(merged)
          })
        } else {
          replacements.push({
            start: existing.valueStart,
            end: existing.valueEnd,
            content: `"${escapeHTML(merged)}"`
          })
        }
      } else {
        if (existing.quote === '' && existing.valueStart === existing.valueEnd) {
          // Boolean attribute, add value
          replacements.push({
            start: existing.valueStart,
            end: existing.valueEnd,
            content: `="${escapeHTML(String(value))}"`
          })
        } else if (existing.quote) {
          replacements.push({
            start: existing.valueStart,
            end: existing.valueEnd,
            content: escapeHTML(String(value))
          })
        } else {
          replacements.push({
            start: existing.valueStart,
            end: existing.valueEnd,
            content: `"${escapeHTML(String(value))}"`
          })
        }
      }
    } else {
      insertions.push(` ${key}="${escapeHTML(String(value))}"`)
    }
  }

  replacements.sort((a, b) => b.start - a.start)

  for (const rep of replacements) {
    newCode = newCode.slice(0, rep.start) + rep.content + newCode.slice(rep.end)
  }

  if (insertions.length > 0) {
    // Re-scan for end of tag in newCode
    let j = tagNameEnd
    while (j < newCode.length) {
      if (newCode[j] === '"' || newCode[j] === "'") {
        const q = newCode[j]
        j++
        while (j < newCode.length && newCode[j] !== q) {
          if (newCode[j] === '\\') j++
          j++
        }
        if (j < newCode.length) j++ // skip closing quote
      } else if (newCode[j] === '>') {
        break
      } else if (newCode[j] === '/' && newCode[j + 1] === '>') {
        break
      } else {
        j++
      }
    }

    const insertPos = j
    newCode = newCode.slice(0, insertPos) + insertions.join('') + newCode.slice(insertPos)
  }

  return newCode
}

function mergeClasses(c1: string, c2: string): string {
  const s = new Set([...c1.split(/\s+/), ...c2.split(/\s+/)])
  s.delete('')
  return Array.from(s).join(' ')
}
