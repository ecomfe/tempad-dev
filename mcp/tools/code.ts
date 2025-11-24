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
  mapTextCase
} from '@/utils/css'

import type { GetCodeResult } from '@/mcp-server/src/tools'
import type { CodeBlock } from '@/types/codegen'
import type { CodegenConfig } from '@/utils/codegen'
import type { SemanticNode } from '@/mcp/semantic-tree'
import type { DevComponent } from '@/types/plugin'

const VARIABLE_RE = /var\(--([a-zA-Z\d-]+)(?:,\s*([^)]+))?\)/g
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
      let match: RegExpExecArray | null
      while ((match = VARIABLE_RE.exec(value))) {
        const [, name, fallback] = match
        const refIndex =
          references.push({
            nodeId,
            property,
            code: value,
            name,
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

  const textData =
    node.type === 'TEXT' ? renderTextSegments(node, classProp, inheritedTextStyle) : undefined
  const commonTextStyle = textData?.commonStyle ?? {}

  const { textStyle, otherStyle } = splitTextStyles(rawStyle)
  const cleanedTextStyle = stripDefaultTextStyles(textStyle)
  const effectiveTextStyle =
    node.type === 'TEXT'
      ? Object.keys(commonTextStyle).length
        ? commonTextStyle
        : cleanedTextStyle
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
    const textSegments =
      textData?.segments ?? renderTextSegments(node, classProp, effectiveTextStyle).segments
    const classString = styleToTailwind(baseStyleForClass)
    const classNames = classString ? classString.split(/\s+/).filter(Boolean) : []
    if (!classNames.length && !semantic.dataHint && textSegments.length === 1) {
      return textSegments[0] ?? null
    }
    const textChild: (DevComponent | string)[] = textSegments.filter(Boolean) as Array<
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
  return JSON.stringify(value)
}

function renderTextSegments(
  node: TextNode,
  classProp: 'class' | 'className',
  inheritedTextStyle?: TextStyleMap
): { segments: Array<DevComponent | string>; commonStyle: Record<string, string> } {
  const segments: Array<DevComponent | string> = []
  const segStyles: Array<Record<string, string>> = []
  let rawSegments: Array<{
    characters: string
    fontName?: FontName
    textDecoration?: TextDecoration
    fills?: Paint[]
    fontSize?: number
    lineHeight?: LineHeight
    letterSpacing?: LetterSpacing
    textCase?: TextCase
  }> | null = null

  try {
    const styled =
      typeof node.getStyledTextSegments === 'function'
        ? node.getStyledTextSegments([
            'fontName',
            'textDecoration',
            'fills',
            'fontSize',
            'lineHeight',
            'letterSpacing',
            'textCase'
          ])
        : null
    if (Array.isArray(styled)) {
      rawSegments = styled
    }
  } catch {
    rawSegments = null
  }

  if (!rawSegments || !rawSegments.length) {
    const literal = formatTextLiteral(node.characters ?? '')
    if (literal) segments.push(literal)
    return { segments, commonStyle: {} }
  }

  rawSegments.forEach((seg) => {
    const literal = formatTextLiteral(seg.characters ?? '')
    if (!literal) return

    let child: DevComponent | string = literal
    const styleName = seg.fontName?.style?.toLowerCase() ?? ''
    const isItalic = styleName.includes('italic')
    const isBold =
      styleName.includes('bold') ||
      styleName.includes('semibold') ||
      styleName.includes('medium') ||
      styleName.includes('black')

    const decoration = seg.textDecoration
    const isUnderline = decoration === 'UNDERLINE'
    const isStrike = decoration === 'STRIKETHROUGH'

    const segStyle: Record<string, string> = {}
    if (seg.fontName?.family) {
      segStyle['font-family'] = seg.fontName.family
    }
    if (Array.isArray(seg.fills)) {
      const solid = seg.fills.find((fill) => fill.type === 'SOLID' && fill.visible !== false) as
        | SolidPaint
        | undefined
      if (solid?.color) {
        segStyle.color = rgbaToCss(solid.color, solid.opacity)
      }
    }
    if (seg.fontSize) {
      segStyle['font-size'] = `${seg.fontSize}px`
    }
    if (seg.lineHeight) {
      const lh = seg.lineHeight
      if (lh.unit === 'AUTO') {
        segStyle['line-height'] = 'normal'
      } else if ('value' in lh) {
        segStyle['line-height'] = lh.unit === 'PERCENT' ? `${lh.value}%` : `${lh.value}px`
      }
    }
    if (seg.letterSpacing) {
      const ls = seg.letterSpacing
      if ('value' in ls) {
        segStyle['letter-spacing'] = ls.unit === 'PERCENT' ? `${ls.value}%` : `${ls.value}px`
      }
    }
    if (seg.textCase) {
      const textTransform = mapTextCase(seg.textCase)
      if (textTransform) {
        segStyle['text-transform'] = textTransform
      }
    }

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

    const cleanedSegStyle = stripDefaultTextStyles(segStyle)
    pruneInheritedTextStyles(cleanedSegStyle, inheritedTextStyle)
    segStyles.push(cleanedSegStyle)

    segments.push(child)
  })

  const commonStyle = computeCommonStyle(segStyles)

  // Apply remaining per-segment styles as classes
  segments.forEach((seg, idx) => {
    const style = omitCommon(segStyles[idx], commonStyle)
    if (Object.keys(style).length === 0) return
    const cls = styleToTailwind(style)
    if (!cls) return
    segments[idx] =
      typeof seg === 'string'
        ? { name: 'span', props: { [classProp]: cls }, children: [seg] }
        : { ...seg, props: { ...(seg.props ?? {}), [classProp]: cls } }
  })

  return { segments, commonStyle }
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
      if (!(key in style) || style[key] !== common[key]) {
        delete common[key]
      }
    })
  })
  return common
}

function omitCommon(
  style: Record<string, string>,
  common: Record<string, string>
): Record<string, string> {
  if (!common || !Object.keys(common).length) return style
  const result: Record<string, string> = {}
  Object.entries(style).forEach(([key, value]) => {
    if (common[key] !== value) {
      result[key] = value
    }
  })
  return result
}

function codegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}
