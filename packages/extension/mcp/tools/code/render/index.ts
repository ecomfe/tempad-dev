import { raw } from '@tempad-dev/plugins'

import type { SemanticNode } from '@/mcp/semantic-tree'
import type { DevComponent } from '@/types/plugin'

import { TEXT_STYLE_PROPS, canonicalizeValue, stripDefaultTextStyles } from '@/utils/css'

import type { RenderContext } from './types'

import { renderTextSegments } from '../text'
import { renderPluginComponent } from './plugin'
import {
  buildClassProps,
  filterGridProps,
  getClassPropName,
  mergeClasses,
  pickChildLayoutStyles
} from './props'

export type { RenderContext, CodeLanguage } from './types'

export async function renderSemanticNode(
  semantic: SemanticNode,
  ctx: RenderContext,
  inheritedTextStyle?: Record<string, string>,
  parentIsGrid = false
): Promise<DevComponent | string | null> {
  const node = ctx.nodes.get(semantic.id)
  if (!node) return null

  if (ctx.svgs.has(semantic.id)) {
    const svgEntry = ctx.svgs.get(semantic.id)!
    const svgStyle = ctx.styles.get(semantic.id) ?? {}
    const { classNames, props: classProps } = buildClassProps(
      svgStyle,
      ctx.config,
      getClassPropName(ctx.preferredLang ?? ctx.detectedLang),
      semantic.dataHint,
      node,
      { isFallback: true }
    )

    if (svgEntry.raw) {
      const mergedProps = classNames.length ? classProps : undefined
      return raw(svgEntry.raw, mergedProps as Record<string, string> | undefined)
    }

    const props = { ...svgEntry.props }
    if (classNames.length) {
      props[getClassPropName(ctx.preferredLang ?? ctx.detectedLang)] =
        classProps[getClassPropName(ctx.preferredLang ?? ctx.detectedLang)]
    }

    return {
      name: 'svg',
      props,
      children: []
    }
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
  let cleanedTextStyle = stripDefaultTextStyles(textStyle)

  const textSegments =
    node.type === 'TEXT'
      ? await renderTextSegments(node, classProp, ctx, {
          inheritedTextStyle
        })
      : undefined

  const renderBounds = (node as { absoluteRenderBounds?: Rect | null }).absoluteRenderBounds
  const invisibleText =
    node.type === 'TEXT' && textSegments?.segmentCount === 1 && renderBounds == null

  if (invisibleText) {
    cleanedTextStyle = { ...cleanedTextStyle, color: 'transparent' }
  }

  const hoistedTextStyle =
    node.type === 'TEXT' ? filterHoistableTextStyle(cleanedTextStyle) : cleanedTextStyle

  if (
    node.type === 'TEXT' &&
    !invisibleText &&
    inheritedTextStyle?.color &&
    cleanedTextStyle.color
  ) {
    delete hoistedTextStyle.color
  }

  const mergedCommonStyle =
    node.type === 'TEXT' && textSegments?.commonStyle ? { ...textSegments.commonStyle } : undefined

  if (invisibleText && mergedCommonStyle && 'color' in mergedCommonStyle) {
    delete mergedCommonStyle.color
  }

  const effectiveTextStyle =
    node.type === 'TEXT'
      ? {
          ...hoistedTextStyle,
          ...(mergedCommonStyle ?? {}),
          ...(invisibleText ? { color: 'transparent' } : {})
        }
      : hoistedTextStyle

  const { appliedTextStyle, nextTextStyle } = diffTextStyles(inheritedTextStyle, effectiveTextStyle)

  let baseStyleForClass = Object.keys(otherStyle).length
    ? { ...otherStyle, ...appliedTextStyle }
    : appliedTextStyle

  // If any immediate child is absolutely positioned and parent has no positioning set, make parent relative.
  if (!baseStyleForClass.position) {
    const hasAbsoluteChild = semantic.children.some((child) => {
      const childStyle = ctx.styles.get(child.id)
      return childStyle?.position?.toLowerCase() === 'absolute'
    })
    if (hasAbsoluteChild) {
      baseStyleForClass = { position: 'relative', ...baseStyleForClass }
    }
  }

  const styleForClass = pluginComponent
    ? pickChildLayoutStyles(baseStyleForClass)
    : baseStyleForClass

  const isFallback = !pluginComponent

  const { classNames, props } = buildClassProps(
    styleForClass,
    ctx.config,
    classProp,
    semantic.dataHint,
    node,
    { isFallback }
  )

  if (pluginComponent) {
    const hasDataHintProp = semantic.dataHint
      ? Object.keys(semantic.dataHint).some((key) => key in props)
      : false
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

const HOISTABLE_TEXT_STYLE_KEYS = new Set([
  'color',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform'
])

function splitTextStyles(style: Record<string, string>) {
  const textStyle: Record<string, string> = {}
  const otherStyle: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (TEXT_STYLE_PROPS.has(k)) textStyle[k] = v
    else otherStyle[k] = v
  }
  return { textStyle, otherStyle }
}

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
