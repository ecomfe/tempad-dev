import type { AssetDescriptor, GetCodeResult } from '@tempad-dev/shared'

import { MCP_MAX_PAYLOAD_BYTES } from '@tempad-dev/shared'

import type { DevComponent } from '@/types/plugin'
import type { CodegenConfig } from '@/utils/codegen'

import { activePlugin } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'
import { simplifyColorMixToRgba } from '@/utils/css'
import { logger } from '@/utils/log'

import type { CodeBudget } from './messages'
import type { VisibleTree } from './model'
import type { CodeLanguage, RenderContext } from './render'
import type { PluginComponent } from './render/plugin'

import { currentCodegenConfig } from '../config'
import { buildVariableMappings } from '../token/mapping'
import { exportVectorAssets } from './assets/export'
import { planAssets } from './assets/plan'
import { collectNodeData } from './collect'
import { assertCodeWithinBudget, buildGetCodeWarnings, resolveCodeBudget } from './messages'
import { renderTree } from './render'
import { resolvePluginComponent } from './render/plugin'
import { buildLayoutStyles, prepareStyles } from './styles'
import { createStyleVarResolver, processTokens, resolveStyleMap } from './tokens'
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
  const trace = createTrace()
  const { now, stamp } = trace

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
    const depth = tree.stats.depthLimit ?? tree.stats.maxDepth
    logger.warn(`[get_code] Tree depth capped at ${depth}; output may be incomplete.`)
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

  const { pluginComponents, pluginSkipped } = pluginCode
    ? await collectPluginOutput(tree, config, pluginCode, preferredLang)
    : { pluginComponents: undefined, pluginSkipped: new Set<string>() }

  const assetRegistry = new Map<string, AssetDescriptor>()
  const skipIds = buildSkipIds(plan.skippedIds, pluginSkipped)
  t = now()
  const collected = await collectNodeData(tree, config, assetRegistry, skipIds)
  stamp('collect', t)

  const { usedCandidateIds, layout: layoutStyles } = prepareStyles({
    tree,
    styles: collected.styles,
    mappings,
    variableCache,
    vectorRoots: plan.vectorRoots,
    trace: { now, stamp }
  })

  t = now()
  const svgs = await exportVectorAssets(tree, plan, config, assetRegistry)
  stamp('export-assets', t)

  const nodeMap = buildNodeMap(collected.nodes)
  const ctx: RenderContext = buildRenderContext({
    styles: collected.styles,
    layout: layoutStyles,
    nodes: nodeMap,
    svgs,
    textSegments: collected.textSegments,
    pluginComponents,
    pluginCode,
    config,
    preferredLang
  })

  const rootTag = collected.nodes.get(rootId)?.tag
  const codeBudget = resolveCodeBudget(MCP_MAX_PAYLOAD_BYTES)

  const { code: rawCode, lang: resolvedLang } = await renderCode({
    rootId,
    tree,
    ctx,
    rootTag,
    lang: preferredLang,
    budget: codeBudget,
    trace: { now, stamp }
  })

  let code = rawCode

  // Token pipeline: detect -> transform -> rewrite -> detect
  const {
    code: rewrittenCode,
    tokensByCanonical,
    sourceIndex,
    tokenMatcher,
    resolveNodeIds
  } = await processTokens({
    code,
    budget: codeBudget,
    variableIds: mappings.variableIds,
    usedCandidateIds,
    variableCache,
    styles: collected.styles,
    textSegments: collected.textSegments,
    config,
    pluginCode,
    resolveTokens,
    stamp,
    now
  })

  code = rewrittenCode

  let outputCode = code
  if (resolveTokens && Object.keys(tokensByCanonical).length) {
    t = now()
    const hasTargetNodes = resolveNodeIds ? resolveNodeIds.size > 0 : true
    if (hasTargetNodes) {
      const resolved = await renderResolvedTokens({
        rootId,
        tree,
        ctx,
        collected,
        nodeMap,
        plan,
        rootTag,
        lang: resolvedLang,
        budget: codeBudget,
        sourceIndex,
        variableCache,
        config,
        resolveNodeIds,
        tokenMatcher
      })
      if (resolved) {
        outputCode = resolved.code
      }
    }
    stamp('tokens:resolve', t)
  }

  const warnings = buildGetCodeWarnings(outputCode, {
    depthLimit: tree.stats.depthLimit,
    cappedNodeIds: tree.stats.cappedNodeIds
  })
  const assets = Array.from(assetRegistry.values())
  const codegen = {
    plugin: activePlugin.value?.name ?? 'none',
    config
  }

  const tokensPayload = Object.keys(tokensByCanonical).length ? tokensByCanonical : undefined

  logTrace(
    trace,
    `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${assetRegistry.size}`
  )

  return {
    lang: resolvedLang,
    code: outputCode,
    ...(assets.length ? { assets } : {}),
    ...(tokensPayload ? { tokens: tokensPayload } : {}),
    codegen,
    ...(warnings?.length ? { warnings } : {})
  }
}

