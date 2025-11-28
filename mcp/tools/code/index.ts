import type { GetCodeResult } from '@/mcp-server/src/tools'
import type { SemanticNode } from '@/mcp/semantic-tree'
import type { CodeBlock } from '@/types/codegen'
import type { DevComponent } from '@/types/plugin'
import type { CodegenConfig } from '@/utils/codegen'

import { buildSemanticTree } from '@/mcp/semantic-tree'
import { activePlugin, options } from '@/ui/state'
import { generateCodeBlocksForNode } from '@/utils/codegen'
import { stringifyComponent } from '@/utils/component'
import { TEXT_STYLE_PROPS, stripDefaultTextStyles } from '@/utils/css'
import { joinClassNames } from '@/utils/tailwind'

import {
  applyVariableTransforms,
  mergeInferredAutoLayout,
  inferResizingStyles,
  styleToClassNames
} from './style'
import { renderTextSegments } from './text'

export type CodeLanguage = 'jsx' | 'vue'

export type CodegenOptions = {
  preferredLang?: CodeLanguage
  attributeName?: 'class' | 'className'
}

export type RenderContext = {
  styles: Map<string, Record<string, string>>
  nodes: Map<string, SceneNode>
  svgs: Map<string, string>
  pluginCode?: string
  config: CodegenConfig
  options: CodegenOptions
  detectedLang?: CodeLanguage
}

type DataHint = { kind: string; name: string; value: unknown }

