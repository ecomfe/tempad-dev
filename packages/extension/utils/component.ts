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

import { rgbToHex } from './color'
import { prune } from './object'
import { camelToKebab, escapeHTML, stringify, indentAll } from './string'

type ComponentPropertyData = {
  type: string
  value: unknown
}

export function getDesignComponent(node: SceneNode): DesignComponent | null {
  const componentProperties = getComponentProperties(node)
  if (!componentProperties) {
    return null
  }

  const properties: Record<string, ComponentPropertyValue> = {}

  for (const [name, data] of Object.entries(componentProperties)) {
    const key = name.split('#')[0]
    if (!key) continue
    let value = data.value as ComponentPropertyValue
    if (data.type === 'INSTANCE_SWAP') {
      const component = figma.getNodeById(data.value as string)
      if (component?.type !== 'COMPONENT') continue
      value = {
        name: component.name,
        type: 'INSTANCE',
        properties: {},
        children: [],
        visible: true
      }
    }
    Object.defineProperty(properties, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }

  const main = getMainComponentSummary(node)

  return {
    name: node.name,
    type: 'INSTANCE',
    properties,
    visible: node.visible,
    mainComponent: main,
    children: getChildren(node) ?? []
  }
}

function getComponentProperties(node: SceneNode): Record<string, ComponentPropertyData> | null {
  if (!('componentProperties' in node)) {
    return null
  }

  try {
    const properties = node.componentProperties
    if (!properties || typeof properties !== 'object') {
      return {}
    }
    return properties as Record<string, ComponentPropertyData>
  } catch {
    return {}
  }
}

function getMainComponentSummary(node: SceneNode): { id: string; name: string } | null {
  if (!('mainComponent' in node)) {
    return null
  }

  try {
    const mainComponent = node.mainComponent
    return mainComponent ? { id: mainComponent.id, name: mainComponent.name } : null
  } catch {
    return null
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

export function escapeComponentText(text: string): string {
  // Entities stay literal text in both JSX and Vue, unlike their template delimiters.
  return escapeHTML(text).replace(/[{}]/g, (brace) => (brace === '{' ? '&#123;' : '&#125;'))
}

function stringifyBaseComponent(
  component: DevComponent,
  stringifyProp: (key: string, value: unknown, inSvg: boolean, isCustomTag: boolean) => string,
  indentLevel = 0,
  isInline?: (tagName: string) => boolean,
  parentIsSvg = false
) {
  const indent = INDENT_UNIT.repeat(indentLevel)
  const { name, props, children: rawChildren } = component
  const inSvg = name === 'svg' || parentIsSvg
  const childrenInSvg = inSvg && name !== 'foreignObject'
  const isCustomTag = isCustomComponentTag(name)

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
    .map(([key, value]) => stringifyProp(key, value, inSvg, isCustomTag))
    .filter(Boolean)

  let propsString = ''
  if (propItems.length === 1) {
    propsString = ` ${indentAll(propItems[0]!, indent, true)}`
  } else if (propItems.length > 1) {
    propsString = `\n${propItems.map((prop) => indentAll(prop, indent + INDENT_UNIT)).join('\n')}\n${indent}`
  }

  const children = rawChildren.filter((child) => child != null)

  // Compact Mode Check
  const shouldCompact = isInline?.(name) ?? false

  let childrenString: string

  if (shouldCompact) {
    // Compact Mode: No newlines, no extra indent, join with empty string
    childrenString = children
      .map((child): string => {
        if (typeof child === 'string') {
          return escapeComponentText(child)
        }
        return stringifyBaseComponent(child, stringifyProp, 0, isInline, childrenInSvg)
      })
      .join('')
  } else if (children.length === 0) {
    // Block Mode with no children
    childrenString = ''
  } else {
    // Block Mode: Newlines and indentation
    childrenString = `\n${children
      .map((child): string => {
        if (typeof child === 'string') {
          const content = escapeComponentText(child)
          return `${indent + INDENT_UNIT}${content}`
        }
        return stringifyBaseComponent(
          child,
          stringifyProp,
          indentLevel + 1,
          isInline,
          childrenInSvg
        )
      })
      .join('\n')}\n${indent}`
  }

  const appendFinalNewline = indentLevel === 0 && !shouldCompact
  const isVoidTag = VOID_HTML_TAGS.has(name.toLowerCase())

  let opening: string
  let closing: string

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
  const first = tag.charAt(0)
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
// Native HTML names are case-insensitive, but these DOM/JSX properties have no hyphen.
const HTML_CAMEL_CASE_ATTRIBUTES = new Set([
  'accessKey',
  'allowFullScreen',
  'autoCapitalize',
  'autoComplete',
  'autoFocus',
  'autoPlay',
  'cellPadding',
  'cellSpacing',
  'charSet',
  'colSpan',
  'contentEditable',
  'contextMenu',
  'controlsList',
  'crossOrigin',
  'dateTime',
  'dirName',
  'disablePictureInPicture',
  'disableRemotePlayback',
  'encType',
  'enterKeyHint',
  'fetchPriority',
  'formAction',
  'formEncType',
  'formMethod',
  'formNoValidate',
  'formTarget',
  'frameBorder',
  'hrefLang',
  'imageSizes',
  'imageSrcSet',
  'inputMode',
  'isMap',
  'itemID',
  'itemProp',
  'itemRef',
  'itemScope',
  'itemType',
  'marginHeight',
  'marginWidth',
  'maxLength',
  'minLength',
  'noModule',
  'noValidate',
  'playsInline',
  'popoverTarget',
  'popoverTargetAction',
  'readOnly',
  'referrerPolicy',
  'rowSpan',
  'shadowRootMode',
  'spellCheck',
  'srcDoc',
  'srcLang',
  'srcSet',
  'useMap'
])
const HTML_ENUMERATED_BOOLEAN_ATTRIBUTES = new Set(['contenteditable', 'draggable', 'spellcheck'])
// Vue's attribute fallback does not recognize these presence-only Boolean attributes.
const HTML_PRESENCE_BOOLEAN_ATTRIBUTES = new Set([
  'disablepictureinpicture',
  'disableremoteplayback',
  'playsinline'
])
const SVG_CASE_SENSITIVE_ATTRIBUTES = new Set([
  'viewBox',
  'preserveAspectRatio',
  'gradientUnits',
  'gradientTransform',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'textLength',
  'lengthAdjust',
  'filterUnits',
  'primitiveUnits',
  'stdDeviation',
  'baseFrequency',
  'numOctaves',
  'kernelMatrix',
  'kernelUnitLength',
  'keyPoints',
  'keyTimes',
  'keySplines',
  'attributeName',
  'attributeType',
  'repeatCount',
  'repeatDur',
  'calcMode',
  'pathLength',
  'startOffset',
  'tableValues',
  'targetX',
  'targetY',
  'viewTarget',
  'xChannelSelector',
  'yChannelSelector',
  'zoomAndPan',
  'requiredExtensions',
  'requiredFeatures',
  'systemLanguage',
  'externalResourcesRequired',
  'filterRes',
  'spreadMethod',
  'preserveAlpha',
  'surfaceScale',
  'diffuseConstant',
  'specularConstant',
  'specularExponent',
  'limitingConeAngle',
  'pointsAtX',
  'pointsAtY',
  'pointsAtZ'
])

function getEventName(key: string) {
  if (EVENT_HANDLER_RE.test(key)) {
    return key.charAt(2).toLowerCase() + key.slice(3)
  }

  if (key.startsWith('@')) {
    return key.slice(1)
  }

  if (key.startsWith('v-on:')) {
    return key.slice(5)
  }

  return null
}

function getVueAttributeName(key: string, inSvg: boolean, isCustomTag: boolean): string {
  if (key === 'className') return 'class'
  if (key === 'tabIndex') return 'tabindex'
  if (key === 'htmlFor') return 'for'

  if (!isCustomTag) {
    if (inSvg && key === 'xlinkHref') return 'xlink:href'
    if (!inSvg && HTML_CAMEL_CASE_ATTRIBUTES.has(key)) return key.toLowerCase()
  }

  return inSvg && SVG_CASE_SENSITIVE_ATTRIBUTES.has(key) ? key : camelToKebab(key)
}

function stringifyVueComponent(
  component: DevComponent,
  indentLevel = 0,
  isInline?: (tag: string) => boolean
) {
  return stringifyBaseComponent(
    component,
    (key, value, inSvg, isCustomTag) => {
      const eventName = getEventName(key)
      if (eventName) {
        const callback = typeof value === 'string' ? escapeHTML(value) : '() => {}'
        return `@${camelToKebab(eventName)}="${callback.trim()}"`
      }

      // A static __proto__ attribute becomes an object-literal prototype setter.
      const name =
        key === '__proto__' ? "['__proto__']" : getVueAttributeName(key, inSvg, isCustomTag)

      if (typeof value === 'string' && key !== '__proto__') {
        return `${name}="${escapeHTML(value)}"`
      }

      if (typeof value === 'boolean' && key !== '__proto__') {
        if (!inSvg && !isCustomTag && HTML_PRESENCE_BOOLEAN_ATTRIBUTES.has(name)) {
          return value ? name : ''
        }
        if (
          name.startsWith('aria-') ||
          (!inSvg && !isCustomTag && HTML_ENUMERATED_BOOLEAN_ATTRIBUTES.has(name))
        ) {
          return `:${name}="${value}"`
        }
        return value ? name : `:${name}="false"`
      }

      if (typeof value === 'object' && value != null) {
        const pruned = prune(value)
        if (pruned == null) {
          return ''
        }
        return `:${name}="${escapeHTML(stringify(pruned)).trim()}"`
      }

      return `:${name}="${escapeHTML(stringify(value)).trim()}"`
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
        const callback = typeof value === 'string' ? `() => { ${value.trim()} }` : '() => {}'
        return `${key}={${callback}}`
      }

      if (typeof value === 'string' && key !== '__proto__') {
        return `${key}="${escapeHTML(value)}"`
      }

      if (typeof value === 'boolean' && key !== '__proto__') {
        return value ? key : `${key}={false}`
      }

      if (typeof value === 'object' && value != null) {
        value = prune(value)
        if (value == null) {
          return ''
        }
      }

      const expression = stringify(value)
      return key === '__proto__' ? `{...{['__proto__']: ${expression}}}` : `${key}={${expression}}`
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
  while (i < code.length && /\s/.test(code.charAt(i))) i++

  if (code[i] !== '<') return code
  i++

  // Scan Tag Name
  while (i < code.length && /[a-zA-Z0-9\-_:.]/.test(code.charAt(i))) i++
  const tagNameEnd = i

  const existingAttrs = new Map<string, { valueStart: number; valueEnd: number; quote?: string }>()

  while (i < code.length) {
    // Skip whitespace
    while (i < code.length && /\s/.test(code.charAt(i))) i++

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
    while (i < code.length && /[^=\s/>]/.test(code.charAt(i))) i++
    const attrName = code.slice(attrNameStart, i)
    if (!attrName) return code
    const attrNameEnd = i

    // Skip whitespace after name
    while (i < code.length && /\s/.test(code.charAt(i))) i++

    // Check for equals
    if (code[i] === '=') {
      i++ // skip =
      // Skip whitespace after =
      while (i < code.length && /\s/.test(code.charAt(i))) i++

      // Attribute Value
      let quote = ''
      let valueStart = i
      let valueEnd

      if (code[i] === '"' || code[i] === "'") {
        quote = code.charAt(i)
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
        while (i < code.length && /[^>\s]/.test(code.charAt(i))) i++
        valueEnd = i
      }

      existingAttrs.set(attrName, { valueStart, valueEnd, quote })
    } else {
      // Boolean attribute
      existingAttrs.set(attrName, {
        valueStart: attrNameEnd,
        valueEnd: attrNameEnd
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

    if (!existing) {
      insertions.push(` ${key}="${escapeHTML(String(value))}"`)
      continue
    }

    const { valueStart, valueEnd, quote } = existing
    const isClass = key === 'class' || key === 'className'
    // Existing source is already entity-encoded. Escape only the injected value.
    let content = escapeHTML(String(value))
    if (isClass) content = mergeClasses(code.slice(valueStart, valueEnd), content)
    if (quote === "'") content = content.replaceAll("'", '&#39;')
    let replacement = content
    if (!quote) {
      replacement = `"${content}"`
      if (quote === undefined) replacement = `=${replacement}`
    }
    replacements.push({ start: valueStart, end: valueEnd, content: replacement })
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
