import { generateCodeBlocksForNode } from '@/utils/codegen'
import { runTransformVariableBatch } from '@/mcp/transform-variable'
import { buildSemanticTree } from '@/mcp/semantic-tree'
import { activePlugin, options } from '@/ui/state'
import { stringifyComponent } from '@/utils/component'
import { styleToTailwind } from '@/utils/tailwind'
import { rgbaToCss } from '@/utils/color'
import {
  TEXT_STYLE_PROPS,
  stripDefaultTextStyles,
  pruneInheritedTextStyles,
  mapTextCase,
  normalizeComparableValue
} from '@/utils/css'

import type { GetCodeResult } from '@/mcp-server/src/tools'
import type { CodeBlock } from '@/types/codegen'
import type { CodegenConfig } from '@/utils/codegen'
import type { SemanticNode } from '@/mcp/semantic-tree'
import type { DevComponent } from '@/types/plugin'

const VARIABLE_RE = /var\(--([^,)]+)(?:,\s*([^)]+))?\)/g
type TextStyleMap = Record<string, string>

type CodeLanguage = 'jsx' | 'vue'

type RenderContext = {
  styles: Map<string, Record<string, string>>
  nodes: Map<string, SceneNode>
  pluginCode?: string
  config: CodegenConfig
  preferredLang?: CodeLanguage
  detectedLang?: CodeLanguage
}

type VariableReferenceInternal = {
  nodeId: string
  property: string
  code: string
  name: string
  value?: string
}

type PropertyBucket = {
  nodeId: string
  property: string
  original: string
  matchIndices: number[]
}

export async function handleGetCode(
  nodes: SceneNode[],
  preferredLang?: CodeLanguage
): Promise<GetCodeResult> {
  if (nodes.length !== 1) {
    throw new Error('Select exactly one node or provide a single root node id.')
  }

  const tree = buildSemanticTree(nodes)
  const root = tree.roots[0]
  if (!root) {
    throw new Error('No renderable nodes found for the current selection.')
  }

  const config = codegenConfig()
  const pluginCode = activePlugin.value?.code
  const { nodes: nodeMap, styles } = await collectSceneData(tree.roots)
  await applyVariableTransforms(styles, config, pluginCode)

  const ctx: RenderContext = {
    styles,
    nodes: nodeMap,
    pluginCode,
    config,
    preferredLang
  }

  let componentTree = await renderSemanticNode(root, ctx)
  if (!componentTree) {
    throw new Error('Unable to build markup for the current selection.')
  }

  if (typeof componentTree === 'string') {
    componentTree = {
      name: root.tag || 'div',
      props: {},
      children: [componentTree]
    }
  }

  const resolvedLang = preferredLang ?? ctx.detectedLang ?? 'jsx'
  const markup = stringifyComponent(componentTree, resolvedLang)
  const message = tree.stats.capped
    ? `Selection truncated at depth ${tree.stats.depthLimit ?? tree.stats.maxDepth}.`
    : undefined

  // Default back to JSX when no language was detected
  return { lang: resolvedLang, code: markup, ...(message ? { message } : {}) }
}

async function collectSceneData(roots: SemanticNode[]): Promise<{
  nodes: Map<string, SceneNode>
  styles: Map<string, Record<string, string>>
}> {
  const semanticNodes = flattenSemanticNodes(roots)
  const nodes = new Map<string, SceneNode>()
  const styles = new Map<string, Record<string, string>>()

  await Promise.all(
    semanticNodes.map(async (semantic) => {
      const node = figma.getNodeById(semantic.id) as SceneNode | null
      if (!node || !node.visible) {
        return
      }
      nodes.set(semantic.id, node)
      try {
        const style = await node.getCSSAsync()
        styles.set(semantic.id, mergeInferredAutoLayout(style, node))
      } catch {
        // ignore nodes without computable CSS
      }
    })
  )

  return { nodes, styles }
}

async function applyVariableTransforms(
  styles: Map<string, Record<string, string>>,
  config: CodegenConfig,
  pluginCode?: string
): Promise<void> {
  const { references, buckets } = collectVariableReferences(styles)
  if (!references.length) {
    return
  }

  const replacements = await runTransformVariableBatch(
    references.map(({ code, name, value }) => ({ code, name, value })),
    {
      useRem: config.cssUnit === 'rem',
      rootFontSize: config.rootFontSize,
      scale: config.scale
    },
    pluginCode
  )

  for (const bucket of buckets.values()) {
    const style = styles.get(bucket.nodeId)
    if (!style) continue
    let occurrence = 0
    style[bucket.property] = bucket.original.replace(VARIABLE_RE, (match) => {
      const refIndex = bucket.matchIndices[occurrence++]
      return replacements[refIndex] ?? match
    })
  }
}

