import type { CodegenConfig } from '@/utils/codegen'

import { normalizeStyleValues } from '@/utils/css'
import { camelToKebab, kebabToCamel } from '@/utils/string'
import { joinClassNames } from '@/utils/tailwind'

import type { DataHint } from '../model'

import { styleToClassNames } from '../styles'

export type RenderProps = Record<string, string | Record<string, string>>

export function classProps(
  style: Record<string, string>,
  config: CodegenConfig,
  defaultClassProp: 'class' | 'className',
  dataHint: DataHint | undefined,
  options: { isFallback?: boolean; includeDataHint?: boolean } = {}
) {
  let classStyle = style
  const props: RenderProps = {}
  if (style.background?.trim()) {
    // Keep quoted URLs out of Tailwind's source scanner and keep the shorthand before
    // its longhand overrides without depending on generated utility order.
    classStyle = { ...style }
    const background: Record<string, string> = { background: style.background }
    delete classStyle.background
    for (const [key, value] of Object.entries(style)) {
      if (!key.startsWith('background-')) continue
      if (value.trim()) background[key] = value
      delete classStyle[key]
    }
    props.style = Object.fromEntries(
      Object.entries(normalizeStyleValues(background, config)).map(([key, value]) => [
        kebabToCamel(key),
        value
      ])
    )
  }
  const classNames = styleToClassNames(classStyle, config)

  if (classNames.length) props[defaultClassProp] = joinClassNames(classNames)

  const includeHints = options.includeDataHint !== false

  if (includeHints && dataHint) {
    const hasLayoutDisplay = (() => {
      const display = style.display?.toLowerCase()
      if (display && /flex|grid/.test(display)) return true
      return classNames.some(
        (c) => c === 'flex' || c === 'inline-flex' || c === 'grid' || c === 'inline-grid'
      )
    })()

    Object.entries(dataHint).forEach(([key, val]) => {
      if (!val || !String(val).trim()) return
      if (key === 'data-hint-auto-layout' && (options.isFallback !== true || !hasLayoutDisplay)) {
        return
      }
      props[key] = String(val)
    })
  }

  return { classNames, props }
}

export function toMarkupAttributes(props: RenderProps): Record<string, string> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? value
        : Object.entries(value)
            .map(([property, entry]) => `${camelToKebab(property)}: ${entry}`)
            .join('; ')
    ])
  )
}

export function filterGridProps(style: Record<string, string>): Record<string, string> {
  const res: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (
      k === 'grid-row' ||
      k === 'grid-column' ||
      k === 'grid-area' ||
      k === 'grid-row-start' ||
      k === 'grid-row-end' ||
      k === 'grid-column-start' ||
      k === 'grid-column-end'
    ) {
      continue
    }
    res[k] = v
  }
  return res
}

export function classProp(lang?: 'jsx' | 'vue'): 'class' | 'className' {
  return lang === 'vue' ? 'class' : 'className'
}

export function mergeClass(c1: string, c2: string): string {
  const s = new Set([...c1.split(/\s+/), ...c2.split(/\s+/)])
  s.delete('')
  return joinClassNames(Array.from(s))
}
