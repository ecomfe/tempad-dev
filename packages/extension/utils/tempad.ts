import { logger } from '@/utils/log'

type TemPadComponent = {
  code: string
  name?: string
  libName?: string
  libDisplayName?: string
  link: string | null
}

type TemPadSource = {
  name?: string
  libName?: string
}

const NS = 'tempad.baidu.com'
const CODE_TEXT_NODE_NAME = 'Code'
const LINK_TEXT_NODE_NAME = '🔗'

const LIB_DISPLAY_NAMES: Record<string, string> = {
  '@baidu/one-ui': 'ONE UI',
  '@baidu/one-ui-pro': 'ONE UI Pro',
  '@baidu/one-charts': 'ONE Charts',
  '@baidu/light-ai-react': 'Light AI',
  'dls-icons-react': 'DLS Icons',
  'dls-illustrations-react': 'DLS Illus.'
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object'
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseTemPadSource(raw: string): TemPadSource | null {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return null

  const source: TemPadSource = {}
  if ('name' in parsed && typeof parsed.name === 'string') {
    source.name = parsed.name
  }
  if ('libName' in parsed && typeof parsed.libName === 'string') {
    source.libName = parsed.libName
  }

  return source
}

function toRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null
}

function toString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readIconMeta(tree: unknown): { libName?: string; name?: string } | null {
  const treeRecord = toRecord(tree)
  if (!treeRecord) return null

  const slots = toRecord(treeRecord.slots)
  const defaultSlot = toRecord(slots?.default)
  const children = Array.isArray(defaultSlot?.children) ? defaultSlot.children : null
  if (!children || children.length === 0) return null

  const iconNode = toRecord(children[0])
  const props = toRecord(iconNode?.props)
  if (!props) return null

  const libName = toString(toRecord(props.libName)?.v)
  const rawName = toRecord(props.name)?.v
  const nameFromObject = toString(toRecord(rawName)?.name)
  const name = nameFromObject ?? toString(rawName)

  if (!libName && !name) return null
  return {
    ...(libName ? { libName } : {}),
    ...(name ? { name } : {})
  }
}

function findTextChild(node: FrameNode, name: string): TextNode | null {
  const child = node.findChild((candidate) => candidate.type === 'TEXT' && candidate.name === name)
  return child?.type === 'TEXT' ? child : null
}

function getHyperlinkValue(target: unknown): string | null {
  if (!isRecord(target)) return null
  return typeof target.value === 'string' ? target.value : null
}

export function getTemPadComponent(node: SceneNode): TemPadComponent | null {
  if (node.type !== 'FRAME' || !node.name.startsWith('🧩')) {
    return null
  }

  const tempadData = parseTemPadSource(node.getSharedPluginData(NS, 'source') || 'null')

  if (
    tempadData?.libName === '@baidu/one-ui' &&
    (tempadData.name === 'Icon' || tempadData.name === 'Illustration')
  ) {
    const tree = parseJson(node.getSharedPluginData(NS, 'tree') || 'null')
    try {
      const iconMeta = readIconMeta(tree)
      if (iconMeta) {
        if (tempadData.name === 'Illustration') {
          tempadData.libName = 'dls-illustrations-react'
        } else if (iconMeta.libName) {
          tempadData.libName = iconMeta.libName
        }
        if (iconMeta.name) {
          tempadData.name = iconMeta.name
        }
      }
    } catch (error) {
      logger.error(error)
    }
  } else if (tempadData?.name === 'Tem.RichText') {
    tempadData.name = 'Typography'
    tempadData.libName = '@baidu/light-ai-react'
  }

  const libDisplayName =
    tempadData?.libName && tempadData.libName in LIB_DISPLAY_NAMES
      ? LIB_DISPLAY_NAMES[tempadData.libName]
      : null

  let code = node.getSharedPluginData(NS, 'code') || null
  let link = node.getSharedPluginData(NS, 'link') || null

  if (!code) {
    code = findTextChild(node, CODE_TEXT_NODE_NAME)?.characters ?? null
  }
  if (!link) {
    link = getHyperlinkValue(findTextChild(node, LINK_TEXT_NODE_NAME)?.hyperlink)
  }

  if (!code) {
    return null
  }

  return {
    code: extractJSX(code),
    link,
    name: node.name,
    ...tempadData,
    ...(libDisplayName ? { libDisplayName } : {})
  }
}

const COMPONENT_RE = /<>[\s\n]+<Stack[^>]*>[\s\n]+?(\s*)([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/>/
const COMPONENT_PROVIDER_RE =
  /<ProviderConfig[^>]*>[\s\n]+<Stack[^>]*>[\s\n]+?(\s*)([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/ProviderConfig>/

export function extractJSX(code: string) {
  const [, indent = '', jsx = ''] =
    code.match(COMPONENT_RE) || code.match(COMPONENT_PROVIDER_RE) || []

  return jsx
    .split('\n')
    .map((line) => line.replace(new RegExp(`^${indent}`), ''))
    .join('\n')
}