function collectVariableReferences(styles: Map<string, Record<string, string>>): {
  references: VariableReferenceInternal[]
  buckets: Map<string, PropertyBucket>
} {
  const references: VariableReferenceInternal[] = []
  const buckets = new Map<string, PropertyBucket>()

  for (const [nodeId, style] of styles.entries()) {
    for (const [property, value] of Object.entries(style)) {
      const normalizedValue = normalizeCssVarValue(value)
      if (normalizedValue !== value) {
        style[property] = normalizedValue
      }
      let match: RegExpExecArray | null
      while ((match = VARIABLE_RE.exec(normalizedValue))) {
        const [, name, fallback] = match
        const refIndex =
          references.push({
            nodeId,
            property,
            code: normalizedValue,
            name: normalizeCssVarName(name),
            value: fallback?.trim()
          }) - 1

        const key = `${nodeId}:${property}`
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.matchIndices.push(refIndex)
        } else {
          buckets.set(key, {
            nodeId,
            property,
            original: value,
            matchIndices: [refIndex]
          })
        }
      }
      VARIABLE_RE.lastIndex = 0
    }
  }

  return { references, buckets }
}

async function renderSemanticNode(
  semantic: SemanticNode,
  ctx: RenderContext,
  inheritedTextStyle?: TextStyleMap
): Promise<DevComponent | string | null> {
  const node = ctx.nodes.get(semantic.id)
  if (!node) {
    return null
  }

  const rawStyle = ctx.styles.get(semantic.id) ?? {}
  const pluginComponent = node.type === 'INSTANCE' ? await renderPluginComponent(node, ctx) : null

  const langHint = pluginComponent?.lang ?? ctx.preferredLang ?? ctx.detectedLang
  const classProp = getClassPropName(langHint)

  const { textStyle, otherStyle } = splitTextStyles(rawStyle)
  const cleanedTextStyle = stripDefaultTextStyles(textStyle)
  if (node.type === 'TEXT' && inheritedTextStyle?.color && cleanedTextStyle.color) {
    delete cleanedTextStyle.color
  }

  const styledSegments = node.type === 'TEXT' ? getStyledSegments(node) : null
  const hasSegmentVariants = !!styledSegments && styledSegments.length > 1
  const textSegments =
    node.type === 'TEXT'
      ? await renderTextSegments(node, classProp, ctx, {
          inheritedTextStyle,
          nodeTextStyle: cleanedTextStyle,
          segments: styledSegments ?? undefined,
          computeSegmentStyle: hasSegmentVariants
        })
      : undefined
  const effectiveTextStyle =
    node.type === 'TEXT' && hasSegmentVariants && textSegments?.commonStyle
      ? textSegments.commonStyle
      : cleanedTextStyle
  const { appliedTextStyle, nextTextStyle } = diffTextStyles(inheritedTextStyle, effectiveTextStyle)
  const baseStyleForClass = Object.keys(otherStyle).length
    ? { ...otherStyle, ...appliedTextStyle }
    : appliedTextStyle

  const styleForClass = pluginComponent
    ? pickChildLayoutStyles(baseStyleForClass)
    : baseStyleForClass
  const classString = styleToTailwind(styleForClass)
  const classNames = classString ? classString.split(/\s+/).filter(Boolean) : []
  const pluginProps =
    pluginComponent &&
    (classNames.length ||
      (semantic.dataHint?.kind === 'attr' && shouldApplyDataHint(node, semantic.dataHint)))
      ? buildPluginProps(classProp, classNames, semantic.dataHint, node)
      : undefined
  const props: Record<string, unknown> = {}
  if (classNames.length) {
    props[classProp] = classNames.join(' ')
  }
  if (semantic.dataHint?.kind === 'attr' && shouldApplyDataHint(node, semantic.dataHint)) {
    props[semantic.dataHint.name] = semantic.dataHint.value
  }

  if (pluginComponent) {
    if (pluginComponent.component) {
      return mergeDevComponentProps(pluginComponent.component, pluginProps)
    }
    const injected =
      pluginProps && pluginComponent.code
        ? injectAttributes(pluginComponent.code, pluginProps)
        : null
    return injected ?? pluginComponent.code ?? null
  }

  if (node.type === 'TEXT') {
    const segments = textSegments?.segments ?? []
    const classString = styleToTailwind(baseStyleForClass)
    const classNames = classString ? classString.split(/\s+/).filter(Boolean) : []
    if (!classNames.length && !semantic.dataHint && segments.length === 1) {
      return segments[0] ?? null
    }
    const textChild: (DevComponent | string)[] = segments.filter(Boolean) as Array<
      DevComponent | string
    >
    return {
      name: semantic.tag || 'span',
      props,
      children: textChild
    }
  }

  const children: (DevComponent | string)[] = []
  for (const child of semantic.children) {
    const rendered = await renderSemanticNode(child, ctx, nextTextStyle)
    if (rendered) {
      children.push(rendered)
    }
  }

  return { name: semantic.tag || 'div', props, children }
}

type PluginComponent = {
  component?: DevComponent
  code?: string
  lang?: CodeLanguage
}

