import type {
  AssetDescriptor,
  GetCodeParametersInput,
  GetCodeResult,
  GetCodeWarning,
  GetTokenDefsResult,
  ToolResponseLike
} from '@tempad-dev/shared'

import {
  MCP_GET_CODE_TIMEOUT_MS,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetCodeToolResult
} from '@tempad-dev/shared'

import type { DevComponent } from '@/types/plugin'
import type { CodegenConfig } from '@/utils/codegen'

import { PluginSandboxError } from '@/plugin-sandbox/client'
import { activePlugin } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'
import { simplifyColorMixToRgba, stripFallback } from '@/utils/css'
import { logger } from '@/utils/log'

import type { TokenReadContext } from '../token/context'
import type { SvgEntry } from './assets'
import type { AssetPlan } from './assets/plan'
import type { GetCodeCacheContext } from './cache'
import type { VisibleTree } from './model'
import type { CodeLanguage, RenderContext } from './render'
import type { PluginComponent } from './render/plugin'

import { currentCodegenConfig } from '../config'
import { collectCandidateVariableIds } from '../token/candidates'
import { createTokenReadContext } from '../token/context'
import { exportVectorAssets } from './assets/export'
import { planAssets } from './assets/plan'
import { preflightGetCodeBudget } from './budget-preflight'
import { createGetCodeCacheContext } from './cache'
import { collectNodeData } from './collect'
import { CodeDeadlineExceededError, withCodeDeadline } from './deadline'
import { collectUnboundColorLiteralClusters } from './literal-clusters'
import {
  CodeBudgetExceededError,
  assertToolResponseWithinBudget,
  buildGetCodeWarnings
} from './messages'
import { getOrderedChildIds, renderShellTree, renderTree } from './render'
import { resolvePluginComponents } from './render/plugin'
import { buildLayoutStyles, prepareStyles } from './styles'
import {
  createStyleVarResolver,
  processTokens,
  resolveStyleMap,
  rewriteTokenNamesInCode
} from './tokens'
import { createTokenDiagnostics } from './tokens/diagnostics'
import { addVariableModeHints } from './tokens/modes'
import { addSubtreeIds, buildVisibleTree } from './tree'

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
  vectorRoots: Set<string>
  rootTag?: string
  lang?: CodeLanguage
  variableIds: Set<string>
  usedCandidateIds: Set<string>
  variableCache: Map<string, Variable | null>
  tokenContext: TokenReadContext
  resolveTokens?: boolean
  trace?: TraceInfo
}

type PipelineOutput = {
  code: string
  lang: CodeLanguage
  tokens?: GetTokenDefsResult
  tokenWarnings?: GetCodeWarning[]
}

export type GetCodeRuntimeOptions = {
  unbounded?: boolean
  formatResult?: (result: GetCodeResult) => ToolResponseLike
  cache?: GetCodeCacheContext
}

type RenderStep = 'render' | 'stringify' | 'transform'

export async function handleGetCode(
  nodes: SceneNode[],
  preferredLang?: CodeLanguage,
  resolveTokens?: boolean,
  vectorMode: GetCodeParametersInput['vectorMode'] = 'smart',
  runtimeOptions: GetCodeRuntimeOptions = {}
): Promise<GetCodeResult> {
  const measure = typeof __DEV__ !== 'undefined' && __DEV__
  const trace = measure ? createTrace() : undefined
  const now = trace?.now ?? (() => 0)
  const stamp = trace?.stamp ?? (() => {})

  const [node] = nodes
  if (nodes.length !== 1 || !node) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  if (!node.visible) {
    throw new Error('The selected node is not visible.')
  }

  const t = now()
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

  const cache = runtimeOptions.cache ?? createGetCodeCacheContext(undefined, { metrics: measure })
  const tokenContext = (cache.tokens ??= createTokenReadContext(
    currentCodegenConfig(),
    activePlugin.value?.code,
    cache.variables
  ))
  const pluginName = (cache.pluginName ??= activePlugin.value?.name ?? 'none')
  const assetPlan: { current?: AssetPlan } = {}
  const generate = (signal?: AbortSignal, forceShell = false) =>
    generateCode({
      nodes,
      preferredLang,
      resolveTokens,
      vectorMode,
      runtimeOptions,
      tree,
      rootId,
      trace,
      tokenContext,
      assetPlan,
      cache: { ...cache, pluginName, signal },
      forceShell
    })
  const root = tree.nodes.get(rootId)
  if (runtimeOptions.unbounded || !root?.children.length || root.assetKind === 'vector') {
    return generate()
  }

  // Leave time to return the parent shell before the Hub's default hard timeout.
  const fullTimeoutMs = (MCP_GET_CODE_TIMEOUT_MS * 2) / 3
  try {
    return await withCodeDeadline(fullTimeoutMs, (signal) => generate(signal))
  } catch (error) {
    if (
      !(error instanceof CodeDeadlineExceededError) &&
      !(error instanceof PluginSandboxError && error.code === 'timeout')
    )
      throw error
    return withCodeDeadline(MCP_GET_CODE_TIMEOUT_MS / 6, (signal) => generate(signal, true))
  }
}

