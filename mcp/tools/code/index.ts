import type { AssetDescriptor, GetCodeResult } from '@/mcp-server/src/tools'
import type { SemanticNode } from '@/mcp/semantic-tree'
import type { CodeBlock } from '@/types/codegen'
import type { DevComponent } from '@/types/plugin'
import type { CodegenConfig } from '@/utils/codegen'

import { ensureAssetUploaded } from '@/mcp/assets'
import { buildSemanticTree } from '@/mcp/semantic-tree'
import { MCP_MAX_PAYLOAD_BYTES } from '@/mcp/shared/constants'
import { raw } from '@/plugins/src'
import { activePlugin, options } from '@/ui/state'
import { generateCodeBlocksForNode } from '@/utils/codegen'
import { stringifyComponent } from '@/utils/component'
import {
  BG_URL_RE,
  canonicalizeValue,
  normalizeCssValue,
  stripDefaultTextStyles
} from '@/utils/css'
import { joinClassNames } from '@/utils/tailwind'

import { collectTokenReferences, resolveVariableTokens } from '../token-defs'
import {
  applyVariableTransforms,
  inferResizingStyles,
  mergeInferredAutoLayout,
  preprocessStyles,
  styleToClassNames
} from './style'
import { renderTextSegments } from './text'

export type CodeLanguage = 'jsx' | 'vue'

export type RenderContext = {
  styles: Map<string, Record<string, string>>
  nodes: Map<string, SceneNode>
  svgs: Map<string, string>
  pluginCode?: string
  config: CodegenConfig
  preferredLang?: CodeLanguage
  detectedLang?: CodeLanguage
}