async function renderPluginComponent(
  node: InstanceNode,
  ctx: RenderContext
): Promise<PluginComponent | null> {
  if (!ctx.pluginCode) {
    return null
  }

  const { codeBlocks, devComponent } = await generateCodeBlocksForNode(
    node,
    ctx.config,
    ctx.pluginCode,
    { returnDevComponent: true }
  )
  const detectedLang = detectLang(codeBlocks, ctx.preferredLang)
  if (!ctx.preferredLang && detectedLang && ctx.detectedLang !== 'vue') {
    ctx.detectedLang = detectedLang
  }

  const componentBlock = findComponentBlock(codeBlocks, detectedLang)
  const code = componentBlock?.code.trim()
  if (!code && !devComponent) {
    return null
  }
  return {
    component: devComponent ?? undefined,
    code: code ?? undefined,
    lang: detectedLang
  }
}

function normalizeBlockLang(lang?: string): CodeLanguage | undefined {
  if (!lang) {
    return 'jsx'
  }
  if (lang === 'jsx' || lang === 'vue') {
    return lang
  }
  if (lang === 'tsx') {
    return 'jsx'
  }
  return undefined
}

function detectLang(blocks: CodeBlock[], preferredLang?: CodeLanguage): CodeLanguage | undefined {
  if (preferredLang) {
    return preferredLang
  }
  let hasJSX = false
  for (const block of blocks) {
    const lang = normalizeBlockLang(block.lang)
    if (lang === 'vue') {
      return 'vue'
    }
    if (lang === 'jsx') {
      hasJSX = true
    }
  }
  return hasJSX ? 'jsx' : undefined
}

function findComponentBlock(
  blocks: CodeBlock[],
  preferredLang?: CodeLanguage
): CodeBlock | undefined {
  const componentBlocks = blocks.filter((block) => block.name === 'component')
  if (preferredLang) {
    return componentBlocks.find((block) => normalizeBlockLang(block.lang) === preferredLang)
  }
  return (
    componentBlocks.find((block) => normalizeBlockLang(block.lang) === 'vue') ??
    componentBlocks.find((block) => normalizeBlockLang(block.lang) === 'jsx')
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
  for (const [key, value] of Object.entries(style)) {
    if (CHILD_LAYOUT_PROPS.has(key)) {
      picked[key] = value
    }
  }
  return picked
}

function getClassPropName(lang?: CodeLanguage): 'class' | 'className' {
  return lang === 'vue' ? 'class' : 'className'
}

function injectAttributes(markup: string, attrs: Record<string, string>): string | null {
  const entries = Object.entries(attrs).filter(([, value]) => value != null && String(value).trim())
  if (!entries.length) {
    return markup
  }

  const match = markup.match(/^\s*<\s*([^<>\s/]+)([^>]*?)(\/?>)/s)
  if (!match) {
    return null
  }

  const [, tagName, rawAttrs = '', closer] = match
  let updatedAttrs = rawAttrs

  for (const [key, value] of entries) {
    const safeValue = String(value).trim()
    if (!safeValue) continue

    const attrName = key
    const attrRegex = new RegExp(`(\\s${attrName}\\s*=\\s*)(\"([^\"]*)\"|'([^']*)')`)

    if ((attrName === 'class' || attrName === 'className') && attrRegex.test(updatedAttrs)) {
      updatedAttrs = updatedAttrs.replace(attrRegex, (_m, prefix, _quoted, dq, sq) => {
        const current = dq ?? sq ?? ''
        const merged = mergeClasses(current, safeValue)
        return `${prefix}"${merged}"`
      })
      continue
    }

    const spacer = updatedAttrs.trim().length ? ' ' : ''
    updatedAttrs = `${updatedAttrs}${spacer}${attrName}="${safeValue}"`
  }

  const openTag = `<${tagName}${updatedAttrs}${closer}`
  return openTag + markup.slice(match[0].length)
}

function mergeDevComponentProps(
  component: DevComponent,
  extraProps?: Record<string, unknown>
): DevComponent {
  if (!extraProps) {
    return component
  }
  const props: Record<string, unknown> = { ...(component.props ?? {}) }
  for (const [key, value] of Object.entries(extraProps)) {
    if (value == null) continue
    if (key === 'class' || key === 'className') {
      const current = typeof props[key] === 'string' ? (props[key] as string) : ''
      props[key] = mergeClasses(current, String(value))
    } else {
      props[key] = value
    }
  }
  return { ...component, props }
}

function mergeClasses(existing: string, extra: string): string {
  const parts = [...existing.split(/\s+/), ...extra.split(/\s+/)]
    .map((p) => p.trim())
    .filter(Boolean)
  return Array.from(new Set(parts)).join(' ')
}

function buildPluginProps(
  classProp: string,
  classNames: string[],
  dataHint: { kind: string; name: string; value: unknown } | undefined,
  node: SceneNode
): Record<string, string> {
  const props: Record<string, string> = {}
  if (classNames.length) {
    props[classProp] = classNames.join(' ')
  }
  if (dataHint?.kind === 'attr' && dataHint.value != null && shouldApplyDataHint(node, dataHint)) {
    props[dataHint.name] = String(dataHint.value)
  }
  return props
}

function shouldApplyDataHint(node: SceneNode, dataHint: { name: string }): boolean {
  // Skip component metadata on component instances
  if (dataHint.name === 'data-tp' && node.type === 'INSTANCE') {
    return false
  }
  return true
}

type AutoLayoutLike = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  itemSpacing?: number
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
}

