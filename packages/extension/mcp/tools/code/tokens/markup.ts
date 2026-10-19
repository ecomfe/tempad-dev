import { raw, RAW_TAG_NAME } from '@tempad-dev/plugins'

import type { DevComponent } from '@/types/plugin'

import { escapeComponentText } from '@/utils/component'
import { readCssName, skipCssLiteral } from '@/utils/css'
import { camelToKebab } from '@/utils/string'

const SVG_STYLE_ATTRIBUTES = new Set([
  'alignment-baseline',
  'baseline-shift',
  'clip',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-profile',
  'color-rendering',
  'cursor',
  'direction',
  'display',
  'dominant-baseline',
  'enable-background',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'glyph-orientation-horizontal',
  'glyph-orientation-vertical',
  'image-rendering',
  'kerning',
  'letter-spacing',
  'marker-end',
  'marker-mid',
  'marker-start',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'opacity',
  'overflow',
  'pointer-events',
  'shape-rendering',
  'solid-color',
  'solid-opacity',
  'clip-path',
  'filter',
  'mask',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'transform',
  'transform-origin',
  'unicode-bidi',
  'vector-effect',
  'visibility',
  'word-spacing',
  'writing-mode',
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd'
])

const NATIVE_SVG = Symbol('native-svg')
type NativeSvgComponent = DevComponent & { [NATIVE_SVG]?: true }

export function nativeSvg(content: string, props?: Record<string, string>): DevComponent {
  return { ...raw(content, props), [NATIVE_SVG]: true } as NativeSvgComponent
}

/** Visit styling values before serialization, while text and literal props remain distinct. */
export function mapTokenValues(
  component: DevComponent,
  transform: (value: string) => string,
  inSvg = false
): DevComponent {
  const isNativeSvg = !!(component as NativeSvgComponent)[NATIVE_SVG]
  const svg = inSvg || component.name === 'svg' || isNativeSvg
  const props = mapProps(component.props, transform, svg)
  if (component.name === RAW_TAG_NAME) {
    if (typeof props.content === 'string') {
      // Exported SVG has XML text nodes; plugin raw() instead opts into code-level processing.
      props.content = isNativeSvg
        ? mapSvgValues(props.content, transform)
        : transform(props.content)
    }
    if (props.injectedProps && typeof props.injectedProps === 'object') {
      props.injectedProps = mapProps(props.injectedProps as Record<string, unknown>, transform, svg)
    }
  }
  return {
    ...component,
    props,
    children: component.children.map((child) =>
      typeof child === 'string'
        ? child
        : mapTokenValues(child, transform, svg && component.name !== 'foreignObject')
    )
  }
}

function mapProps(
  props: Record<string, unknown>,
  transform: (value: string) => string,
  inSvg: boolean
): Record<string, unknown> {
  const transformValue = (value: string) => transformCssValue(value, transform)
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => {
      if (key === 'class' || key === 'className') return [key, mapClasses(value, transformValue)]
      if (key === 'style') return [key, mapStyle(value, transformValue)]
      if (inSvg && SVG_STYLE_ATTRIBUTES.has(camelToKebab(key)) && typeof value === 'string') {
        return [key, transformValue(value)]
      }
      return [key, value]
    })
  )
}

function mapClasses(value: unknown, transform: (value: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((entry) => mapClasses(entry, transform))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, enabled]) => [transform(key), enabled])
    )
  }
  return value
}

function mapStyle(value: unknown, transform: (value: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((entry) => mapStyle(entry, transform))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.startsWith('--') ? transform(key) : key,
        typeof entry === 'string' ? transform(entry) : entry
      ])
    )
  }
  return value
}

function transformCssValue(value: string, transform: (value: string) => string): string {
  // Keep quoted literals opaque, including Tailwind content-["..."] values. Masking
  // lets the transform still remove an outer var(--name, "fallback") as one unit.
  let delimiter = '\0'
  while (value.includes(delimiter)) delimiter += '\0'
  const literals: string[] = []
  let masked = ''
  let copiedUntil = 0
  let index = 0
  while (index < value.length) {
    const ch = value[index]
    let literalEnd: number | undefined
    if (ch === '"' || ch === "'") {
      literalEnd = skipCssLiteral(value, index, ch)
    } else if (ch === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2)
      literalEnd = end < 0 ? value.length : end + 2
    } else {
      const name = readCssName(value, index)
      const end = index + name.length
      // Consume names once; escaped functions share unit conversion's opaque handling.
      if (value[end] === '(' && (name.toLowerCase() === 'url' || name.includes('\\'))) {
        literalEnd = skipCssLiteral(value, end, ')')
      } else {
        index = name ? end : index + 1
        continue
      }
    }
    masked += value.slice(copiedUntil, index) + `${delimiter}${literals.length}${delimiter}`
    literals.push(value.slice(index, literalEnd))
    index = copiedUntil = literalEnd
  }
  masked += value.slice(copiedUntil)
  return transform(masked).replace(
    new RegExp(`${delimiter}(\\d+)${delimiter}`, 'g'),
    (_match, index: string) => literals[Number(index)]!
  )
}

function mapSvgValues(content: string, transform: (value: string) => string): string {
  const document = new DOMParser().parseFromString(content, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg')
    return content
  let changed = false
  const visit = (element: Element, inSvg: boolean) => {
    const svg = inSvg || element.localName === 'svg'
    const original = Object.fromEntries(
      Array.from(element.attributes, ({ name, value }) => [name, value])
    )
    const attributes = mapProps(original, transform, svg) as Record<string, string>
    for (const [key, value] of Object.entries(attributes)) {
      if (value === original[key]) continue
      changed = true
      element.setAttribute(key, value)
    }
    for (const child of element.children) visit(child, svg && element.localName !== 'foreignObject')
  }
  visit(document.documentElement, true)
  const textNodes: CharacterData[] = []
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION
  )
  while (walker.nextNode()) {
    const node = walker.currentNode as CharacterData
    if (node.nodeType === Node.CDATA_SECTION_NODE || /[{}]/.test(node.data)) textNodes.push(node)
  }
  if (!changed && !textNodes.length) return content
  const serializer = new XMLSerializer()
  const serialized = serializer.serializeToString(document.documentElement)
  if (!textNodes.length) return serialized

  // JSX/Vue parse braces as expressions before decoding entities. XML serialization
  // would escape entity ampersands, so restore literal text after serializing placeholders.
  let prefix = '__tempad_svg_text__'
  while (serialized.includes(prefix)) prefix += '_'
  textNodes.forEach((node, index) => {
    node.replaceWith(document.createTextNode(`${prefix}${index}__`))
  })
  return serializer
    .serializeToString(document.documentElement)
    .replace(new RegExp(`${prefix}(\\d+)__`, 'g'), (_match, index: string) =>
      escapeComponentText(textNodes[Number(index)]!.data)
    )
}
