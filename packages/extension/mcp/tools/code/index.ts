import type {
  AssetDescriptor,
  GetCodeParametersInput,
  GetCodeResult,
  GetTokenDefsResult
} from '@tempad-dev/shared'

import { buildGetCodeToolResult } from '@tempad-dev/shared'

import type { DevComponent } from '@/types/plugin'
import type { CodegenConfig } from '@/utils/codegen'

import { activePlugin } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'
import { simplifyColorMixToRgba } from '@/utils/css'
import { logger } from '@/utils/log'

import type { SvgEntry } from './assets'
import type { VisibleTree } from './model'
import type { CodeLanguage, RenderContext } from './render'
import type { PluginComponent } from './render/plugin'

import { currentCodegenConfig } from '../config'
import { buildVariableMappings } from '../token/mapping'
import { exportVectorAssets } from './assets/export'
import { planAssets } from './assets/plan'
import { createGetCodeCacheContext } from './cache'
import { collectNodeData } from './collect'
import {
  assertToolResponseWithinBudget,
  buildGetCodeWarnings,
  isCodeBudgetExceededError,
  resolveCodeBudget,
  resolveUnlimitedCodeBudget
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

type RenderMode =
  | { kind: 'full' }
  | {
      kind: 'shell'
      omittedNodeIds: string[]
    }

type ShellMode = Extract<RenderMode, { kind: 'shell' }>

type PipelineInput = {
  mode: RenderMode
  rootId: string
  tree: VisibleTree
  ctx: RenderContext
  collected: CollectedContext
  nodeMap: Map<string, SceneNode>
  vectorRoots: Set<string>
  rootTag?: string
  lang?: CodeLanguage
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

export type GetCodeRuntimeOptions = {
  unbounded?: boolean
}

type GetCodeRequestArgs = Pick<
  GetCodeParametersInput,
  'preferredLang' | 'resolveTokens' | 'vectorMode'
>

type RenderStep = 'render' | 'stringify' | 'transform'

export async function handleGetCode(
  nodes: SceneNode[],
  preferredLang?: CodeLanguage,
  resolveTokens?: boolean,
  vectorMode: GetCodeParametersInput['vectorMode'] = 'smart',
  runtimeOptions: GetCodeRuntimeOptions = {}
): Promise<GetCodeResult> {
  const trace = createTrace()
  const { now, stamp } = trace
  const traceInfo: TraceInfo = { now, stamp }

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
  const cache = createGetCodeCacheContext(variableCache, { metrics: true })
  const mappings = buildVariableMappings(nodes, variableCache, cache.readers)
  stamp('vars', t)

  const { pluginComponents, pluginSkipped } = pluginCode
    ? await collectPluginOutput(tree, config, pluginCode, preferredLang)
    : { pluginComponents: undefined, pluginSkipped: new Set<string>() }

  t = now()
  const plan = planAssets(tree, pluginSkipped, cache)
  stamp('plan-assets', t)

  const assetRegistry = new Map<string, AssetDescriptor>()
  const skipIds = buildSkipIds(plan.skippedIds, pluginSkipped)
  t = now()
  const collected = await collectNodeData(tree, config, assetRegistry, cache, skipIds)
  stamp('collect', t)

  const { usedCandidateIds, layout: layoutStyles } = prepareStyles({
    tree,
    styles: collected.styles,
    mappings,
    variableCache,
    vectorRoots: plan.vectorRoots,
    cache,
    trace: traceInfo
  })

  t = now()
  const svgs = await exportVectorAssets(tree, plan, config, assetRegistry, vectorMode, cache)
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
  const codeBudget = runtimeOptions.unbounded ? resolveUnlimitedCodeBudget() : resolveCodeBudget()
  const requestArgs = buildGetCodeRequestArgs(preferredLang, resolveTokens, vectorMode)
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
    vectorRoots: plan.vectorRoots,
    rootTag,
    lang: preferredLang,
    variableIds: mappings.variableIds,
    usedCandidateIds,
    variableCache,
    config,
    pluginCode,
    resolveTokens,
    trace: traceInfo
  }
  const allAssets = Array.from(assetRegistry.values())

  try {
    const output = await renderPipeline({
      ...baseInput,
      mode: { kind: 'full' }
    })
    const warnings = buildGetCodeWarnings(output.code, {
      depthLimit: tree.stats.depthLimit,
      cappedNodeIds: tree.stats.cappedNodeIds,
      requestArgs
    })
    const result = buildCodeResult(output, codegen, allAssets, warnings)
    assertToolResponseWithinBudget(buildGetCodeToolResult(result), codeBudget)

    logTrace(
      trace,
      `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${allAssets.length}${runtimeOptions.unbounded ? ' budget=unbounded' : ''}${formatCacheMetrics(cache)}`
    )

    return result
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
      shell: true,
      omittedNodeIds: shellMode.omittedNodeIds,
      requestArgs
    })
    const assets = filterAssetsReferencedInCode(allAssets, shell.code)
    const result = buildCodeResult(shell, codegen, assets, warnings)

    try {
      assertToolResponseWithinBudget(buildGetCodeToolResult(result), codeBudget)
    } catch (shellError) {
      if (isCodeBudgetExceededError(shellError)) {
        throw error
      }
      throw shellError
    }

    logTrace(
      trace,
      `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${assets.length} shell${formatCacheMetrics(cache)}`
    )

    return result
  }
}