async function renderResolvedTokens({
  rootId,
  tree,
  ctx,
  collected,
  nodeMap,
  plan,
  rootTag,
  lang,
  budget,
  sourceIndex,
  variableCache,
  config,
  resolveNodeIds,
  tokenMatcher
}: {
  rootId: string
  tree: VisibleTree
  ctx: RenderContext
  collected: {
    styles: Map<string, Record<string, string>>
  }
  nodeMap: Map<string, SceneNode>
  plan: { vectorRoots: Set<string> }
  rootTag?: string
  lang: CodeLanguage
  budget: CodeBudget
  sourceIndex: Map<string, string>
  variableCache: Map<string, Variable | null>
  config: CodegenConfig
  resolveNodeIds?: Set<string>
  tokenMatcher?: (value: string) => boolean
}): Promise<{ code: string } | null> {
  const resolveStyleVars = createStyleVarResolver(
    sourceIndex,
    variableCache,
    config,
    resolveNodeIds,
    tokenMatcher
  )
  const resolvedStyles = resolveStyleMap(collected.styles, nodeMap, resolveStyleVars)
  if (!stylesChanged(collected.styles, resolvedStyles)) {
    return null
  }
  const resolvedLayout = buildLayoutStyles(resolvedStyles, plan.vectorRoots)
  const resolvedCtx = buildRenderContext({
    ...ctx,
    styles: resolvedStyles,
    layout: resolvedLayout,
    resolveStyleVars
  })

  return renderCode({
    rootId,
    tree,
    ctx: resolvedCtx,
    rootTag,
    lang,
    budget,
    transform: simplifyColorMixToRgba
  })
}

function stylesChanged(
  original: Map<string, Record<string, string>>,
  resolved: Map<string, Record<string, string>>
): boolean {
  if (original === resolved) return false
  for (const [id, style] of resolved.entries()) {
    if (style !== original.get(id)) return true
  }
  return false
}

async function collectPluginOutput(
  tree: VisibleTree,
  config: CodegenConfig,
  pluginCode: string,
  preferredLang?: CodeLanguage
): Promise<{
  pluginComponents: Map<string, PluginComponent | null>
  pluginSkipped: Set<string>
}> {
  const pluginComponents = new Map<string, PluginComponent | null>()
  for (const id of tree.order) {
    const snapshot = tree.nodes.get(id)
    if (!snapshot) continue
    if (snapshot.node.type !== 'INSTANCE') continue
    const component = await resolvePluginComponent(snapshot.node, config, pluginCode, preferredLang)
    pluginComponents.set(id, component)
  }
  const pluginSkipped = new Set<string>()

  if (pluginComponents.size) {
    for (const [id, component] of pluginComponents.entries()) {
      if (!component) continue
      const snapshot = tree.nodes.get(id)
      if (!snapshot) continue
      snapshot.children.forEach((childId) => skipDescendants(childId, tree, pluginSkipped))
    }
  }

  return { pluginComponents, pluginSkipped }
}

function skipDescendants(id: string, tree: VisibleTree, skipped: Set<string>): void {
  const node = tree.nodes.get(id)
  if (!node) return
  if (skipped.has(id)) return
  skipped.add(id)
  node.children.forEach((childId) => skipDescendants(childId, tree, skipped))
}

function buildSkipIds(base: Set<string>, extra: Set<string>): Set<string> {
  if (!base.size && !extra.size) return base
  if (!extra.size) return base
  if (!base.size) return extra
  return new Set<string>([...base, ...extra])
}

function buildNodeMap(nodes: Map<string, { node: SceneNode }>): Map<string, SceneNode> {
  const out = new Map<string, SceneNode>()
  nodes.forEach((snap, id) => out.set(id, snap.node))
  return out
}

function buildRenderContext({
  styles,
  layout,
  nodes,
  svgs,
  textSegments,
  pluginComponents,
  pluginCode,
  config,
  preferredLang,
  resolveStyleVars
}: RenderContext): RenderContext {
  return {
    styles,
    layout,
    nodes,
    svgs,
    textSegments,
    pluginComponents,
    pluginCode,
    config,
    preferredLang,
    resolveStyleVars
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

function stringifyComponentTree(
  component: DevComponent | string,
  rootTag: string | undefined,
  nodeId: string,
  lang: CodeLanguage
) {
  if (typeof component === 'string') {
    return normalizeRootString(component, rootTag, nodeId, lang)
  }
  return stringifyComponent(component, {
    lang,
    isInline: (tag) => COMPACT_TAGS.has(tag)
  })
}

async function renderCode({
  rootId,
  tree,
  ctx,
  rootTag,
  lang,
  budget,
  transform,
  trace
}: {
  rootId: string
  tree: VisibleTree
  ctx: RenderContext
  rootTag?: string
  lang?: CodeLanguage
  budget: CodeBudget
  transform?: (markup: string) => string
  trace?: { now: () => number; stamp: (label: string, start: number) => void }
}): Promise<{ code: string; lang: CodeLanguage }> {
  const clock = trace?.now
  let t = clock ? clock() : 0
  const rendered = await renderTree(rootId, tree, ctx)
  if (!rendered) {
    throw new Error('Unable to build markup for the current selection.')
  }
  if (trace && clock) trace.stamp('render', t)

  const resolvedLang = lang ?? ctx.detectedLang ?? 'jsx'
  t = clock ? clock() : 0
  const markup = stringifyComponentTree(rendered, rootTag, rootId, resolvedLang)
  if (trace && clock) trace.stamp('stringify', t)

  t = clock ? clock() : 0
  const output = transform ? transform(markup) : markup
  assertCodeWithinBudget(output, budget)
  if (trace && clock) trace.stamp('budget-check', t)
  return { code: output, lang: resolvedLang }
}

function createTrace() {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = now()
  const timings: Array<[string, number]> = []
  const stamp = (label: string, start: number) => {
    const elapsed = Math.round((now() - start) * 10) / 10
    timings.push([label, elapsed])
  }

  return { now, startedAt, timings, stamp }
}

function logTrace(
  trace: { now: () => number; startedAt: number; timings: Array<[string, number]> },
  info: string
) {
  const elapsed = Math.round((trace.now() - trace.startedAt) * 10) / 10
  logger.debug(`get_code total ${elapsed}ms`)
  if (trace.timings.length) {
    const detail = trace.timings.map(([label, ms]) => `${label}=${ms}ms`).join(' ')
    logger.debug(`get_code timings ${detail} (${info})`)
  }
}
