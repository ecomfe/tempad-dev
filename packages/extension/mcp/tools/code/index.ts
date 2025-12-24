import type { AssetDescriptor, GetCodeResult } from '@tempad-dev/mcp-shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/mcp-shared'

import { activePlugin } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'

import type { CodeLanguage, RenderContext } from './render'

import { currentCodegenConfig } from '../config'
import { buildVariableMappings, normalizeStyleVars } from '../token/mapping'
import { exportVectorAssets } from './assets/export'
import { planAssets } from './assets/plan'
import { collectNodeData } from './collect'
import { buildGetCodeWarnings, truncateCode } from './messages'
import { renderTree } from './render'
import { sanitizeStyles } from './sanitize'
import { buildLayoutStyles } from './styles'
import {
  applyPluginTransformToNames,
  buildResolvedTokenMap,
  buildSourceNameIndex,
  buildUsedTokens,
  extractTokenNames,
  filterBridge,
  mapResolvedTokens,
  replaceTokensWithValues,
  rewriteTokenNamesInCode
} from './tokens'
import { buildVisibleTree } from './tree'

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

  const tree = buildVisibleTree(nodes)
  const rootId = tree.rootIds[0]
  if (!rootId) {
    throw new Error('No renderable nodes found for the current selection.')
  }
  if (tree.stats.capped) {
    console.warn(
      `[tempad-dev] Selection truncated at depth ${tree.stats.depthLimit ?? tree.stats.maxDepth}.`
    )
  }

  const config = currentCodegenConfig()
  const pluginCode = activePlugin.value?.code

  const mappings = buildVariableMappings(nodes)

  const assetRegistry = new Map<string, AssetDescriptor>()
  const collected = await collectNodeData(tree, config, assetRegistry)

  // Normalize codeSyntax outputs (e.g. "$kui-space-0") before Tailwind conversion.
  const usedCandidateIds = normalizeStyleVars(collected.styles, mappings)

  const plan = planAssets(tree)

  // Post-process styles (negative gap, auto-relative, etc.) after var normalization.
  sanitizeStyles(tree, collected.styles, plan.vectorRoots)
  const layoutStyles = buildLayoutStyles(collected.styles, plan.vectorRoots)
  const svgs = await exportVectorAssets(tree, plan, config, assetRegistry)

  const nodeMap = new Map<string, SceneNode>()
  collected.nodes.forEach((snap, id) => nodeMap.set(id, snap.node))

  const ctx: RenderContext = {
    styles: collected.styles,
    layout: layoutStyles,
    nodes: nodeMap,
    svgs,
    textSegments: collected.textSegments,
    pluginCode,
    config,
    preferredLang
  }

  const componentTree = await renderTree(rootId, tree, ctx)

  if (!componentTree) {
    throw new Error('Unable to build markup for the current selection.')
  }

  const resolvedLang = preferredLang ?? ctx.detectedLang ?? 'jsx'
  const rootTag = collected.nodes.get(rootId)?.tag

  const rawMarkup =
    typeof componentTree === 'string'
      ? normalizeRootString(componentTree, rootTag, rootId, resolvedLang)
      : stringifyComponent(componentTree, {
          lang: resolvedLang,
          isInline: (tag) => COMPACT_TAGS.has(tag)
        })

  const MAX_CODE_CHARS = Math.floor(MCP_MAX_PAYLOAD_BYTES * 0.6)
  let { code, truncated } = truncateCode(rawMarkup, MAX_CODE_CHARS)

  // Token pipeline: detect -> transform -> rewrite -> detect
  const candidateIds = usedCandidateIds.size ? usedCandidateIds : mappings.variableIds
  const variableCache = new Map<string, Variable | null>()
  const sourceIndex = buildSourceNameIndex(candidateIds, variableCache)
  const sourceNames = new Set(sourceIndex.keys())
  const usedNamesRaw = extractTokenNames(code, sourceNames)

  const { rewriteMap, finalBridge } = await applyPluginTransformToNames(
    usedNamesRaw,
    sourceIndex,
    pluginCode,
    config
  )

  code = rewriteTokenNamesInCode(code, rewriteMap)
  if (code.length > MAX_CODE_CHARS) {
    code = code.slice(0, MAX_CODE_CHARS)
    truncated = true
  }

  const usedNamesFinal = extractTokenNames(code, sourceNames)
  const finalBridgeFiltered = filterBridge(finalBridge, usedNamesFinal)

  const { usedTokens, tokensByCanonical, canonicalByFinal } = await buildUsedTokens(
    usedNamesFinal,
    finalBridgeFiltered,
    config,
    pluginCode,
    variableCache
  )

  let resolvedTokens: Record<string, string> | undefined
  if (resolveTokens) {
    const resolvedByFinal = buildResolvedTokenMap(
      usedNamesFinal,
      tokensByCanonical,
      canonicalByFinal
    )
    code = replaceTokensWithValues(code, resolvedByFinal)
    if (code.length > MAX_CODE_CHARS) {
      code = code.slice(0, MAX_CODE_CHARS)
      truncated = true
    }
    resolvedTokens = mapResolvedTokens(resolvedByFinal)
  }

  const warnings = buildGetCodeWarnings(code, MAX_CODE_CHARS, truncated)
  const assets = Array.from(assetRegistry.values())
  const codegen = {
    plugin: activePlugin.value?.name ?? 'none',
    config
  }

  const tokensPayload =
    Object.keys(usedTokens).length || (resolvedTokens && Object.keys(resolvedTokens).length)
      ? {
          ...(Object.keys(usedTokens).length ? { used: usedTokens } : {}),
          ...(resolvedTokens && Object.keys(resolvedTokens).length
            ? { resolved: resolvedTokens }
            : {})
        }
      : undefined

  return {
    lang: resolvedLang,
    code,
    ...(assets.length ? { assets } : {}),
    ...(tokensPayload ? { tokens: tokensPayload } : {}),
    codegen,
    ...(warnings?.length ? { warnings } : {})
  }
}

function normalizeRootString(
  content: string,
  fallbackTag: string | undefined,
  nodeId: string,
  lang: CodeLanguage
) {
  return stringifyComponent(
    {
      name: fallbackTag || 'div',
      props: { 'data-hint-id': nodeId },
      children: [content]
    },
    {
      lang,
      isInline: (tag) => COMPACT_TAGS.has(tag)
    }
  )
}