function mergeInferredAutoLayout(
  style: Record<string, string>,
  node: SceneNode
): Record<string, string> {
  const source = getAutoLayoutSource(node)
  if (!source || source.layoutMode === 'NONE') {
    return style
  }

  const {
    layoutMode,
    itemSpacing,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft
  } = source

  const merged: Record<string, string> = { ...style }
  const display = merged.display?.trim()
  if (!display || !display.includes('flex')) {
    merged.display = 'flex'
  }

  const direction = layoutMode === 'HORIZONTAL' ? 'row' : 'column'
  if (!merged['flex-direction']) {
    merged['flex-direction'] = direction
  }

  if (typeof itemSpacing === 'number' && !hasGap(merged)) {
    merged.gap = `${Math.round(itemSpacing)}px`
  }

  const justify = mapAxisAlignToCss(primaryAxisAlignItems)
  if (justify && !merged['justify-content']) {
    merged['justify-content'] = justify
  }

  const align = mapAxisAlignToCss(counterAxisAlignItems)
  if (align && !merged['align-items']) {
    merged['align-items'] = align
  }

  const allowPadding = node.type !== 'INSTANCE'
  if (allowPadding && !hasPadding(merged)) {
    if (
      paddingTop ||
      paddingRight ||
      paddingBottom ||
      paddingLeft ||
      paddingTop === 0 ||
      paddingRight === 0 ||
      paddingBottom === 0 ||
      paddingLeft === 0
    ) {
      merged['padding-top'] = `${paddingTop ?? 0}px`
      merged['padding-right'] = `${paddingRight ?? 0}px`
      merged['padding-bottom'] = `${paddingBottom ?? 0}px`
      merged['padding-left'] = `${paddingLeft ?? 0}px`
    }
  }

  return merged
}

function hasGap(style: Record<string, string>): boolean {
  return !!(style.gap || style['row-gap'] || style['column-gap'])
}

function hasPadding(style: Record<string, string>): boolean {
  return !!(
    style.padding ||
    style['padding-top'] ||
    style['padding-right'] ||
    style['padding-bottom'] ||
    style['padding-left']
  )
}

function getAutoLayoutSource(node: SceneNode): AutoLayoutLike | undefined {
  if ('layoutMode' in node && node.layoutMode !== undefined) {
    return node as unknown as AutoLayoutLike
  }
  if ('inferredAutoLayout' in node) {
    return (
      (node as unknown as { inferredAutoLayout?: AutoLayoutLike | null }).inferredAutoLayout ??
      undefined
    )
  }
  return undefined
}

function mapAxisAlignToCss(value?: string): string | undefined {
  switch (value) {
    case 'MIN':
      return 'flex-start'
    case 'MAX':
      return 'flex-end'
    case 'CENTER':
      return 'center'
    case 'SPACE_BETWEEN':
      return 'space-between'
    case 'STRETCH':
      return 'stretch'
    default:
      return undefined
  }
}

function splitTextStyles(style: Record<string, string>): {
  textStyle: Record<string, string>
  otherStyle: Record<string, string>
} {
  const textStyle: Record<string, string> = {}
  const otherStyle: Record<string, string> = {}

  for (const [key, value] of Object.entries(style)) {
    if (TEXT_STYLE_PROPS.has(key)) {
      textStyle[key] = value
    } else {
      otherStyle[key] = value
    }
  }

  return { textStyle, otherStyle }
}

function diffTextStyles(
  inherited: TextStyleMap | undefined,
  current: Record<string, string>
): {
  appliedTextStyle: Record<string, string>
  nextTextStyle: TextStyleMap | undefined
} {
  const entries = Object.entries(current)
  if (!entries.length) {
    return {
      appliedTextStyle: {},
      nextTextStyle: inherited
    }
  }

  const nextStyle = inherited ? { ...inherited } : {}
  let applied: Record<string, string> | undefined

  for (const [key, value] of entries) {
    if (!inherited || inherited[key] !== value) {
      if (!applied) {
        applied = {}
      }
      applied[key] = value
    }
    nextStyle[key] = value
  }

  return {
    appliedTextStyle: applied ?? {},
    nextTextStyle: nextStyle
  }
}

function formatTextLiteral(value: string): string | null {
  if (!value.trim()) {
    return null
  }
  return value
}

