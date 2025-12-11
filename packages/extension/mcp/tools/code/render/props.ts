import type { DataHint } from '@/mcp/semantic-tree'
import type { CodegenConfig } from '@/utils/codegen'

import { joinClassNames } from '@/utils/tailwind'

import { styleToClassNames } from '../style'

export function buildClassProps(
  style: Record<string, string>,
  config: CodegenConfig,
  defaultClassProp: 'class' | 'className',
  dataHint: DataHint | undefined,
  node: SceneNode,
  options: { isFallback?: boolean } = {}
) {
  const classNames = styleToClassNames(style, config, node)
  const props: Record<string, string> = {}

  if (classNames.length) props[defaultClassProp] = joinClassNames(classNames)

  const hasLayoutDisplay = (() => {
    const display = style.display?.toLowerCase()
    if (display && /flex|grid/.test(display)) return true
    return classNames.some(
      (c) => c === 'flex' || c === 'inline-flex' || c === 'grid' || c === 'inline-grid'
    )
  })()

  if (dataHint) {
    Object.entries(dataHint).forEach(([key, val]) => {
      if (!val || !String(val).trim()) return
      // Only inject layout hint when we are not using plugin-provided component (i.e., fallback)
      if (key === 'data-hint-auto-layout' && (options.isFallback !== true || !hasLayoutDisplay))
        return
      props[key] = String(val)
    })

    if (props['data-hint-auto-layout']) {
      props['data-hint-node-id'] = node.id
    }
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

const CHILD_LAYOUT_PROPS = new Set([
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-self',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height'
])

export function pickChildLayoutStyles(style: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (CHILD_LAYOUT_PROPS.has(k)) picked[k] = v
  }
  return picked
}

export function getClassPropName(lang?: 'jsx' | 'vue'): 'class' | 'className' {
  return lang === 'vue' ? 'class' : 'className'
}

export function mergeClasses(c1: string, c2: string): string {
  const s = new Set([...c1.split(/\s+/), ...c2.split(/\s+/)])
  s.delete('')
  return Array.from(s).join(' ')
}