export async function handleGetCode(
  node: SceneNode,
  opts: CodegenOptions = {}
): Promise<GetCodeResult & { assets: Record<string, string> }> {
  if (!node || !node.visible) {
    throw new Error('The selected node is not visible or valid.')
  }

  const tree = buildSemanticTree([node])
  const root = tree.roots[0]
  if (!root) {
    throw new Error('Unable to process the selected node.')
  }

  const config = codegenConfig()
  const pluginCode = activePlugin.value?.code

  const { nodes: nodeMap, styles, svgs } = await collectSceneData(tree.roots)

  await applyVariableTransforms(styles, {
    config,
    pluginCode
  })

  const ctx: RenderContext = {
    styles,
    nodes: nodeMap,
    svgs,
    pluginCode,
    config,
    options: opts
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

  const resolvedLang = opts.preferredLang ?? ctx.detectedLang ?? 'jsx'
  const markup = stringifyComponent(componentTree, resolvedLang)

  const message = tree.stats.capped
    ? `Selection truncated at depth ${tree.stats.depthLimit ?? tree.stats.maxDepth}.`
    : undefined

  return {
    lang: resolvedLang,
    code: markup,
    assets: {},
    ...(message ? { message } : {})
  }
}

async function collectSceneData(roots: SemanticNode[]): Promise<{
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
        const svgString = String.fromCharCode.apply(null, Array.from(svgUint8))
        svgs.set(semantic.id, svgString)
      } catch {
        // Fallback
      }
    } else {
      try {
        const css = await node.getCSSAsync()
        let merged = mergeInferredAutoLayout(css, node)
        merged = inferResizingStyles(merged, node)

        if (hasImageFills(node)) {
          merged = replaceImageUrlsWithPlaceholder(merged, node)
        }

        styles.set(semantic.id, merged)
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

function replaceImageUrlsWithPlaceholder(
  style: Record<string, string>,
  node: SceneNode
): Record<string, string> {
  if (!style.background && !style['background-image']) return style

  let w = 100
  let h = 100
  if ('width' in node && typeof node.width === 'number') w = Math.round(node.width)
  if ('height' in node && typeof node.height === 'number') h = Math.round(node.height)

  const placeholderUrl = `https://placehold.co/${w}x${h}`

  const result = { ...style }
  const keysToReplace = ['background', 'background-image']

  keysToReplace.forEach((key) => {
    if (!result[key]) return
    result[key] = result[key].replace(/url\((['"]?)(.*?)\1\)/g, `url('${placeholderUrl}')`)
  })

  return result
}

async function renderSemanticNode(
  semantic: SemanticNode,
  ctx: RenderContext,
  inheritedTextStyle?: Record<string, string>
): Promise<DevComponent | string | null> {
  const node = ctx.nodes.get(semantic.id)
  if (!node) return null

  if (ctx.svgs.has(semantic.id)) {
    return ctx.svgs.get(semantic.id)!
  }

  const rawStyle = ctx.styles.get(semantic.id) ?? {}
  const pluginComponent = node.type === 'INSTANCE' ? await renderPluginComponent(node, ctx) : null

  if (pluginComponent?.lang && !ctx.options.preferredLang && ctx.detectedLang !== 'vue') {
    ctx.detectedLang = pluginComponent.lang
  }

  const langHint = pluginComponent?.lang ?? ctx.options.preferredLang ?? ctx.detectedLang
  const classProp = getClassPropName(langHint)

  const { textStyle, otherStyle } = splitTextStyles(rawStyle)
  const cleanedTextStyle = stripDefaultTextStyles(textStyle)

  if (node.type === 'TEXT' && inheritedTextStyle?.color && cleanedTextStyle.color) {
    delete cleanedTextStyle.color
  }

  const textSegments =
    node.type === 'TEXT'
      ? await renderTextSegments(node, classProp, ctx, {
          inheritedTextStyle,
          computeSegmentStyle: true
        })
      : undefined

  const effectiveTextStyle =
    node.type === 'TEXT' && textSegments?.commonStyle ? textSegments.commonStyle : cleanedTextStyle

  const { appliedTextStyle, nextTextStyle } = diffTextStyles(inheritedTextStyle, effectiveTextStyle)

  const baseStyleForClass = Object.keys(otherStyle).length
    ? { ...otherStyle, ...appliedTextStyle }
    : appliedTextStyle

  const styleForClass = pluginComponent
    ? pickChildLayoutStyles(baseStyleForClass)
    : baseStyleForClass

  const { classNames, props } = buildClassProps(
    styleForClass,
    classProp,
    semantic.dataHint,
    node,
    ctx.options.attributeName
  )

  if (pluginComponent) {
    const hasDataHintProp = semantic.dataHint?.kind === 'attr' && semantic.dataHint.name in props
    const pluginProps = classNames.length || hasDataHintProp ? props : undefined

    if (pluginComponent.component) {
      return mergeDevComponentProps(pluginComponent.component, pluginProps)
    }

    if (pluginComponent.code && pluginProps) {
      return (
        injectAttributes(pluginComponent.code, pluginProps as Record<string, string>) ??
        pluginComponent.code
      )
    }
    return pluginComponent.code ?? null
  }

  if (node.type === 'TEXT') {
    const segments = textSegments?.segments ?? []
    const { classNames, props: textProps } = buildClassProps(
      baseStyleForClass,
      classProp,
      semantic.dataHint,
      node,
      ctx.options.attributeName
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

  const children: (DevComponent | string)[] = []
  for (const child of semantic.children) {
    const rendered = await renderSemanticNode(child, ctx, nextTextStyle)
    if (rendered) children.push(rendered)
  }

  return { name: semantic.tag || 'div', props, children }
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
  const detectedLang = detectLang(codeBlocks, ctx.options.preferredLang)
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
  defaultClassProp: 'class' | 'className',
  dataHint: DataHint | undefined,
  node: SceneNode,
  overrideAttributeName?: 'class' | 'className'
) {
  const classNames = styleToClassNames(style, node)
  const props: Record<string, string> = {}
  const propName = overrideAttributeName ?? defaultClassProp

  if (classNames.length) props[propName] = joinClassNames(classNames)

  if (dataHint?.kind === 'attr' && dataHint.name !== 'data-tp') {
    const val = dataHint.value
    if (val != null && String(val).trim()) props[dataHint.name] = String(val)
  } else if (dataHint?.kind === 'attr' && dataHint.name === 'data-tp' && node.type !== 'INSTANCE') {
    const val = dataHint.value
    if (val != null && String(val).trim()) props[dataHint.name] = String(val)
  }
  return { classNames, props }
}

function injectAttributes(markup: string, attrs: Record<string, string>): string | null {
  const entries = Object.entries(attrs).filter(([, v]) => v != null && String(v).trim())
  if (!entries.length) return markup
  const tagRegex = /^\s*<\s*([a-zA-Z0-9\-_]+)([^>]*?)(\/?>)/s
  const match = markup.match(tagRegex)
  if (!match) return null
  const [, tagName, rawAttrs, closer] = match
  let updatedAttrs = rawAttrs
  for (const [key, value] of entries) {
    const safeValue = String(value).trim().replace(/"/g, '&quot;')
    const attrRegex = new RegExp(`(\\s${key}\\s*=\\s*)(["'])(.*?)\\2`, 's')
    if ((key === 'class' || key === 'className') && attrRegex.test(updatedAttrs)) {
      updatedAttrs = updatedAttrs.replace(attrRegex, (_, prefix, quote, currentVal) => {
        return `${prefix}${quote}${mergeClasses(currentVal, safeValue)}${quote}`
      })
    } else if (!attrRegex.test(updatedAttrs)) {
      updatedAttrs += ` ${key}="${safeValue}"`
    }
  }
  return markup.replace(tagRegex, `<${tagName}${updatedAttrs}${closer}`)
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

function diffTextStyles(
  inherited: Record<string, string> | undefined,
  current: Record<string, string>
) {
  const appliedTextStyle: Record<string, string> = {}
  const nextTextStyle = { ...(inherited || {}) }
  for (const [k, v] of Object.entries(current)) {
    if (inherited?.[k] !== v) {
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