const SEGMENT_FIELDS = [
  'characters',
  'start',
  'end',
  'fontName',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
  'paragraphSpacing',
  'indentation',
  'listOptions',
  'fills',
  'textStyleId',
  'fillStyleId',
  'boundVariables'
] as const
type SegmentFieldForRequest = Exclude<
  (typeof SEGMENT_FIELDS)[number],
  'characters' | 'start' | 'end'
>
const REQUESTED_SEGMENT_FIELDS: SegmentFieldForRequest[] = [
  'fontName',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
  'paragraphSpacing',
  'indentation',
  'listOptions',
  'fills',
  'textStyleId',
  'fillStyleId',
  'boundVariables'
] as const

type VariableAlias = { id?: string; type?: string }
type StyledTextSegmentSubset = Pick<StyledTextSegment, (typeof SEGMENT_FIELDS)[number]>
type RenderTextSegmentsOptions = {
  inheritedTextStyle?: TextStyleMap
  nodeTextStyle?: TextStyleMap
  segments?: StyledTextSegmentSubset[] | null
  computeSegmentStyle?: boolean
}
const TYPO_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent'
] as const
type TokenRef = {
  id: string
  name: string
  collectionName?: string
  codeSyntax?: Record<string, string> | null
}
type SegmentTypographyTokens = Partial<Record<(typeof TYPO_FIELDS)[number], TokenRef>>
type SegmentFillToken = {
  type: Paint['type']
  color?: TokenRef | null
  other?: Record<string, TokenRef | null>
}
type SegmentStyleTokens = {
  typography: SegmentTypographyTokens
  fills: SegmentFillToken[]
}
type SegmentStyleRefs = {
  textStyleId?: string | null
  fillStyleId?: string | null
}
type SegmentStyleMeta = {
  raw: {
    fontName?: FontName
    fontSize?: number
    fontWeight?: number
    fontStyle?: FontStyle
    lineHeight?: LineHeight
    letterSpacing?: LetterSpacing
    textCase?: TextCase
    textDecoration?: TextDecoration
    textDecorationStyle?: TextDecorationStyle | null
    textDecorationOffset?: TextDecorationOffset | null
    textDecorationThickness?: TextDecorationThickness | null
    textDecorationColor?: TextDecorationColor | null
    textDecorationSkipInk?: boolean | null
    paragraphSpacing?: number
    indentation?: number
    listOptions?: TextListOptions
    fills?: Paint[]
  }
  tokens: SegmentStyleTokens
  refs: SegmentStyleRefs
}

function getStyledSegments(node: TextNode): StyledTextSegmentSubset[] | null {
  try {
    if (typeof node.getStyledTextSegments !== 'function') {
      return null
    }
    const segments = node.getStyledTextSegments(REQUESTED_SEGMENT_FIELDS)
    return Array.isArray(segments) ? (segments as StyledTextSegmentSubset[]) : null
  } catch {
    return null
  }
}

function normalizeCssVarName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
  if (!cleaned) return 'var'
  if (/^[0-9-]/.test(cleaned)) {
    return `var-${cleaned.replace(/^-+/, '')}`
  }
  return cleaned
}

function normalizeCssVarValue(value: string): string {
  return value.replace(VARIABLE_RE, (_match, name: string, fallback?: string) => {
    const normalized = normalizeCssVarName(name)
    return fallback ? `var(--${normalized}, ${fallback})` : `var(--${normalized})`
  })
}

function resolveAliasToTokenSync(alias: VariableAlias | null | undefined): TokenRef | null {
  if (!alias || typeof alias !== 'object') return null
  const id = 'id' in alias ? alias.id : undefined
  if (!id) return null

  try {
    const variable = figma.variables.getVariableById(id)
    if (!variable) return null
    const collection = variable.variableCollectionId
      ? figma.variables.getVariableCollectionById(variable.variableCollectionId)
      : null
    return {
      id: variable.id,
      name: variable.name,
      collectionName: collection?.name,
      codeSyntax: (variable as { codeSyntax?: Record<string, string> }).codeSyntax ?? null
    }
  } catch {
    return null
  }
}

function resolveTypographyTokens(
  textNode: TextNode,
  seg: StyledTextSegmentSubset
): SegmentTypographyTokens {
  const tokens: SegmentTypographyTokens = {}

  // A. Segment direct bindings
  TYPO_FIELDS.forEach((field) => {
    const token = resolveAliasToTokenSync(
      (seg.boundVariables as Record<string, VariableAlias> | undefined)?.[field]
    )
    if (token) {
      tokens[field] = token
    }
  })

  // B. Text style bindings
  if (seg.textStyleId && typeof seg.textStyleId === 'string') {
    try {
      const style = figma.getStyleById(seg.textStyleId) as TextStyle
      if (style?.boundVariables) {
        TYPO_FIELDS.forEach((field) => {
          if (tokens[field]) return
          const token = resolveAliasToTokenSync(
            (style.boundVariables as Record<string, VariableAlias> | undefined)?.[field]
          )
          if (token) {
            tokens[field] = token
          }
        })
      }
    } catch {
      // ignore style lookup errors
    }
  }

  // C. Range fallback
  TYPO_FIELDS.forEach((field) => {
    if (tokens[field]) return
    try {
      const alias = textNode.getRangeBoundVariable(
        seg.start,
        seg.end,
        field as VariableBindableTextField
      )
      const token = resolveAliasToTokenSync(alias as VariableAlias)
      if (token) {
        tokens[field] = token
      }
    } catch {
      // ignore unavailable API
    }
  })

  return tokens
}

