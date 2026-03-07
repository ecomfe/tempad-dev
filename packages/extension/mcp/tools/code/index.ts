import type { AssetDescriptor, GetCodeResult, GetTokenDefsResult } from '@tempad-dev/shared'

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
import {
  assertCodeWithinBudget,
  buildGetCodeWarnings,
  isCodeBudgetExceededError,
  resolveCodeBudget
} from './messages'
import { getOrderedChildIds, renderShellTree, renderTree } from './render'
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

type TraceInfo = {
  now: () => number
  stamp: (label: string, start: number) => void
}

type CollectedContext = {
  styles: Map<string, Record<string, string>>
  textSegments: Map<string, StyledTextSegment[] | null>
}

type AssetPlanContext = {
  vectorRoots: Set<string>
}

type RenderMode =
  | { kind: 'full' }
  | {
      kind: 'shell'
      omittedNodeIds: string[]
    }

type PipelineInput = {
  mode: RenderMode
  rootId: string
  tree: VisibleTree
  ctx: RenderContext
  collected: CollectedContext
  nodeMap: Map<string, SceneNode>
  plan: AssetPlanContext
  rootTag?: string
  lang?: CodeLanguage
  budget: CodeBudget
  variableIds: Set<string>
  usedCandidateIds: Set<string>
  variableCache: Map<string, Variable | null>
  config: CodegenConfig
  pluginCode?: string
  resolveTokens?: boolean
  trace?: TraceInfo
}

type PipelineOutput = {
  code: string
  lang: CodeLanguage
  tokens?: GetTokenDefsResult
}

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
  const codegen = {
    plugin: activePlugin.value?.name ?? 'none',
    config
  }
  const baseInput: Omit<PipelineInput, 'mode'> = {
    rootId,
    tree,
    ctx,
    collected,
    nodeMap,
    plan,
    rootTag,
    lang: preferredLang,
    budget: codeBudget,
    variableIds: mappings.variableIds,
    usedCandidateIds,
    variableCache,
    config,
    pluginCode,
    resolveTokens,
    trace: { now, stamp }
  }
  const allAssets = Array.from(assetRegistry.values())

  try {
    const output = await renderPipeline({
      ...baseInput,
      mode: { kind: 'full' }
    })
    const warnings = buildGetCodeWarnings(output.code, {
      depthLimit: tree.stats.depthLimit,
      cappedNodeIds: tree.stats.cappedNodeIds
    })

    logTrace(
      trace,
      `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${allAssets.length}`
    )

    return buildCodeResult(output, codegen, allAssets, warnings)
  } catch (error) {
    if (!isCodeBudgetExceededError(error)) {
      throw error
    }

    const shellMode = createShellMode(rootId, tree, ctx)
    if (!shellMode) {
      throw error
    }

    const shell = await tryRenderShell({
      ...baseInput,
      mode: shellMode
    })
    if (shell == null) {
      throw error
    }

    const warnings = buildGetCodeWarnings(shell.code, {
      depthLimit: tree.stats.depthLimit,
      cappedNodeIds: tree.stats.cappedNodeIds,
      shell: true
    })
    const assets = filterAssetsReferencedInCode(allAssets, shell.code)

    logTrace(
      trace,
      `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${assets.length} shell`
    )

    return buildCodeResult(shell, codegen, assets, warnings)
  }
}

async function tryRenderShell(input: PipelineInput): Promise<PipelineOutput | null> {
  const rendered = await renderMarkup(input)
  if (!rendered) {
    return null
  }

  try {
    return await finalizeRenderedOutput(input, rendered)
  } catch (error) {
    if (isCodeBudgetExceededError(error)) {
      return null
    }
    throw error
  }
}

function createShellMode(rootId: string, tree: VisibleTree, ctx: RenderContext): RenderMode | null {
  const rootSnapshot = tree.nodes.get(rootId)
  if (!rootSnapshot?.children.length) return null

  const omittedNodeIds = getOrderedChildIds(rootSnapshot, ctx.styles.get(rootId) ?? {}, tree)
  if (!omittedNodeIds.length) return null

  return {
    kind: 'shell',
    omittedNodeIds
  }
}

async function renderPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const rendered = await renderMarkup(input)
  if (!rendered) {
    throw new Error('Unable to build markup for the current selection.')
  }

  return finalizeRenderedOutput(input, rendered)
}