async function generateCode({
  nodes,
  preferredLang,
  resolveTokens,
  vectorMode,
  runtimeOptions,
  tree,
  rootId,
  trace,
  tokenContext,
  assetPlan,
  cache,
  forceShell
}: {
  nodes: SceneNode[]
  preferredLang?: CodeLanguage
  resolveTokens?: boolean
  vectorMode: GetCodeParametersInput['vectorMode']
  runtimeOptions: GetCodeRuntimeOptions
  tree: VisibleTree
  rootId: string
  trace?: ReturnType<typeof createTrace>
  tokenContext: TokenReadContext
  assetPlan: { current?: AssetPlan }
  cache: GetCodeCacheContext & { pluginName: string }
  forceShell: boolean
}): Promise<GetCodeResult> {
  const now = trace?.now ?? (() => 0)
  const stamp = trace?.stamp ?? (() => {})
  const traceInfo: TraceInfo | undefined = trace ? { now, stamp } : undefined
  const { config, pluginCode } = tokenContext
  if (forceShell) {
    // A vector container may depend on masks or compositing across its children.
    // Reuse the full read's plan, including plugin overrides, whenever available.
    assetPlan.current ??= planAssets(tree, undefined, cache)
    if (assetPlan.current.vectorRoots.has(rootId)) throw new CodeDeadlineExceededError()
  }
  const maxResultBytes = runtimeOptions.unbounded
    ? Number.MAX_SAFE_INTEGER
    : MCP_TOOL_INLINE_BUDGET_BYTES
  const formatResult = runtimeOptions.formatResult ?? buildGetCodeToolResult
  const budgetPreflight = forceShell
    ? undefined
    : preflightGetCodeBudget(tree, rootId, {
        maxResultBytes,
        pluginEnabled: !!pluginCode,
        unbounded: !!runtimeOptions.unbounded
      })
  const earlyShell = forceShell || budgetPreflight?.kind === 'shell'

  let t = now()
  const variableCache = cache.variables
  const nodeVariableIds = new Map<string, ReadonlySet<string>>()
  const mappings = collectCandidateVariableIds(nodes, variableCache, cache.readers, {
    traverseChildren: !earlyShell,
    captureNodeId: (id) => tree.nodes.has(id),
    onNodeVariableIds: (id, ids) => nodeVariableIds.set(id, ids)
  })
  stamp('vars', t)

  const { pluginComponents, pluginSkipped } =
    pluginCode && !earlyShell
      ? await collectPluginOutput(tree, config, pluginCode, preferredLang, cache.signal)
      : { pluginComponents: undefined, pluginSkipped: new Set<string>() }
  cache.signal?.throwIfAborted()

  t = now()
  const plan = earlyShell
    ? { vectorRoots: new Set<string>(), skippedIds: new Set<string>() }
    : planAssets(tree, pluginSkipped, cache)
  if (!earlyShell) assetPlan.current = plan
  stamp('plan-assets', t)

  const assetRegistry = new Map<string, AssetDescriptor>()
  const skipIds = earlyShell
    ? new Set(tree.order.filter((id) => id !== rootId))
    : buildSkipIds(plan.skippedIds, pluginSkipped)
  t = now()
  const collected = await collectNodeData(
    tree,
    config,
    assetRegistry,
    cache,
    skipIds,
    nodeVariableIds
  )
  cache.signal?.throwIfAborted()
  stamp('collect', t)

  if (earlyShell) {
    ensureEarlyShellRootPositioning(rootId, tree, collected.styles)
  }

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
  const svgs = earlyShell
    ? new Map<string, SvgEntry>()
    : await exportVectorAssets(tree, plan, config, assetRegistry, vectorMode, cache)
  cache.signal?.throwIfAborted()
  stamp('export-assets', t)

  const nodeMap = buildNodeMap(collected.nodes)
  const ctx: RenderContext = {
    signal: cache.signal,
    styles: collected.styles,
    layout: layoutStyles,
    nodes: nodeMap,
    svgs,
    textSegments: collected.textSegments,
    pluginComponents,
    pluginCode,
    config,
    readers: cache.readers,
    preferredLang
  }

  const rootTag = collected.nodes.get(rootId)?.tag
  const codegen = {
    plugin: cache.pluginName,
    config
  }
  const baseInput: Omit<PipelineInput, 'mode'> = {
    rootId,
    tree,
    ctx,
    collected,
    vectorRoots: plan.vectorRoots,
    rootTag,
    lang: preferredLang,
    variableIds: mappings.variableIds,
    usedCandidateIds,
    variableCache,
    tokenContext,
    resolveTokens,
    trace: traceInfo
  }
  const allAssets = Array.from(assetRegistry.values())
  const { rootVideoPreviewAssetHashes, videoPreviewAssetHashes } = collected

  if (earlyShell) {
    const shellMode = createShellMode(rootId, tree, ctx)
    const shell = shellMode
      ? await tryRenderPipeline({
          ...baseInput,
          mode: shellMode
        })
      : null
    if (!shell) {
      throw new Error(
        'Unable to build a shell for the selection. Retry with a smaller nodeId subtree.'
      )
    }

    const warnings = buildGetCodeWarnings(shell.code, {
      depthCapped: tree.stats.capped,
      shell: true,
      tokenWarnings: shell.tokenWarnings
    })
    const assets = selectAssetsForCode(allAssets, shell.code, videoPreviewAssetHashes)
    const result = buildCodeResult(shell, codegen, assets, undefined, warnings)
    assertToolResponseWithinBudget(formatResult(result), maxResultBytes)
    if (trace) {
      logTrace(
        trace,
        `nodes=${tree.order.length} collected=1 assets=${assets.length} shell=${forceShell ? 'timeout' : 'early'} preflightNodes=${budgetPreflight?.kind === 'shell' ? budgetPreflight.scannedDescendants : 0}${formatCacheMetrics(cache)}`
      )
    }
    return result
  }

  try {
    const output = await renderPipeline({
      ...baseInput,
      mode: { kind: 'full' }
    })
    const literalClusters = resolveTokens
      ? undefined
      : collectUnboundColorLiteralClusters(collected.styles, tree)
    const warnings = buildGetCodeWarnings(output.code, {
      depthCapped: tree.stats.capped,
      literalClusters,
      tokenWarnings: output.tokenWarnings
    })
    const assets = selectAssetsForCode(allAssets, output.code, videoPreviewAssetHashes)
    const result = buildCodeResult(output, codegen, assets, literalClusters, warnings)
    assertToolResponseWithinBudget(formatResult(result), maxResultBytes)

    if (trace) {
      logTrace(
        trace,
        `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${assets.length}${runtimeOptions.unbounded ? ' budget=unbounded' : ''}${formatCacheMetrics(cache)}`
      )
    }

    return result
  } catch (error) {
    if (!(error instanceof CodeBudgetExceededError)) {
      throw error
    }

    const shellMode = createShellMode(rootId, tree, ctx)
    if (!shellMode) {
      throw error
    }

    const shell = await tryRenderPipeline({
      ...baseInput,
      mode: shellMode
    })
    if (shell == null) {
      throw error
    }

    const warnings = buildGetCodeWarnings(shell.code, {
      depthCapped: tree.stats.capped,
      shell: true,
      tokenWarnings: shell.tokenWarnings
    })
    const assets = selectAssetsForCode(allAssets, shell.code, rootVideoPreviewAssetHashes)
    const result = buildCodeResult(shell, codegen, assets, undefined, warnings)

    try {
      assertToolResponseWithinBudget(formatResult(result), maxResultBytes)
    } catch (shellError) {
      if (shellError instanceof CodeBudgetExceededError) {
        throw error
      }
      throw shellError
    }

    if (trace) {
      logTrace(
        trace,
        `nodes=${tree.order.length} text=${collected.textSegments.size} vectors=${plan.vectorRoots.size} assets=${assets.length} shell${formatCacheMetrics(cache)}`
      )
    }

    return result
  }
}