function resolveFillTokens(seg: StyledTextSegmentSubset): SegmentStyleTokens['fills'] {
  const fills = Array.isArray(seg.fills) ? (seg.fills as Paint[]) : []
  const tokens: SegmentStyleTokens['fills'] = []

  fills.forEach((paint) => {
    if (paint.type === 'SOLID') {
      const colorToken = resolveAliasToTokenSync(
        (paint as SolidPaint & { boundVariables?: { color?: VariableAlias } }).boundVariables?.color
      )
      tokens.push({ type: 'SOLID', color: colorToken ?? null })
      return
    }

    const other: Record<string, TokenRef | null> = {}
    const bound = (paint as { boundVariables?: Record<string, VariableAlias> }).boundVariables
    if (bound) {
      Object.entries(bound).forEach(([key, alias]) => {
        other[key] = resolveAliasToTokenSync(alias)
      })
    }
    tokens.push({ type: paint.type, other })
  })

  return tokens
}

function buildSegmentMeta(textNode: TextNode, seg: StyledTextSegmentSubset): SegmentStyleMeta {
  return {
    raw: {
      fontName: seg.fontName,
      fontSize: seg.fontSize,
      fontWeight: seg.fontWeight,
      fontStyle: seg.fontStyle,
      lineHeight: seg.lineHeight,
      letterSpacing: seg.letterSpacing,
      textCase: seg.textCase,
      textDecoration: seg.textDecoration,
      textDecorationStyle: seg.textDecorationStyle,
      textDecorationOffset: seg.textDecorationOffset,
      textDecorationThickness: seg.textDecorationThickness,
      textDecorationColor: seg.textDecorationColor,
      textDecorationSkipInk: seg.textDecorationSkipInk,
      paragraphSpacing: seg.paragraphSpacing,
      indentation: seg.indentation,
      listOptions: seg.listOptions,
      fills: seg.fills
    },
    tokens: {
      typography: resolveTypographyTokens(textNode, seg),
      fills: resolveFillTokens(seg)
    },
    refs: {
      textStyleId: seg.textStyleId ?? null,
      fillStyleId: seg.fillStyleId ?? null
    }
  }
}

function pickSolidPaint(paints?: Paint[]): SolidPaint | undefined {
  if (!Array.isArray(paints)) return undefined
  return paints.find((fill) => fill.type === 'SOLID' && fill.visible !== false) as SolidPaint
}

function formatSolidPaintColor(paint?: SolidPaint): string | undefined {
  if (!paint || paint.type !== 'SOLID') return undefined
  return paint.color ? rgbaToCss(paint.color, paint.opacity) : undefined
}

function inferFontWeight(styleName?: string | null, explicit?: number): number | undefined {
  if (typeof explicit === 'number') {
    return explicit
  }
  if (!styleName) return undefined
  const matched = styleName.match(/(\d{3})/)
  if (matched) return Number(matched[1])
  const lowered = styleName.toLowerCase()
  if (lowered.includes('black')) return 900
  if (lowered.includes('extrabold') || lowered.includes('ultrabold')) return 800
  if (lowered.includes('bold')) return 700
  if (lowered.includes('semibold') || lowered.includes('demibold')) return 600
  if (lowered.includes('medium')) return 500
  if (lowered.includes('light')) return 300
  if (lowered.includes('thin')) return 200
  return undefined
}

function formatLineHeightValue(lineHeight?: LineHeight): string | undefined {
  if (!lineHeight) return undefined
  if (lineHeight.unit === 'AUTO') return 'normal'
  if ('value' in lineHeight) {
    return lineHeight.unit === 'PERCENT' ? `${lineHeight.value}%` : `${lineHeight.value}px`
  }
  return undefined
}

function formatLetterSpacingValue(letterSpacing?: LetterSpacing): string | undefined {
  if (!letterSpacing || !('value' in letterSpacing)) return undefined
  return letterSpacing.unit === 'PERCENT' ? `${letterSpacing.value}%` : `${letterSpacing.value}px`
}

function mapTextDecorationLine(decoration?: TextDecoration): string | undefined {
  switch (decoration) {
    case 'UNDERLINE':
      return 'underline'
    case 'STRIKETHROUGH':
      return 'line-through'
    default:
      return undefined
  }
}

