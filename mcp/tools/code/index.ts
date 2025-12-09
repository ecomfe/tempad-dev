import type { AssetDescriptor, GetCodeResult } from '@/mcp-server/src/tools'
import type { CodegenConfig } from '@/utils/codegen'

import { buildSemanticTree } from '@/mcp/semantic-tree'
import { MCP_MAX_PAYLOAD_BYTES } from '@/mcp/shared/constants'
import { activePlugin, options } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'

import type { RenderContext, CodeLanguage } from './render'

import { collectTokenReferences, resolveVariableTokens } from '../token-defs'
import { collectSceneData } from './collect'
import { buildGetCodeMessage } from './messages'
import { renderSemanticNode } from './render'
import { applyVariableTransforms } from './style'

// Tags that should render children without extra whitespace/newlines.
const COMPACT_TAGS = new Set([
  'a',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'code',
  'br',
  'wbr',
  'small',
  'sub',
  'sup',
  'label',
  'time',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'dt',
  'dd',
  'th',
  'td',
  'caption',
  'figcaption',
  'summary'
])

export async function handleGetCode(
  nodes: SceneNode[],
  preferredLang?: CodeLanguage,
  resolveTokens?: boolean
): Promise<GetCodeResult> {
  if (nodes.length !== 1) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  const node = nodes[0]
  if (!node.visible) {
    throw new Error('The selected node is not visible.')
  }

  const tree = buildSemanticTree(nodes)
  const root = tree.roots[0]
  if (!root) {
    throw new Error('No renderable nodes found for the current selection.')
  }

  const config = codegenConfig()
  const pluginCode = activePlugin.value?.code

  const assetRegistry = new Map<string, AssetDescriptor>()
  const { nodes: nodeMap, styles, svgs } = await collectSceneData(tree.roots, config, assetRegistry)

  await applyVariableTransforms(styles, {
    pluginCode,
    config
  })

  const ctx: RenderContext = {
    styles,
    nodes: nodeMap,
    svgs,
    pluginCode,
    config,
    preferredLang
  }

  const componentTree = await renderSemanticNode(root, ctx)

  if (!componentTree) {
    throw new Error('Unable to build markup for the current selection.')
  }

  const resolvedLang = preferredLang ?? ctx.detectedLang ?? 'jsx'

  const rawMarkup =
    typeof componentTree === 'string'
      ? normalizeRootString(componentTree, root.tag, resolvedLang)
      : stringifyComponent(componentTree, {
          lang: resolvedLang,
          isInline: (tag) => COMPACT_TAGS.has(tag)
        })

  const MAX_CODE_CHARS = Math.floor(MCP_MAX_PAYLOAD_BYTES * 0.6)
  const { markup, message } = buildGetCodeMessage(rawMarkup, MAX_CODE_CHARS, tree.stats)

  const { variableIds } = collectTokenReferences(nodes)
  const allTokens = await resolveVariableTokens(variableIds, config, pluginCode)

  const usedTokenNames = new Set<string>()
  // Use a simple regex to capture all var(--name) occurrences, including nested ones.
  // We don't use CSS_VAR_FUNCTION_RE because it consumes the whole function and might miss nested vars in fallbacks.
  const regex = /var\(--([a-zA-Z0-9-_]+)/g
  let match
  while ((match = regex.exec(markup))) {
    usedTokenNames.add(`--${match[1]}`)
  }

  const usedTokens = allTokens.filter((t) => usedTokenNames.has(t.name))

  const codegen = {
    preset: activePlugin.value?.name ?? 'none',
    config
  }

  if (resolveTokens) {
    const tokenMap = new Map(usedTokens.map((t) => [t.name, t.value]))
    const resolvedMarkup = markup.replace(/var\((--[a-zA-Z0-9-_]+)\)/g, (match, name) => {
      const val = tokenMap.get(name)
      return typeof val === 'string' ? val : match
    })
    // If tokens are resolved, we don't need to return the token definitions
    return {
      lang: resolvedLang,
      code: resolvedMarkup,
      assets: Array.from(assetRegistry.values()),
      codegen,
      ...(message ? { message } : {})
    }
  }

  return {
    lang: resolvedLang,
    code: markup,
    assets: Array.from(assetRegistry.values()),
    usedTokens,
    codegen,
    ...(message ? { message } : {})
  }
}

function normalizeRootString(content: string, fallbackTag: string | undefined, lang: CodeLanguage) {
  return stringifyComponent(
    {
      name: fallbackTag || 'div',
      props: {},
      children: [content]
    },
    {
      lang,
      isInline: (tag) => COMPACT_TAGS.has(tag)
    }
  )
}

function codegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}
