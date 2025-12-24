import type { CodegenConfig } from '@/utils/codegen'

import { joinClassNames } from '@/utils/tailwind'

import type { DataHint } from '../model'

import { styleToClassNames } from '../styles'

export function classProps(
  style: Record<string, string>,
  config: CodegenConfig,
  defaultClassProp: 'class' | 'className',
  dataHint: DataHint | undefined,
  options: { isFallback?: boolean; includeDataHint?: boolean } = {}
) {
  const classNames = styleToClassNames(style, config)
  const props: Record<string, string> = {}

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