function ensureEarlyShellRootPositioning(
  rootId: string,
  tree: VisibleTree,
  styles: Map<string, Record<string, string>>
): void {
  const root = tree.nodes.get(rootId)
  if (!root?.children.length) return
  if (root.node.type === 'GROUP' || root.node.type === 'BOOLEAN_OPERATION') return
  const style = styles.get(rootId)
  if (!style || (style.position && style.position !== 'static')) return
  styles.set(rootId, { ...style, position: 'relative' })
}

async function tryRenderPipeline(input: PipelineInput): Promise<PipelineOutput | null> {
  const diagnostics = createTokenDiagnostics()
  addVariableModeHints(
    input.tree,
    new Set([...input.variableIds, ...input.usedCandidateIds]),
    input.tokenContext,
    diagnostics.report
  )
  const rendered = await renderMarkup(input)
  if (!rendered) {
    return null
  }
  return finalizeRenderedOutput(input, rendered, diagnostics)
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
  const output = await tryRenderPipeline(input)
  if (!output) {
    throw new Error('Unable to build markup for the current selection.')
  }

  return output
}

async function finalizeRenderedOutput(
  input: PipelineInput,
  rendered: { code: string; lang: CodeLanguage },
  diagnostics: ReturnType<typeof createTokenDiagnostics>
): Promise<PipelineOutput> {
  const collected = getTokenCollectedContext(input)
  input.ctx.signal?.throwIfAborted()
  const {
    code: rewrittenCode,
    tokensByCanonical,
    sourceIndex,
    tokenMatcher,
    resolveNodeIds,
    rewriteMap
  } = await processTokens({
    code: rendered.code,
    variableIds: input.variableIds,
    usedCandidateIds: input.usedCandidateIds,
    variableCache: input.variableCache,
    styles: collected.styles,
    textSegments: collected.textSegments,
    svgs: input.ctx.svgs,
    config: input.ctx.config,
    pluginCode: input.ctx.pluginCode,
    resolveTokens: input.resolveTokens,
    tokenContext: input.tokenContext,
    report: diagnostics.report,
    stamp: input.trace?.stamp,
    now: input.trace?.now
  })
  input.ctx.signal?.throwIfAborted()

  let outputCode = rewrittenCode

  if (input.resolveTokens && sourceIndex.size) {
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
        tokenMatcher,
        report: diagnostics.report
      })
      if (resolved) {
        outputCode = rewriteTokenNamesInCode(stripFallback(resolved.code), rewriteMap ?? new Map())
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
    tokenWarnings: diagnostics.warnings(),
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
  report,
  ...input
}: {
  sourceIndex: Map<string, string>
  resolveNodeIds?: Set<string>
  tokenMatcher?: (value: string) => boolean
  report: ReturnType<typeof createTokenDiagnostics>['report']
} & PipelineInput & {
    lang: CodeLanguage
  }): Promise<{ code: string } | null> {
  const resolveStyleVars = createStyleVarResolver(
    sourceIndex,
    input.variableCache,
    input.ctx.config,
    resolveNodeIds,
    tokenMatcher,
    input.tokenContext,
    report
  )
  const resolvedStyles = resolveStyleMap(input.collected.styles, input.ctx.nodes, resolveStyleVars)
  const resolvedSvgs = resolveSvgEntries(input.ctx.svgs, input.ctx.nodes, resolveStyleVars)
  if (
    !resolvedEntriesChanged(input.collected.styles, resolvedStyles) &&
    !resolvedEntriesChanged(input.ctx.svgs, resolvedSvgs) &&
    !input.collected.textSegments.size
  ) {
    return null
  }
  const resolvedLayout = buildLayoutStyles(resolvedStyles, input.vectorRoots)
  const resolvedCtx: RenderContext = {
    ...input.ctx,
    // Each render detects its language independently; keep the first result language below.
    detectedLang: undefined,
    styles: resolvedStyles,
    layout: resolvedLayout,
    svgs: resolvedSvgs,
    resolveStyleVars
  }

  return renderMarkup({
    ...input,
    ctx: resolvedCtx,
    lang: input.lang,
    transform: simplifyColorMixToRgba
  })
}