type DataHint = { kind: string; name: string; value: unknown }

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

  let markup =
    typeof componentTree === 'string'
      ? normalizeRootString(componentTree, root.tag, resolvedLang)
      : stringifyComponent(componentTree, {
          lang: resolvedLang,
          isInline: (tag) => COMPACT_TAGS.has(tag)
        })

  const MAX_CODE_CHARS = Math.floor(MCP_MAX_PAYLOAD_BYTES * 0.6)
  let message = tree.stats.capped
    ? `Selection truncated at depth ${tree.stats.depthLimit ?? tree.stats.maxDepth}.`
    : undefined

  if (markup.length > MAX_CODE_CHARS) {
    markup = markup.slice(0, MAX_CODE_CHARS)
    message = message
      ? `${message} Output truncated to fit payload limit; showing first ${MAX_CODE_CHARS} characters.`
      : `Output truncated to fit payload limit; showing first ${MAX_CODE_CHARS} characters.`
  }

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

  if (resolveTokens) {
    const tokenMap = new Map(usedTokens.map((t) => [t.name, t.value]))
    markup = markup.replace(/var\((--[a-zA-Z0-9-_]+)\)/g, (match, name) => {
      const val = tokenMap.get(name)
      return typeof val === 'string' ? val : match
    })
    // If tokens are resolved, we don't need to return the token definitions
    return {
      lang: resolvedLang,
      code: markup,
      assets: Array.from(assetRegistry.values()),
      ...(message ? { message } : {})
    }
  }

  return {
    lang: resolvedLang,
    code: markup,
    assets: Array.from(assetRegistry.values()),
    usedTokens,
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

async function collectSceneData(
  roots: SemanticNode[],
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<{
  nodes: Map<string, SceneNode>
  styles: Map<string, Record<string, string>>
  svgs: Map<string, string>
}> {
  const semanticNodes = flattenSemanticNodes(roots)
  const nodes = new Map<string, SceneNode>()
  const styles = new Map<string, Record<string, string>>()
  const svgs = new Map<string, string>()

  for (const semantic of semanticNodes) {
    const node = figma.getNodeById(semantic.id) as SceneNode | null
    if (!node || !node.visible) continue

    nodes.set(semantic.id, node)

    if (isVectorNode(node)) {
      try {
        const svgUint8 = await node.exportAsync({ format: 'SVG' })
        const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
        let svgString = decoder ? decoder.decode(svgUint8) : String.fromCharCode(...svgUint8)

        svgString = transformSvgAttributes(svgString, config)

        svgs.set(semantic.id, svgString)
      } catch {
        // Fallback
      }
    } else {
      try {
        const css = await node.getCSSAsync()

        let processed = preprocessStyles(css, node)
        processed = mergeInferredAutoLayout(processed, node)
        processed = inferResizingStyles(processed, node)

        if (hasImageFills(node)) {
          processed = await replaceImageUrlsWithAssets(processed, node, config, assetRegistry)
        }

        stripInertShadows(processed, node)

        styles.set(semantic.id, processed)
      } catch {
        // Ignore
      }
    }
  }

  return { nodes, styles, svgs }
}

function isVectorNode(node: SceneNode): boolean {
  const vectorTypes = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'POLYGON']
  return vectorTypes.includes(node.type)
}

function hasImageFills(node: SceneNode): boolean {
  return (
    'fills' in node &&
    Array.isArray(node.fills) &&
    node.fills.some((f) => f.type === 'IMAGE' && f.visible !== false)
  )
}

function stripInertShadows(style: Record<string, string>, node: SceneNode): void {
  if (!style['box-shadow']) return
  if (hasRenderableFill(node)) return
  delete style['box-shadow']
}

function hasRenderableFill(node: SceneNode): boolean {
  if (!('fills' in node)) return false
  const fills = node.fills
  if (!Array.isArray(fills)) return false
  return fills.some((fill) => isFillRenderable(fill as Paint))
}

function isFillRenderable(fill: Paint | undefined): boolean {
  if (!fill || fill.visible === false) {
    return false
  }
  if (typeof fill.opacity === 'number' && fill.opacity <= 0) {
    return false
  }
  if ('gradientStops' in fill && Array.isArray(fill.gradientStops)) {
    return fill.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

function transformSvgAttributes(svg: string, config: CodegenConfig): string {
  const regex = /(\s|^)(width|height)=(['"])(.*?)\3/g
  const replacer = (_match: string, prefix: string, attr: string, quote: string, val: string) => {
    const pxVal = val.endsWith('px') ? val : `${val}px`
    const normalized = normalizeCssValue(pxVal, config)
    return `${prefix}${attr}=${quote}${normalized}${quote}`
  }
  return svg.replace(regex, replacer)
}

async function replaceImageUrlsWithAssets(
  style: Record<string, string>,
  node: SceneNode,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<Record<string, string>> {
  if (!style['background-color'] && !style['background-image'] && !style.background) return style

  const fills = await collectImageFillAssets(node, assetRegistry)
  if (!fills.length) return replaceImageUrlsWithPlaceholder(style, node, config)

  const result = { ...style }
  const regex = new RegExp(BG_URL_RE.source, 'gi')

  for (const key of ['background', 'background-image']) {
    if (!result[key]) continue
    let index = 0
    result[key] = result[key].replace(regex, () => {
      const asset = fills[Math.min(index, fills.length - 1)]
      index++
      return `url('${asset.url}')`
    })
  }

  return result
}

const imageBytesCache = new Map<string, Promise<Uint8Array>>()

async function collectImageFillAssets(
  node: SceneNode,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<AssetDescriptor[]> {
  if (!('fills' in node)) return []
  const fills = Array.isArray(node.fills) ? (node.fills as Paint[]) : null
  if (!fills?.length) return []

  const assets: AssetDescriptor[] = []
  for (const fill of fills) {
    if (!isRenderableImagePaint(fill)) continue
    const hash = fill.imageHash
    if (!hash) continue

    try {
      const bytes = await loadImageBytes(hash)
      const mimeType = detectImageMime(bytes)
      const asset = await ensureAssetUploaded(bytes, mimeType)
      assetRegistry.set(asset.hash, asset)
      assets.push(asset)
    } catch (error) {
      console.warn('[tempad-dev] Failed to process image fill asset:', error)
    }
  }

  return assets
}

function isRenderableImagePaint(paint: Paint): paint is ImagePaint {
  return paint.type === 'IMAGE' && paint.visible !== false
}

function loadImageBytes(hash: string): Promise<Uint8Array> {
  let promise = imageBytesCache.get(hash)
  if (!promise) {
    const image = figma.getImageByHash(hash)
    if (!image) {
      throw new Error(`Unable to resolve image for hash ${hash}.`)
    }
    promise = image
      .getBytesAsync()
      .then((bytes) => {
        imageBytesCache.set(hash, Promise.resolve(bytes))
        return bytes
      })
      .catch((error) => {
        imageBytesCache.delete(hash)
        throw error
      })
    imageBytesCache.set(hash, promise)
  }
  return promise
}

function detectImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

function replaceImageUrlsWithPlaceholder(
  style: Record<string, string>,
  node: SceneNode,
  config: CodegenConfig
): Record<string, string> {
  if (!style['background-color'] && !style['background-image'] && !style.background) return style

  const { scale = 1 } = config
  let w = 100
  let h = 100

  if ('width' in node && typeof node.width === 'number') w = Math.round(node.width * scale)
  if ('height' in node && typeof node.height === 'number') h = Math.round(node.height * scale)

  const placeholderUrl = `https://placehold.co/${w}x${h}`
  const result = { ...style }
  const regex = new RegExp(BG_URL_RE.source, 'gi')

  for (const key of ['background', 'background-image']) {
    if (result[key]) {
      result[key] = result[key].replace(regex, `url('${placeholderUrl}')`)
    }
  }

  return result
}

async function renderSemanticNode(
  semantic: SemanticNode,
  ctx: RenderContext,
  inheritedTextStyle?: Record<string, string>,
  parentIsGrid = false
): Promise<DevComponent | string | null> {
  const node = ctx.nodes.get(semantic.id)
  if (!node) return null

  if (ctx.svgs.has(semantic.id)) {
    return raw(ctx.svgs.get(semantic.id)!)
  }

  let rawStyle = ctx.styles.get(semantic.id) ?? {}
  if (!parentIsGrid) {
    rawStyle = filterGridProps(rawStyle)
  }

  const pluginComponent = node.type === 'INSTANCE' ? await renderPluginComponent(node, ctx) : null

  if (pluginComponent?.lang && !ctx.preferredLang && ctx.detectedLang !== 'vue') {
    ctx.detectedLang = pluginComponent.lang
  }

  const langHint = pluginComponent?.lang ?? ctx.preferredLang ?? ctx.detectedLang
  const classProp = getClassPropName(langHint)

  const { textStyle, otherStyle } = splitTextStyles(rawStyle)
  const cleanedTextStyle = stripDefaultTextStyles(textStyle)
  const hoistedTextStyle =
    node.type === 'TEXT' ? filterHoistableTextStyle(cleanedTextStyle) : cleanedTextStyle

  if (node.type === 'TEXT' && inheritedTextStyle?.color && cleanedTextStyle.color) {
    delete hoistedTextStyle.color
  }

  const textSegments =
    node.type === 'TEXT'
      ? await renderTextSegments(node, classProp, ctx, {
          inheritedTextStyle
        })
      : undefined

  const effectiveTextStyle =
    node.type === 'TEXT' && textSegments
      ? { ...hoistedTextStyle, ...(textSegments.commonStyle ?? {}) }
      : hoistedTextStyle

  const { appliedTextStyle, nextTextStyle } = diffTextStyles(inheritedTextStyle, effectiveTextStyle)

  const baseStyleForClass = Object.keys(otherStyle).length
    ? { ...otherStyle, ...appliedTextStyle }
    : appliedTextStyle

  const styleForClass = pluginComponent
    ? pickChildLayoutStyles(baseStyleForClass)
    : baseStyleForClass

  const shouldInjectFills = !pluginComponent
  const isFallback = !pluginComponent

  const { classNames, props } = buildClassProps(
    styleForClass,
    ctx.config,
    classProp,
    semantic.dataHint,
    node,
    {
      injectFills: shouldInjectFills,
      isFallback
    }
  )

  if (pluginComponent) {
    const hasDataHintProp = semantic.dataHint?.kind === 'attr' && semantic.dataHint.name in props
    const pluginProps = classNames.length || hasDataHintProp ? props : undefined

    if (pluginComponent.component) {
      return mergeDevComponentProps(pluginComponent.component, pluginProps)
    }

    if (pluginComponent.code) {
      return raw(pluginComponent.code, pluginProps as Record<string, string>)
    }
    return null
  }

  if (node.type === 'TEXT') {
    const segments = textSegments?.segments ?? []
    const { classNames, props: textProps } = buildClassProps(
      baseStyleForClass,
      ctx.config,
      classProp,
      semantic.dataHint,
      node,
      { isFallback }
    )
    if (segments.length === 1) {
      const single = segments[0]
      if (!classNames.length && !semantic.dataHint) return single ?? null
      if (single && typeof single !== 'string') return mergeDevComponentProps(single, textProps)
    }
    return {
      name: semantic.tag || 'span',
      props: textProps,
      children: segments.filter(Boolean)
    }
  }

  const children: Array<DevComponent | string> = []
  const display = rawStyle.display || ''
  const isCurrentGrid = display === 'grid' || display === 'inline-grid'

  for (const child of semantic.children) {
    const rendered = await renderSemanticNode(child, ctx, nextTextStyle, isCurrentGrid)
    if (rendered) children.push(rendered)
  }

  return { name: semantic.tag || 'div', props, children }
}

function filterGridProps(style: Record<string, string>): Record<string, string> {
  const res: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (
      k === 'grid-row' ||
      k === 'grid-column' ||
      k === 'grid-area' ||
      k === 'grid-row-start' ||
      k === 'grid-row-end' ||
      k === 'grid-column-start' ||
      k === 'grid-column-end'
    ) {
      continue
    }
    res[k] = v
  }
  return res
}

type PluginComponent = { component?: DevComponent; code?: string; lang?: CodeLanguage }

async function renderPluginComponent(
  node: InstanceNode,
  ctx: RenderContext
): Promise<PluginComponent | null> {
  if (!ctx.pluginCode) return null
  const { codeBlocks, devComponent } = await generateCodeBlocksForNode(
    node,
    ctx.config,
    ctx.pluginCode,
    { returnDevComponent: true }
  )
  const detectedLang = detectLang(codeBlocks, ctx.preferredLang)
  const componentBlock = findComponentBlock(codeBlocks, detectedLang)
  const code = componentBlock?.code.trim()
  if (!code && !devComponent) return null
  return { component: devComponent ?? undefined, code: code ?? undefined, lang: detectedLang }
}

function detectLang(blocks: CodeBlock[], preferredLang?: CodeLanguage): CodeLanguage | undefined {
  if (preferredLang) return preferredLang
  const normalized = blocks.map((b) => normalizeBlockLang(b.lang))
  if (normalized.includes('vue')) return 'vue'
  if (normalized.includes('jsx')) return 'jsx'
  return undefined
}

function normalizeBlockLang(lang?: string): CodeLanguage | undefined {
  if (!lang || lang === 'jsx' || lang === 'vue') return lang as CodeLanguage
  if (lang === 'tsx') return 'jsx'
  return 'jsx'
}

function findComponentBlock(
  blocks: CodeBlock[],
  preferredLang?: CodeLanguage
): CodeBlock | undefined {
  const comps = blocks.filter((b) => b.name === 'component')
  if (preferredLang) return comps.find((b) => normalizeBlockLang(b.lang) === preferredLang)
  return (
    comps.find((b) => normalizeBlockLang(b.lang) === 'vue') ??
    comps.find((b) => normalizeBlockLang(b.lang) === 'jsx')
  )
}

const CHILD_LAYOUT_PROPS = new Set([
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-self',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height'
])

function pickChildLayoutStyles(style: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (CHILD_LAYOUT_PROPS.has(k)) picked[k] = v
  }
  return picked
}

function buildClassProps(
  style: Record<string, string>,
  config: CodegenConfig,
  defaultClassProp: 'class' | 'className',
  dataHint: DataHint | undefined,
  node: SceneNode,
  options: { injectFills?: boolean; isFallback?: boolean } = {}
) {
  const classNames = styleToClassNames(style, config, node, options)
  const props: Record<string, string> = {}

  if (classNames.length) props[defaultClassProp] = joinClassNames(classNames)

  if (dataHint?.kind === 'attr') {
    if (dataHint.name === 'data-tp') {
      if (options.isFallback) {
        props[dataHint.name] = String(dataHint.value)
      }
    } else {
      const val = dataHint.value
      if (val != null && String(val).trim()) props[dataHint.name] = String(val)
    }
  }

  return { classNames, props }
}

function mergeClasses(c1: string, c2: string): string {
  const s = new Set([...c1.split(/\s+/), ...c2.split(/\s+/)])
  s.delete('')
  return Array.from(s).join(' ')
}

function mergeDevComponentProps(comp: DevComponent, extra?: Record<string, unknown>): DevComponent {
  if (!extra) return comp
  const props = { ...(comp.props ?? {}) }
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) continue
    if (k === 'class' || k === 'className') {
      props[k] = mergeClasses(String(props[k] || ''), String(v))
    } else {
      props[k] = v
    }
  }
  return { ...comp, props }
}

function splitTextStyles(style: Record<string, string>) {
  const textStyle: Record<string, string> = {}
  const otherStyle: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (TEXT_STYLE_PROPS.has(k)) textStyle[k] = v
    else otherStyle[k] = v
  }
  return { textStyle, otherStyle }
}

const HOISTABLE_TEXT_STYLE_KEYS = new Set([
  'color',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform'
])

function filterHoistableTextStyle(style: Record<string, string>): Record<string, string> {
  const res: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (HOISTABLE_TEXT_STYLE_KEYS.has(k)) {
      res[k] = v
    }
  }
  return res
}

function diffTextStyles(
  inherited: Record<string, string> | undefined,
  current: Record<string, string>
) {
  const appliedTextStyle: Record<string, string> = {}
  const nextTextStyle = { ...(inherited || {}) }
  for (const [k, v] of Object.entries(current)) {
    const inheritedVal = inherited?.[k]
    const inheritedCanonical = inheritedVal ? canonicalizeValue(k, inheritedVal) : undefined
    const currentCanonical = canonicalizeValue(k, v)

    if (inheritedCanonical !== currentCanonical) {
      appliedTextStyle[k] = v
    }
    nextTextStyle[k] = v
  }
  return { appliedTextStyle, nextTextStyle }
}

function getClassPropName(lang?: CodeLanguage): 'class' | 'className' {
  return lang === 'vue' ? 'class' : 'className'
}

function codegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}

function flattenSemanticNodes(nodes: SemanticNode[]): SemanticNode[] {
  const res: SemanticNode[] = []
  const traverse = (n: SemanticNode) => {
    res.push(n)
    n.children.forEach(traverse)
  }
  nodes.forEach(traverse)
  return res
}
