import type { QuirksNodeProps, StyleRecord } from './types'

import { basicParsers, getBasicCSS } from './basic'
import { fontParsers, getFontCSS } from './font'
import { stackParsers, getStackCSS } from './stack'
import { styleParsers, getStyleCSS } from './style'

const TEMPAD_PLUGIN_ID = '1126010039932614529'

const KV_SECTION_RE = /\n({\s+[\s\S]+?\n})/
const KV_ITEMS_RE = /\n {2}([a-zA-Z0-9-]+): <([\s\S]*?)>(?=\n(?: {2}[a-z]|\}))/g

function parseLog(id: string, log: string) {
  const [, kvStr] = log.match(KV_SECTION_RE) || []

  if (!kvStr) {
    return null
  }

  const props = [...kvStr.matchAll(KV_ITEMS_RE)].reduce<Partial<QuirksNodeProps>>((acc, cur) => {
    const [, key, value] = cur || []

    if (!key || !value) {
      return acc
    }

    const parsedValue = parseTypeAndValue(value)
    if (!parsedValue) {
      return acc
    }

    return {
      ...acc,
      [key]: parsedValue.value
    }
  }, {}) as QuirksNodeProps

  return new QuirksNode(id, props)
}

function parseItem(itemStr: string): [string, string] | null {
  let depth = 0

  for (let i = 0; i < itemStr.length; ++i) {
    switch (itemStr[i]) {
      case '<':
        depth++
        break
      case '>':
        depth--
        break
      case ':':
        if (depth === 0 && itemStr[i - 1] !== ':') {
          return [itemStr.slice(0, i), itemStr.slice(i + 1)]
        }
    }
  }

  return null
}

interface RawValue {
  type: string
  value: string
}

interface ParsedValue {
  type: string
  value: unknown
}

function parseTypeAndValue(raw: string): ParsedValue | null {
  const [type, rawValue] = parseItem(raw) || []

  if (!type || !rawValue) {
    return null
  }

  return {
    type: type,
    value: parseValue({ type, value: rawValue })
  }
}

const parsers: Record<string, ((value: string) => unknown) | undefined> = {
  ...basicParsers,
  ...styleParsers,
  ...stackParsers,
  ...fontParsers,
  PluginData: (str: string) => JSON.parse(str)
}

function parseValue(rawValue: RawValue) {
  const { type, value } = rawValue

  const parser = parsers[type]
  return parser == null ? value : parser(value)
}

export class QuirksNode {
  constructor(id: string, props: QuirksNodeProps) {
    this.id = id
    this.props = props
    this.name = props.name
    this.type = props.type

    this.warning = this.getWarning()
  }

  props: QuirksNodeProps
  private parentCache: QuirksNode | null = null

  id: string
  name: string
  type: NodeType

  warning: string

  get parent(): QuirksNode | null {
    // parent is document or canvas, assume it's the root
    const parentId = this.props['parent-index']
    if (this.props['parent-index']?.startsWith('0:')) {
      return null
    }

    if (!this.parentCache && window.DebuggingHelpers.logNode) {
      this.parentCache = parseLog(parentId, window.DebuggingHelpers.logNode(parentId))
    }

    return this.parentCache
  }

  async getCSSAsync(): Promise<StyleRecord> {
    if (this.type === 'SECTION') {
      return {}
    }
    return this.getCSS()
  }

  getSharedPluginData(namespace: string, key: string) {
    const pluginData = this.props['plugin-data'] || []

    const data = pluginData.find(({ pluginID, key: itemKey }) => {
      return (
        (pluginID === '' && itemKey === `${namespace}-${key}`) ||
        (pluginID === TEMPAD_PLUGIN_ID && itemKey === key)
      )
    })

    return data?.value || ''
  }

  findChild() {
    return null
  }

  private getWarning(): string {
    const { props } = this
    const effectCount = props['effect-data'] || 0
    const hasGradient = [...(props['fill-paint-data'] || []), ...(props['stroke-paint-data'] || [])]
      .filter(Boolean)
      .find((paint) => paint.includes('linear-gradient'))

    const warnings = []
    const unsupported: string[] = []

    if (this.type === 'TEXT') {
      warnings.push(
        '`font-family`, `font-style` and `font-weight` are calculated based on heuristics and may not be accurate.'
      )
    }

    if (effectCount) {
      unsupported.push('effects')
    }

    if (hasGradient) {
      unsupported.push('gradients')
    }

    if (unsupported.length) {
      warnings.push(
        `The node has ${unsupported.join(' and ')} on it, which are not fully supported in quirks mode codegen.`
      )
    }

    return warnings.join('\n\n')
  }

  // Unsupported CSS properties:
  // - background-blend-mode
  // - box-shadow
  // - filter
  // - backdrop-filter
  private getCSS(): StyleRecord {
    return {
      ...getBasicCSS(this.props),
      ...getStackCSS(this.props, this.parent),
      ...getStyleCSS(this.props),
      ...(this.type === 'TEXT' ? getFontCSS(this.props) : {})
    }
  }
}

export class GhostNode {
  constructor(id: string) {
    this.id = id
  }

  id: string
  name: string = '-'
  type: 'GHOST' = 'GHOST'

  async getCSSAsync() {
    return {}
  }
}

const LOG_SEP_RE = /\n*logging node state for (\d+:\d+)\n*/

export function createQuirksSelection(): (QuirksNode | GhostNode)[] {
  if (!window.DebuggingHelpers.logSelected) {
    return []
  }

  const log = window.DebuggingHelpers.logSelected()

  // selected node is document or canvas, means no selection
  if (log.startsWith('logging node state for 0:')) {
    return []
  }

  const parts = log.split(LOG_SEP_RE).filter(Boolean)
  const selectedIds: string[] = []
  const nodeLogs: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] && parts[i + 1]) {
      selectedIds.push(parts[i])
      nodeLogs.push(parts[i + 1])
    }
  }

  if (selectedIds.length > 1) {
    // multiple nodes are selected, no need to parse
    // `id` is necessary for the `scrollAndZoomIntoView` feature
    // when forcing quirks mode with `window.figma` available
    return selectedIds.map((id) => new GhostNode(id))
  }

  return [parseLog(selectedIds[0], nodeLogs[0]) as QuirksNode]
}
