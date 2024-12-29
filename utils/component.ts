import type {
  SupportedLang,
  TransformOptions,
  ComponentPropertyValue,
  DesignNode,
  DesignComponent,
  DevComponent
} from '@/shared/types'
import type { SelectionNode } from '@/ui/state'

import {
  camelToKebab,
  escapeHTML,
  looseEscapeHTML,
  stringify,
  indentAll
} from './string'

export function getDesignComponent(node: SelectionNode): DesignComponent | null {
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
        properties[key] = { name: component.name, type: 'INSTANCE', properties: {}, children: [] }
      }
    } else {
      properties[key] = data.value
    }
  }

  const main = mainComponent ? { id: mainComponent.id, name: mainComponent.name } : null

  return { name, type: 'INSTANCE', properties, mainComponent: main, children: getChildren(node) ?? [] }
}

function getChildren(node: SelectionNode): DesignNode[] | null {
  if (!('children' in node)) {
    return null
  }

  const result: DesignNode[] = []
  for (const child of node.children) {
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
          characters: child.characters
        })
        break
      }
      case 'FRAME':
      case 'GROUP': {
        result.push({
          name: child.name,
          type: child.type,
          children: getChildren(child) ?? []
        })
        break
      }
      default:
        break
    }
  }

  return result
}

function stringifyComponent(component: DevComponent, lang: SupportedLang): string {
  // output as HTML
  switch (lang) {
    case 'vue': {
      return stringifyVueComponent(component)
    }
    case 'jsx':
    case 'tsx':
    default: {
      return stringifyJSXComponent(component)
    }
  }
}

const INDENT_UNIT = '  '

function stringifyBaseComponent(
  component: DevComponent,
  stringifyProp: (key: string, value: unknown) => string,
  indentLevel = 0
) {
  const indent = INDENT_UNIT.repeat(indentLevel)
  const { name, props, children } = component

  const propItems = Object.entries(props)
    .filter(([, value]) => value != null)
    .map((entry) => stringifyProp(...entry))

  const propsString =
    propItems.length === 0
      ? ''
      : propItems.length === 1
        ? ` ${propItems[0]}`
        : `\n${propItems
            .map(
              (prop) =>
                `${indentAll(prop, indent + INDENT_UNIT)}`
            )
            .join('\n')}\n${indent}`

  const childrenString =
    children.length === 0
      ? ''
      : `\n${children
          .map((child): string => {
            if (typeof child === 'string') {
              return `${indent + INDENT_UNIT}${child}`
            }

            return stringifyBaseComponent(child, stringifyProp, indentLevel + 1)
          })
          .join('\n')}\n${indent}`

  return `${indent}<${name}${propsString}${
    childrenString ? `>` : propItems.length > 1 ? '/>' : ' />'
  }${childrenString}${childrenString ? `</${name}>` : ''}${indentLevel === 0 ? '\n' : ''}`
}

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

function stringifyVueComponent(component: DevComponent, indentLevel = 0) {
  return stringifyBaseComponent(
    component,
    (key, value) => {
      const eventName = getEventName(key)
      if (eventName) {
        const callback = typeof value === 'string' ? looseEscapeHTML(value) : '() => {}'
        return `@${camelToKebab(eventName)}="${callback}"`
      }

      const name = camelToKebab(key)

      if (typeof value === 'string') {
        return `${name}="${escapeHTML(value)}"`
      }

      if (typeof value === 'boolean') {
        return value ? name : `:${name}="false"`
      }

      return `:${name}="${looseEscapeHTML(stringify(value))}"`
    },
    indentLevel
  )
}

function stringifyJSXComponent(component: DevComponent, indentLevel = 0) {
  return stringifyBaseComponent(
    component,
    (key, value) => {
      if (EVENT_HANDLER_RE.test(key)) {
        const callback = typeof value === 'string' ? value : '() => {}'
        return `${key}="{${callback}}"`
      }

      if (typeof value === 'string') {
        return `${key}="${escapeHTML(value)}"`
      }

      if (typeof value === 'boolean') {
        return value ? key : `${key}={false}`
      }

      return `${key}={${stringify(value)}}`
    },
    indentLevel
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

    return stringifyComponent(result, lang)
  }

  return ''
}
