import type { SupportedLang, TransformOptions } from '@/plugins/src'
import type { ComponentPropertyValue, DesignComponent, DevComponent } from '@/shared/types'
import type { SelectionNode } from '@/ui/state'

import { camelToKebab } from './string'

export function getDesignComponent(node: SelectionNode) {
  if (!('componentProperties' in node)) {
    return null
  }

  const { name, componentProperties } = node
  const properties: Record<string, ComponentPropertyValue> = {}

  for (const [name, data] of Object.entries(componentProperties)) {
    const key = name.split('#')[0]
    if (data.type === 'INSTANCE_SWAP') {
      const component = figma.getNodeById(data.value as string)
      if (component?.type === 'COMPONENT') {
        properties[key] = { name: component.name, properties: {} }
      }
    } else {
      properties[key] = data.value
    }
  }

  return { name, properties }
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
  stringifyPropEntry: (entry: [key: string, value: unknown]) => string,
  indentLevel = 0
) {
  const indent = INDENT_UNIT.repeat(indentLevel)
  const { name, props, children } = component

  const propItems = Object.entries(props).filter(([, value]) => value != null).map((entry) => stringifyPropEntry(entry))

  const propsString =
    propItems.length === 0
      ? ''
      : propItems.length === 1
        ? ` ${propItems[0]}`
        : `\n${propItems.map((prop) => `${indent + INDENT_UNIT}${prop}`).join('\n')}\n${indent}`

  const childrenString =
    children.length === 0
      ? ''
      : `\n${indent}${children
        .map((child): string => {
          if (typeof child === 'string') {
            return `${indent + INDENT_UNIT}${child}`
          }

          return stringifyBaseComponent(child, stringifyPropEntry, indentLevel + 1)
        })
        .join('\n')}\n${indent}`

  return `${indent}<${name}${propsString}${childrenString ? `>` : ' />'}${childrenString}${childrenString ? `</${name}>` : ''}${indentLevel === 0 ? '\n' : ''}`
}

const EVENT_HANDLER_RE = /^on[A-Z]/

function stringifyVueComponent(component: DevComponent, indentLevel = 0) {
  return stringifyBaseComponent(
    component,
    ([key, value]) => {
      const name = camelToKebab(key)

      if (EVENT_HANDLER_RE.test(key)) {
        return `@${key[2].toLowerCase()}${key.slice(3)}="() => {}"`
      }

      if (typeof value === 'string') {
        return `${name}="${value}"`
      }

      if (typeof value === 'boolean') {
        return value ? name : `:${name}="false"`
      }

      return `:${name}="${JSON.stringify(value)}"`
    },
    indentLevel
  )
}

function stringifyJSXComponent(component: DevComponent, indentLevel = 0) {
  return stringifyBaseComponent(
    component,
    ([key, value]) => {
      if (EVENT_HANDLER_RE.test(key)) {
        return `${key}="{() => {}}`
      }

      if (typeof value === 'string') {
        return `${key}="${value}"`
      }

      if (typeof value === 'boolean') {
        return value ? key : `${key}={false}`
      }

      return `${key}={${JSON.stringify(value)}}`
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
