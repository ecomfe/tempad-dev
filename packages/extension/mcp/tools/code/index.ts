import type {
  AssetDescriptor,
  GetCodeResult,
  GetTokenDefsResult,
  TokenEntry
} from '@tempad-dev/mcp-shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/mcp-shared'

import { buildSemanticTree } from '@/mcp/semantic-tree'
import { activePlugin } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'
import {
  extractVarNames,
  normalizeCssVarName,
  replaceVarFunctions,
  stripFallback,
  toVarExpr
} from '@/utils/css'

import type { RenderContext, CodeLanguage } from './render'

import { currentCodegenConfig } from '../config'
import { collectCandidateVariableIds, resolveTokenDefsByNames } from '../token'
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

function primaryTokenValue(entry: TokenEntry): string | undefined {
  if (typeof entry.value === 'string') return entry.value
  if (typeof entry.resolvedValue === 'string') return entry.resolvedValue
  if (entry.activeMode && typeof entry.value[entry.activeMode] === 'string') {
    return entry.value[entry.activeMode]
  }
  const first = Object.values(entry.value)[0]
  return typeof first === 'string' ? first : undefined
}

function resolveConcreteValue(
  name: string,
  allTokens: GetTokenDefsResult,
  cache: Map<string, string | undefined>,
  depth = 0
): string | undefined {
  if (cache.has(name)) return cache.get(name)
  if (depth > 20) return undefined

  const entry = allTokens[name]
  if (!entry) {
    cache.set(name, undefined)
    return undefined
  }
  const val = primaryTokenValue(entry)
  if (typeof val !== 'string') {
    cache.set(name, undefined)
    return undefined
  }
  if (val.startsWith('--') && val !== name) {
    const resolved = resolveConcreteValue(val, allTokens, cache, depth + 1) ?? val
    cache.set(name, resolved)
    return resolved
  }
  cache.set(name, val)
  return val
}

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

  const config = currentCodegenConfig()
  const pluginCode = activePlugin.value?.code

  const assetRegistry = new Map<string, AssetDescriptor>()
  const { nodes: nodeMap, styles, svgs } = await collectSceneData(tree.roots, config, assetRegistry)

  const styleVarNames = await applyVariableTransforms(styles, {
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

  // Only include tokens actually referenced in the final output.
  const usedTokenNames = new Set<string>(styleVarNames)
  extractVarNames(markup).forEach((n) => usedTokenNames.add(n))

  const usedTokens = await resolveTokenDefsByNames(usedTokenNames, config, pluginCode, {
    candidateIds: () => collectCandidateVariableIds(nodes).variableIds
  })

  const codegen = {
    preset: activePlugin.value?.name ?? 'none',
    config
  }

  if (resolveTokens) {
    const tokenCache = new Map<string, string | undefined>()
    const tokenMap = new Map<string, string | undefined>()
    Object.keys(usedTokens).forEach((name) => {
      tokenMap.set(name, resolveConcreteValue(name, usedTokens, tokenCache))
    })

    const replaceToken = (input: string): string => {
      // Always strip fallbacks (even if token isn't resolved).
      let out = stripFallback(input)

      // Replace CSS var() functions first (supports whitespace/nesting).
      out = replaceVarFunctions(out, ({ name, full }) => {
        const trimmed = name.trim()
        if (!trimmed.startsWith('--')) return full
        const canonical = `--${normalizeCssVarName(trimmed.slice(2))}`
        const val = tokenMap.get(canonical)
        return typeof val === 'string' ? val : toVarExpr(canonical)
      })

      // replace bare --token (e.g., Tailwind arbitrary value: border-[--foo])
      out = out.replace(/--[A-Za-z0-9-_]+/g, (m) => {
        const val = tokenMap.get(m)
        return typeof val === 'string' ? val : m
      })
      return out
    }

    const resolvedMarkup = replaceToken(markup)
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