async function tryRenderShell(input: PipelineInput): Promise<PipelineOutput | null> {
  const rendered = await renderMarkup(input)
  if (!rendered) {
    return null
  }
  return finalizeRenderedOutput(input, rendered)
}

function createShellMode(rootId: string, tree: VisibleTree, ctx: RenderContext): ShellMode | null {
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
  const collected = getTokenCollectedContext(input)
  const {
    code: rewrittenCode,
    tokensByCanonical,
    sourceIndex,
    tokenMatcher,
    resolveNodeIds
  } = await processTokens({
    code: rendered.code,
    variableIds: input.variableIds,
    usedCandidateIds: input.usedCandidateIds,
    variableCache: input.variableCache,
    styles: collected.styles,
    textSegments: collected.textSegments,
    svgs: input.ctx.svgs,
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
        collected,
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

function getTokenCollectedContext(input: PipelineInput): CollectedContext {
  if (input.mode.kind !== 'shell') {
    return input.collected
  }

  const styles = new Map<string, Record<string, string>>()
  const rootStyle = input.collected.styles.get(input.rootId)
  if (rootStyle) {
    styles.set(input.rootId, rootStyle)
  }

  const textSegments = new Map<string, StyledTextSegment[] | null>()
  const rootSegments = input.collected.textSegments.get(input.rootId)
  if (rootSegments !== undefined) {
    textSegments.set(input.rootId, rootSegments)
  }

  return { styles, textSegments }
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
  const resolvedSvgs = resolveSvgEntries(input.ctx.svgs, input.nodeMap, resolveStyleVars)
  if (
    !stylesChanged(input.collected.styles, resolvedStyles) &&
    !svgEntriesChanged(input.ctx.svgs, resolvedSvgs)
  ) {
    return null
  }
  const resolvedLayout = buildLayoutStyles(resolvedStyles, input.vectorRoots)
  const resolvedCtx = buildRenderContext({
    ...input.ctx,
    styles: resolvedStyles,
    layout: resolvedLayout,
    svgs: resolvedSvgs,
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

function resolveSvgEntries(
  svgs: Map<string, SvgEntry>,
  nodes: Map<string, SceneNode>,
  resolver: (style: Record<string, string>, node?: SceneNode) => Record<string, string>
): Map<string, SvgEntry> {
  const out = new Map<string, SvgEntry>()

  for (const [id, entry] of svgs.entries()) {
    const presentationStyle = entry.presentationStyle
    if (!presentationStyle || !Object.keys(presentationStyle).length) {
      out.set(id, entry)
      continue
    }

    const resolvedPresentationStyle = resolver(presentationStyle, nodes.get(id))
    if (resolvedPresentationStyle === presentationStyle) {
      out.set(id, entry)
      continue
    }

    out.set(id, {
      ...entry,
      presentationStyle: resolvedPresentationStyle
    })
  }

  return out
}

function svgEntriesChanged(
  original: Map<string, SvgEntry>,
  resolved: Map<string, SvgEntry>
): boolean {
  if (original === resolved) return false
  for (const [id, entry] of resolved.entries()) {
    if (entry !== original.get(id)) return true
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
    createStringifyOptions(lang)
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
  return stringifyComponent(component, createStringifyOptions(lang))
}

async function renderMarkup({
  mode,
  rootId,
  tree,
  ctx,
  rootTag,
  lang,
  transform,
  trace
}: PipelineInput & {
  transform?: (markup: string) => string
}): Promise<{ code: string; lang: CodeLanguage } | null> {
  const clock = trace?.now
  let t = clock ? clock() : 0
  const rendered = await renderTreeForMode(mode, rootId, tree, ctx)
  if (!rendered) {
    return null
  }
  stampRenderPhase(trace, mode, 'render', t)

  const resolvedLang = lang ?? ctx.detectedLang ?? 'jsx'
  t = clock ? clock() : 0
  const markup = stringifyComponentTree(rendered, rootTag, rootId, resolvedLang)
  stampRenderPhase(trace, mode, 'stringify', t)

  t = clock ? clock() : 0
  const output = transform ? transform(markup) : markup
  stampRenderPhase(trace, mode, 'transform', t)
  return { code: output, lang: resolvedLang }
}

function buildGetCodeRequestArgs(
  preferredLang?: CodeLanguage,
  resolveTokens?: boolean,
  vectorMode?: GetCodeParametersInput['vectorMode']
): GetCodeRequestArgs {
  const requestArgs: GetCodeRequestArgs = {}

  if (preferredLang) {
    requestArgs.preferredLang = preferredLang
  }

  if (resolveTokens !== undefined) {
    requestArgs.resolveTokens = resolveTokens
  }

  if (vectorMode) {
    requestArgs.vectorMode = vectorMode
  }

  return requestArgs
}

function createStringifyOptions(lang: CodeLanguage): {
  lang: CodeLanguage
  isInline: (tag: string) => boolean
} {
  return {
    lang,
    isInline: isCompactTag
  }
}

function isCompactTag(tag: string): boolean {
  return COMPACT_TAGS.has(tag)
}

async function renderTreeForMode(
  mode: RenderMode,
  rootId: string,
  tree: VisibleTree,
  ctx: RenderContext
): Promise<DevComponent | string | null> {
  if (mode.kind === 'shell') {
    return renderShellTree(rootId, tree, ctx, mode.omittedNodeIds)
  }

  return renderTree(rootId, tree, ctx)
}

function stampRenderPhase(
  trace: TraceInfo | undefined,
  mode: RenderMode,
  step: RenderStep,
  start: number
): void {
  if (!trace) {
    return
  }

  const label = mode.kind === 'shell' ? `${step}:shell` : step
  trace.stamp(label, start)
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

function formatCacheMetrics(cache: { metrics?: { [key: string]: number } }): string {
  if (!cache.metrics) return ''
  const {
    nodeSemanticHits,
    nodeSemanticMisses,
    styleHits,
    styleMisses,
    paintStyleHits,
    paintStyleMisses,
    variableHits,
    variableMisses,
    vectorAnalysisHits,
    vectorAnalysisMisses,
    vectorExportCandidates,
    vectorExportSkippedMissing,
    vectorExportSkippedZeroBounds,
    vectorExportNull,
    vectorExportUploaded,
    vectorExportThemeableInline,
    vectorExportRawInline
  } = cache.metrics
  return [
    `cache=node(${nodeSemanticHits}/${nodeSemanticMisses})`,
    `style(${styleHits}/${styleMisses})`,
    `paint-style(${paintStyleHits}/${paintStyleMisses})`,
    `var(${variableHits}/${variableMisses})`,
    `vector-analysis(${vectorAnalysisHits}/${vectorAnalysisMisses})`,
    `vector-export(candidates=${vectorExportCandidates} missing=${vectorExportSkippedMissing} zero=${vectorExportSkippedZeroBounds} null=${vectorExportNull} uploaded=${vectorExportUploaded} themeable-inline=${vectorExportThemeableInline} raw-inline=${vectorExportRawInline})`
  ].join(' ')
}