function resolvedEntriesChanged<T>(original: Map<string, T>, resolved: Map<string, T>): boolean {
  if (original === resolved) return false
  for (const [id, value] of resolved) {
    if (value !== original.get(id)) return true
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

async function collectPluginOutput(
  tree: VisibleTree,
  config: CodegenConfig,
  pluginCode: string,
  preferredLang?: CodeLanguage,
  signal?: AbortSignal
): Promise<{
  pluginComponents: Map<string, PluginComponent | null>
  pluginSkipped: Set<string>
}> {
  const pluginComponents = new Map<string, PluginComponent | null>()
  const instances: Array<{ id: string; node: InstanceNode }> = []
  for (const id of tree.order) {
    const snapshot = tree.nodes.get(id)
    if (snapshot?.node.type === 'INSTANCE') {
      instances.push({ id: snapshot.id, node: snapshot.node })
    }
  }

  const components = await resolvePluginComponents(
    instances.map(({ node }) => node),
    config,
    pluginCode,
    preferredLang,
    signal
  )
  instances.forEach(({ id }, resultIndex) => {
    pluginComponents.set(id, components[resultIndex] ?? null)
  })
  const pluginSkipped = new Set<string>()

  if (pluginComponents.size) {
    for (const [id, component] of pluginComponents.entries()) {
      if (!component) continue
      const snapshot = tree.nodes.get(id)
      if (!snapshot) continue
      snapshot.children.forEach((childId) => addSubtreeIds(childId, tree, pluginSkipped))
    }
  }

  return { pluginComponents, pluginSkipped }
}

function buildSkipIds(base: Set<string>, extra: Set<string>): Set<string> {
  if (!extra.size) return base
  if (!base.size) return extra
  return new Set<string>([...base, ...extra])
}

function buildNodeMap(nodes: Map<string, { node: SceneNode }>): Map<string, SceneNode> {
  const out = new Map<string, SceneNode>()
  nodes.forEach((snap, id) => out.set(id, snap.node))
  return out
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

function selectAssetsForCode(
  assets: AssetDescriptor[],
  code: string,
  supplementalAssetHashes?: ReadonlySet<string>
): AssetDescriptor[] {
  return assets.filter(
    (asset) =>
      code.includes(asset.url) ||
      code.includes(asset.hash) ||
      supplementalAssetHashes?.has(asset.hash)
  )
}

function buildCodeResult(
  output: PipelineOutput,
  codegen: GetCodeResult['codegen'],
  assets: AssetDescriptor[],
  literalClusters?: GetCodeResult['literalClusters'],
  warnings?: GetCodeResult['warnings']
): GetCodeResult {
  return {
    lang: output.lang,
    code: output.code,
    ...(assets.length ? { assets } : {}),
    ...(output.tokens ? { tokens: output.tokens } : {}),
    ...(literalClusters?.length ? { literalClusters } : {}),
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
    textRangeHits,
    textRangeMisses,
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
    `text-range(${textRangeHits}/${textRangeMisses})`,
    `vector-analysis(${vectorAnalysisHits}/${vectorAnalysisMisses})`,
    `vector-export(candidates=${vectorExportCandidates} missing=${vectorExportSkippedMissing} zero=${vectorExportSkippedZeroBounds} null=${vectorExportNull} uploaded=${vectorExportUploaded} themeable-inline=${vectorExportThemeableInline} raw-inline=${vectorExportRawInline})`
  ].join(' ')
}