function formatTextDecorationThickness(
  thickness?: TextDecorationThickness | null
): string | undefined {
  if (!thickness || thickness.unit === 'AUTO') return undefined
  return thickness.unit === 'PERCENT' ? `${thickness.value}%` : `${thickness.value}px`
}

function formatTextDecorationOffset(offset?: TextDecorationOffset | null): string | undefined {
  if (!offset || offset.unit === 'AUTO') return undefined
  return offset.unit === 'PERCENT' ? `${offset.value}%` : `${offset.value}px`
}

function formatTextDecorationColor(color?: TextDecorationColor | null): string | undefined {
  if (!color || color.value === 'AUTO') return undefined
  return formatSolidPaintColor(color.value as SolidPaint)
}

function formatTokenExpression(token?: TokenRef | null, fallback?: string): string | undefined {
  if (token) {
    return `var(--${normalizeCssVarName(token.name)})`
  }
  const safeFallback = fallback?.trim()
  return safeFallback && safeFallback.length ? safeFallback : undefined
}

function buildSegmentStyle(meta: SegmentStyleMeta): Record<string, string> {
  const { raw, tokens } = meta
  const style: Record<string, string> = {}

  const solid = pickSolidPaint(raw.fills)
  const fallbackColor = formatSolidPaintColor(solid)
  const colorToken = tokens.fills.find((fill) => fill.color)?.color
  const color = formatTokenExpression(colorToken, fallbackColor)
  if (color) {
    style.color = color
  }

  if (raw.fontName?.family) {
    const fontFamily = formatTokenExpression(tokens.typography.fontFamily, raw.fontName.family)
    if (fontFamily) {
      style['font-family'] = fontFamily
    }
  }

  const weight = inferFontWeight(raw.fontName?.style, raw.fontWeight)
  if (weight != null) {
    const fontWeight = formatTokenExpression(tokens.typography.fontWeight, `${weight}`)
    if (fontWeight) {
      style['font-weight'] = fontWeight
    }
  }

  const fontStyleValue = raw.fontStyle === 'ITALIC' ? 'italic' : 'normal'
  const fontStyle = formatTokenExpression(tokens.typography.fontStyle, fontStyleValue)
  if (fontStyle) {
    style['font-style'] = fontStyle
  }

  const size = typeof raw.fontSize === 'number' ? `${raw.fontSize}px` : undefined
  const fontSize = formatTokenExpression(tokens.typography.fontSize, size)
  if (fontSize) {
    style['font-size'] = fontSize
  }

  const lineHeightValue = formatLineHeightValue(raw.lineHeight)
  const lineHeight = formatTokenExpression(tokens.typography.lineHeight, lineHeightValue)
  if (lineHeight) {
    style['line-height'] = lineHeight
  }

  const letterSpacingValue = formatLetterSpacingValue(raw.letterSpacing)
  const letterSpacing = formatTokenExpression(tokens.typography.letterSpacing, letterSpacingValue)
  if (letterSpacing) {
    style['letter-spacing'] = letterSpacing
  }

  const textTransform = raw.textCase ? mapTextCase(raw.textCase) : undefined
  if (textTransform) {
    style['text-transform'] = textTransform
  }

  const decorationLine = mapTextDecorationLine(raw.textDecoration)
  if (decorationLine) {
    style['text-decoration-line'] = decorationLine
  }
  if (raw.textDecorationStyle) {
    style['text-decoration-style'] = raw.textDecorationStyle.toLowerCase()
  }
  const decorationThickness = formatTextDecorationThickness(raw.textDecorationThickness)
  if (decorationThickness) {
    style['text-decoration-thickness'] = decorationThickness
  }
  const decorationOffset = formatTextDecorationOffset(raw.textDecorationOffset)
  if (decorationOffset) {
    style['text-underline-offset'] = decorationOffset
  }
  if (typeof raw.textDecorationSkipInk === 'boolean') {
    style['text-decoration-skip-ink'] = raw.textDecorationSkipInk ? 'auto' : 'none'
  }
  const decorationColor = formatTextDecorationColor(raw.textDecorationColor)
  if (decorationColor) {
    style['text-decoration-color'] = decorationColor
  }

  return style
}

