import type { AssetDescriptor, GetCodeResult } from '@tempad-dev/mcp-shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { activePlugin } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'
import { simplifyColorMixToRgba } from '@/utils/css'

import type { VisibleTree } from './model'
import type { CodeLanguage, RenderContext } from './render'

import { currentCodegenConfig } from '../config'
import { buildVariableMappings, normalizeStyleVars } from '../token/mapping'
import { exportVectorAssets } from './assets/export'
import { planAssets } from './assets/plan'
import { collectNodeData } from './collect'
import { buildGetCodeWarnings, truncateCode } from './messages'
import { renderTree } from './render'
import { resolvePluginComponent, type PluginComponent } from './render/plugin'
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
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = now()
  const timings: Array<[string, number]> = []
  const stamp = (label: string, start: number) => {
    const elapsed = Math.round((now() - start) * 10) / 10
    timings.push([label, elapsed])
  }

  if (nodes.length !== 1) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  const node = nodes[0]
  if (!node.visible) {
    throw new Error('The selected node is not visible.')
  }

  let t = now()
  const tree = buildVisibleTree(nodes)
  stamp('tree', t)
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

  t = now()
  const variableCache = new Map<string, Variable | null>()
  const mappings = buildVariableMappings(nodes, variableCache)
  stamp('vars', t)

  t = now()
  const plan = planAssets(tree)
  stamp('plan-assets', t)

  let pluginComponents: Map<string, PluginComponent | null> | undefined
  const pluginSkipped = new Set<string>()
  if (pluginCode) {
    pluginComponents = await collectPluginComponents(tree, config, pluginCode, preferredLang)
    if (pluginComponents.size) {
      for (const [id, component] of pluginComponents.entries()) {
        if (!component) continue
        const snapshot = tree.nodes.get(id)
        if (!snapshot) continue
        snapshot.children.forEach((childId) => skipDescendants(childId, tree, pluginSkipped))
      }
    }
  }

  const assetRegistry = new Map<string, AssetDescriptor>()
  const skipIds =
    plan.skippedIds.size || pluginSkipped.size
      ? new Set<string>([...plan.skippedIds, ...pluginSkipped])
      : plan.skippedIds
  t = now()
  const collected = await collectNodeData(tree, config, assetRegistry, skipIds)
  stamp('collect', t)

  // Normalize codeSyntax outputs (e.g. "$kui-space-0") before Tailwind conversion.
  t = now()
  const usedCandidateIds = normalizeStyleVars(collected.styles, mappings, variableCache)
  stamp('normalize-vars', t)

  // Post-process styles (negative gap, auto-relative, etc.) after var normalization.
  t = now()
  sanitizeStyles(tree, collected.styles, plan.vectorRoots)
  const layoutStyles = buildLayoutStyles(collected.styles, plan.vectorRoots)
  stamp('layout', t)

  t = now()
  const svgs = await exportVectorAssets(tree, plan, config, assetRegistry)
  stamp('export-assets', t)

  const nodeMap = new Map<string, SceneNode>()
  collected.nodes.forEach((snap, id) => nodeMap.set(id, snap.node))

  const ctx: RenderContext = {
    styles: collected.styles,
    layout: layoutStyles,
    nodes: nodeMap,
    svgs,
    textSegments: collected.textSegments,
    pluginComponents,
    pluginCode,
    config,
    preferredLang
  }

  t = now()
  const componentTree = await renderTree(rootId, tree, ctx)
  stamp('render', t)

  if (!componentTree) {
    throw new Error('Unable to build markup for the current selection.')
  }

  const resolvedLang = preferredLang ?? ctx.detectedLang ?? 'jsx'
  const rootTag = collected.nodes.get(rootId)?.tag

  t = now()
  const rawMarkup =
    typeof componentTree === 'string'
      ? normalizeRootString(componentTree, rootTag, rootId, resolvedLang)
      : stringifyComponent(componentTree, {
          lang: resolvedLang,
          isInline: (tag) => COMPACT_TAGS.has(tag)
        })
  stamp('stringify', t)

  t = now()
  const MAX_CODE_CHARS = Math.floor(MCP_MAX_PAYLOAD_BYTES * 0.6)
  let { code, truncated } = truncateCode(rawMarkup, MAX_CODE_CHARS)
  stamp('truncate', t)

  // Token pipeline: detect -> transform -> rewrite -> detect
  const candidateIds = usedCandidateIds.size
    ? new Set<string>([...mappings.variableIds, ...usedCandidateIds])
    : mappings.variableIds
  t = now()
  const sourceIndex = buildSourceNameIndex(candidateIds, variableCache)
  const sourceNames = new Set(sourceIndex.keys())
  const usedNamesRaw = extractTokenNames(code, sourceNames)
  stamp('tokens:detect', t)

  t = now()
  const { rewriteMap, finalBridge } = await applyPluginTransformToNames(
    usedNamesRaw,
    sourceIndex,
    pluginCode,
    config
  )

  let hasRenames = false
  for (const [key, next] of rewriteMap) {
    if (key !== next) {
      hasRenames = true
      break
    }
  }

  code = rewriteTokenNamesInCode(code, rewriteMap)
  if (code.length > MAX_CODE_CHARS) {
    code = code.slice(0, MAX_CODE_CHARS)
    truncated = true
  }

  const usedNamesFinal = hasRenames ? extractTokenNames(code, sourceNames) : usedNamesRaw
  const finalBridgeFiltered = hasRenames ? filterBridge(finalBridge, usedNamesFinal) : finalBridge
  stamp('tokens:rewrite', t)

  t = now()
  const { usedTokens, tokensByCanonical, canonicalById } = await buildUsedTokens(
    usedNamesFinal,
    finalBridgeFiltered,
    config,
    pluginCode,
    variableCache
  )
  stamp('tokens:used', t)

  let resolvedTokens: Record<string, string> | undefined
  if (resolveTokens) {
    t = now()
    const resolvedByFinal = buildResolvedTokenMap(
      finalBridgeFiltered,
      tokensByCanonical,
      canonicalById
    )
    code = replaceTokensWithValues(code, resolvedByFinal)
    code = simplifyColorMixToRgba(code)
    if (code.length > MAX_CODE_CHARS) {
      code = code.slice(0, MAX_CODE_CHARS)
      truncated = true
    }
    resolvedTokens = mapResolvedTokens(resolvedByFinal)
    stamp('tokens:resolve', t)
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

  const elapsed = Math.round((now() - startedAt) * 10) / 10
  console.info(`[tempad-dev] get_code total ${elapsed}ms`)
  if (timings.length) {
    const detail = timings.map(([label, ms]) => `${label}=${ms}ms`).join(' ')
    const info = `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${assetRegistry.size}`
    console.info(`[tempad-dev] get_code timings ${detail} (${info})`)
  }

  return {
    lang: resolvedLang,
    code,
    ...(assets.length ? { assets } : {}),
    ...(tokensPayload ? { tokens: tokensPayload } : {}),
    codegen,
    ...(warnings?.length ? { warnings } : {})
  }
}

async function collectPluginComponents(
  tree: VisibleTree,
  config: CodegenConfig,
  pluginCode: string,
  preferredLang?: CodeLanguage
): Promise<Map<string, PluginComponent | null>> {
  const out = new Map<string, PluginComponent | null>()
  for (const id of tree.order) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue
    if (snapshot.node.type !== 'INSTANCE') continue
    const component = await resolvePluginComponent(snapshot.node, config, pluginCode, preferredLang)
    out.set(id, component)
  }
  return out
}

function skipDescendants(id: string, tree: VisibleTree, skipped: Set<string>): void {
  const node = tree.nodes.get(id)
  if (!node) return
  if (skipped.has(id)) return
  skipped.add(id)
  node.children.forEach((childId) => skipDescendants(childId, tree, skipped))
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