async function finalizeRenderedOutput(
  input: PipelineInput,
  rendered: { code: string; lang: CodeLanguage }
): Promise<PipelineOutput> {
  const {
    code: rewrittenCode,
    tokensByCanonical,
    sourceIndex,
    tokenMatcher,
    resolveNodeIds
  } = await processTokens({
    code: rendered.code,
    budget: input.budget,
    variableIds: input.variableIds,
    usedCandidateIds: input.usedCandidateIds,
    variableCache: input.variableCache,
    styles: input.collected.styles,
    textSegments: input.collected.textSegments,
    config: input.config,
    pluginCode: input.pluginCode,
    resolveTokens: input.resolveTokens,
    stamp: input.trace?.stamp,
    now: input.trace?.now
  })

  let outputCode = rewrittenCode

  if (input.resolveTokens && Object.keys(tokensByCanonical).length) {
    const now = input.trace?.now
    const stamp = input.trace?.stamp
    const t = now ? now() : 0
    const hasTargetNodes = resolveNodeIds ? resolveNodeIds.size > 0 : true
    if (hasTargetNodes) {
      const resolved = await rerenderResolvedOutput({
        ...input,
        lang: rendered.lang,
        sourceIndex,
        resolveNodeIds,
        tokenMatcher
      })
      if (resolved) {
        outputCode = resolved.code
      }
    }
    if (stamp && now) {
      stamp('tokens:resolve', t)
    }
  }

  const tokensPayload = Object.keys(tokensByCanonical).length ? tokensByCanonical : undefined
  return {
    lang: rendered.lang,
    code: outputCode,
    ...(tokensPayload ? { tokens: tokensPayload } : {})
  }
}

async function rerenderResolvedOutput({
  sourceIndex,
  resolveNodeIds,
  tokenMatcher,
  ...input
}: {
  sourceIndex: Map<string, string>
  resolveNodeIds?: Set<string>
  tokenMatcher?: (value: string) => boolean
} & PipelineInput & {
    lang: CodeLanguage
  }): Promise<{ code: string } | null> {
  const resolveStyleVars = createStyleVarResolver(
    sourceIndex,
    input.variableCache,
    input.config,
    resolveNodeIds,
    tokenMatcher
  )
  const resolvedStyles = resolveStyleMap(input.collected.styles, input.nodeMap, resolveStyleVars)
  if (!stylesChanged(input.collected.styles, resolvedStyles)) {
    return null
  }
  const resolvedLayout = buildLayoutStyles(resolvedStyles, input.plan.vectorRoots)
  const resolvedCtx = buildRenderContext({
    ...input.ctx,
    styles: resolvedStyles,
    layout: resolvedLayout,
    resolveStyleVars
  })

  return renderMarkup({
    ...input,
    ctx: resolvedCtx,
    lang: input.lang,
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

async function renderMarkup({
  mode,
  rootId,
  tree,
  ctx,
  rootTag,
  lang,
  budget,
  transform,
  trace
}: PipelineInput & {
  transform?: (markup: string) => string
}): Promise<{ code: string; lang: CodeLanguage } | null> {
  const clock = trace?.now
  let t = clock ? clock() : 0
  const rendered =
    mode.kind === 'shell'
      ? await renderShellTree(rootId, tree, ctx, mode.omittedNodeIds)
      : await renderTree(rootId, tree, ctx)
  if (!rendered) {
    return null
  }
  if (trace && clock) {
    trace.stamp(mode.kind === 'shell' ? 'render:shell' : 'render', t)
  }

  const resolvedLang = lang ?? ctx.detectedLang ?? 'jsx'
  t = clock ? clock() : 0
  const markup = stringifyComponentTree(rendered, rootTag, rootId, resolvedLang)
  if (trace && clock) {
    trace.stamp(mode.kind === 'shell' ? 'stringify:shell' : 'stringify', t)
  }

  t = clock ? clock() : 0
  const output = transform ? transform(markup) : markup
  assertCodeWithinBudget(output, budget)
  if (trace && clock) {
    trace.stamp(mode.kind === 'shell' ? 'budget-check:shell' : 'budget-check', t)
  }
  return { code: output, lang: resolvedLang }
}

function filterAssetsReferencedInCode(assets: AssetDescriptor[], code: string): AssetDescriptor[] {
  return assets.filter((asset) => code.includes(asset.url) || code.includes(asset.hash))
}

function buildCodeResult(
  output: PipelineOutput,
  codegen: GetCodeResult['codegen'],
  assets: AssetDescriptor[],
  warnings?: GetCodeResult['warnings']
): GetCodeResult {
  return {
    lang: output.lang,
    code: output.code,
    ...(assets.length ? { assets } : {}),
    ...(output.tokens ? { tokens: output.tokens } : {}),
    codegen,
    ...(warnings?.length ? { warnings } : {})
  }
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