async function renderTextSegments(
  node: TextNode,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  {
    inheritedTextStyle,
    nodeTextStyle,
    segments: providedSegments,
    computeSegmentStyle = true
  }: RenderTextSegmentsOptions
): Promise<{
  segments: Array<DevComponent | string>
  commonStyle: Record<string, string>
  metas: SegmentStyleMeta[]
}> {
  const segments: Array<DevComponent | string> = []
  const segStyles: Array<Record<string, string>> = []
  const metas: SegmentStyleMeta[] = []
  const rawSegments = providedSegments ?? getStyledSegments(node)

  if (!rawSegments || !rawSegments.length) {
    const literal = formatTextLiteral(node.characters ?? '')
    if (literal) segments.push(literal)
    return { segments, commonStyle: {}, metas }
  }

  rawSegments.forEach((seg) => {
    const literal = formatTextLiteral(seg.characters ?? '')
    if (!literal) return

    let child: DevComponent | string = literal
    const weight = inferFontWeight(seg.fontName?.style, seg.fontWeight)
    const styleName = seg.fontName?.style?.toLowerCase() ?? ''
    const isBold =
      typeof weight === 'number'
        ? weight >= 600 || weight === 500
        : styleName.includes('bold') ||
          styleName.includes('semibold') ||
          styleName.includes('medium') ||
          styleName.includes('black')
    const isItalic =
      seg.fontStyle === 'ITALIC' || styleName.includes('italic') || styleName.includes('oblique')

    const decorationLine = mapTextDecorationLine(seg.textDecoration)
    const isUnderline = decorationLine === 'underline'
    const isStrike = decorationLine === 'line-through'

    if (isBold) {
      child = { name: 'strong', props: {}, children: [child] }
    }
    if (isItalic) {
      child = { name: 'em', props: {}, children: [child] }
    }
    if (isUnderline) {
      child = { name: 'u', props: {}, children: [child] }
    }
    if (isStrike) {
      child = { name: 'del', props: {}, children: [child] }
    }

    if (computeSegmentStyle) {
      const meta = buildSegmentMeta(node, seg)
      metas.push(meta)
      segStyles.push(buildSegmentStyle(meta))
    }
    segments.push(child)
  })

  if (!computeSegmentStyle || !segStyles.length) {
    return { segments, commonStyle: {}, metas }
  }

  const styleMap = new Map<string, Record<string, string>>()
  segStyles.forEach((style, index) => {
    styleMap.set(`${node.id}:seg:${index}`, style)
  })
  await applyVariableTransforms(styleMap, ctx.config, ctx.pluginCode)

  const cleanedStyles = segStyles.map((style) => {
    const cleaned = stripDefaultTextStyles({ ...style })
    pruneInheritedTextStyles(cleaned, inheritedTextStyle)
    return cleaned
  })

  const dominantStyle = computeDominantStyle(cleanedStyles)
  const commonStyle = dominantStyle

  segments.forEach((seg, idx) => {
    const style = omitCommon(cleanedStyles[idx], dominantStyle)
    if (!Object.keys(style).length) return
    const cls = styleToTailwind(style)
    if (!cls) return
    segments[idx] =
      typeof seg === 'string'
        ? { name: 'span', props: { [classProp]: cls }, children: [seg] }
        : { ...seg, props: { ...(seg.props ?? {}), [classProp]: cls } }
  })

  return { segments, commonStyle, metas }
}

function flattenSemanticNodes(nodes: SemanticNode[]): SemanticNode[] {
  const result: SemanticNode[] = []
  const visit = (node: SemanticNode) => {
    result.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

function computeCommonStyle(styles: Array<Record<string, string>>): Record<string, string> {
  if (!styles.length) return {}
  const common: Record<string, string> = { ...styles[0] }
  styles.slice(1).forEach((style) => {
    Object.keys(common).forEach((key) => {
      if (!(key in style)) {
        delete common[key]
        return
      }
      if (
        normalizeComparableValue(key, style[key]) !== normalizeComparableValue(key, common[key])
      ) {
        delete common[key]
      }
    })
  })
  return common
}

function computeDominantStyle(styles: Array<Record<string, string>>): Record<string, string> {
  if (!styles.length) return {}
  const counts = new Map<string, Map<string, { raw: string; count: number }>>()

  styles.forEach((style) => {
    Object.entries(style).forEach(([key, value]) => {
      const normalized = normalizeComparableValue(key, value)
      const perProp = counts.get(key) ?? new Map<string, { raw: string; count: number }>()
      const entry = perProp.get(normalized)
      perProp.set(normalized, { raw: entry?.raw ?? value, count: (entry?.count ?? 0) + 1 })
      counts.set(key, perProp)
    })
  })

  const dominant: Record<string, string> = {}
  counts.forEach((perProp, key) => {
    const total = Array.from(perProp.values()).reduce((sum, item) => sum + item.count, 0)
    let best: { raw: string; count: number } | undefined
    for (const entry of perProp.values()) {
      if (!best || entry.count > best.count) {
        best = entry
      }
    }
    if (best && best.count > 1 && best.count >= total / 2) {
      dominant[key] = best.raw
    }
  })

  return dominant
}

function omitCommon(
  style: Record<string, string>,
  common: Record<string, string>
): Record<string, string> {
  if (!common || !Object.keys(common).length) return style
  const result: Record<string, string> = {}
  Object.entries(style).forEach(([key, value]) => {
    if (
      !common[key] ||
      normalizeComparableValue(key, value) !== normalizeComparableValue(key, common[key])
    ) {
      result[key] = value
    }
  })
  return result
}

function codegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}
