import { raw } from '@tempad-dev/plugins'

import type { DevComponent } from '@/types/plugin'

import { stripDefaultTextStyles } from '@/utils/css'

import type { NodeSnapshot, VisibleTree } from '../model'
import type { RenderContext } from './types'

import { renderTextSegments } from '../text'
import { renderPluginComponent } from './plugin'
import { classProps, classProp, filterGridProps, mergeClass } from './props'

export type { RenderContext, CodeLanguage } from './types'

const DISPLAY_KIND = new Map<string, 'flex' | 'grid'>([
  ['flex', 'flex'],
  ['inline-flex', 'flex'],
  ['grid', 'grid'],
  ['inline-grid', 'grid']
])

export async function renderTree(
  rootId: string,
  tree: VisibleTree,
  ctx: RenderContext
): Promise<DevComponent | string | null> {
  return renderNode(rootId, tree, ctx)
}

async function renderNode(
  nodeId: string,
  tree: VisibleTree,
  ctx: RenderContext,
  inheritedTextStyle?: Record<string, string>,
  parentIsGrid = false
): Promise<DevComponent | string | null> {
  const snapshot = tree.nodes.get(nodeId)
  if (!snapshot) return null
  const node = snapshot.node

  if (ctx.svgs.has(snapshot.id)) {
    const svgEntry = ctx.svgs.get(snapshot.id)!
    const svgStyle = ctx.layout.get(snapshot.id) ?? {}
    const classAttr = classProp(ctx.preferredLang ?? ctx.detectedLang)
    const { classNames, props } = classProps(svgStyle, ctx.config, classAttr, undefined, {
      isFallback: true,
      includeDataHint: false
    })

    if (svgEntry.raw) {
      if (isEmptySvg(svgEntry.raw)) {
        const svgProps: Record<string, string> = { ...(svgEntry.props ?? {}) }
        if (classNames.length) svgProps[classAttr] = props[classAttr]
        Object.entries(props).forEach(([key, val]) => {
          if (key === classAttr) return
          svgProps[key] = val
        })
        ensureSvgSize(svgProps, snapshot)
        return { name: 'svg', props: svgProps, children: [] }
      }

      const mergedProps = Object.keys(props).length ? props : undefined
      return raw(svgEntry.raw, mergedProps as Record<string, string> | undefined)
    }

    const resourceUri = svgEntry.props?.['data-resource-uri']
    if (resourceUri) {
      const langHint = ctx.preferredLang ?? ctx.detectedLang
      const classAttr = classProp(langHint)
      const imgProps: Record<string, string> = { src: resourceUri }
      if (svgEntry.props?.width) imgProps.width = String(svgEntry.props.width)
      if (svgEntry.props?.height) imgProps.height = String(svgEntry.props.height)
      if (classNames.length) imgProps[classAttr] = props[classAttr]
      Object.entries(props).forEach(([key, val]) => {
        if (key === classAttr) return
        imgProps[key] = val
      })
      return { name: 'img', props: imgProps, children: [] }
    }

    return null
  }

  let rawStyle = ctx.styles.get(snapshot.id) ?? {}
  if (!parentIsGrid) {
    rawStyle = filterGridProps(rawStyle)
  }
  if (snapshot.tag === 'svg') {
    rawStyle = ctx.layout.get(snapshot.id) ?? rawStyle
  }

  const pluginComponent =
    node.type === 'INSTANCE'
      ? ctx.pluginComponents?.has(node.id)
        ? (ctx.pluginComponents.get(node.id) ?? null)
        : await renderPluginComponent(node, ctx)
      : null

  if (pluginComponent?.lang && !ctx.preferredLang && ctx.detectedLang !== 'vue') {
    ctx.detectedLang = pluginComponent.lang
  }

  const langHint = pluginComponent?.lang ?? ctx.preferredLang ?? ctx.detectedLang
  const classAttr = classProp(langHint)

  const preSegments = ctx.textSegments.has(snapshot.id)
    ? (ctx.textSegments.get(snapshot.id) ?? null)
    : undefined

  if (node.type === 'TEXT' && !rawStyle.color) {
    const hasVisibleFill = hasVisibleTextFill(node, preSegments)
    if (!hasVisibleFill) {
      rawStyle = { ...rawStyle, color: 'transparent' }
    }
  }

  const { textStyle, otherStyle } = splitTextStyles(rawStyle)
  let cleanedTextStyle = stripDefaultTextStyles(textStyle)

  const textSegments =
    node.type === 'TEXT'
      ? await renderTextSegments(node, classAttr, ctx, {
          inheritedTextStyle,
          segments: preSegments
        })
      : undefined

  const renderBounds = snapshot.renderBounds
  const hasClipAncestor = hasClippingAncestor(snapshot, tree, ctx.styles)
  const invisibleText =
    node.type === 'TEXT' &&
    textSegments?.segmentCount === 1 &&
    renderBounds == null &&
    !hasClipAncestor

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

  const baseStyleForClass = Object.keys(otherStyle).length
    ? { ...otherStyle, ...appliedTextStyle }
    : appliedTextStyle

  const isFallback = !pluginComponent

  const dataHint =
    pluginComponent || snapshot.tag === 'svg' || !snapshot.dataHint
      ? undefined
      : { ...snapshot.dataHint, 'data-hint-id': snapshot.id }

  const styleForClass = pluginComponent ? (ctx.layout.get(snapshot.id) ?? {}) : baseStyleForClass

  const { props } = classProps(styleForClass, ctx.config, classAttr, dataHint, { isFallback })

  if (pluginComponent) {
    const pluginProps = Object.keys(props).length ? props : undefined

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
    const { props: textProps } = classProps(baseStyleForClass, ctx.config, classAttr, dataHint, {
      isFallback
    })
    if (segments.length === 1) {
      const single = segments[0]
      if (single && typeof single !== 'string') return mergeDevComponentProps(single, textProps)
    }
    return {
      name: snapshot.tag || 'span',
      props: textProps,
      children: segments.filter(Boolean)
    }
  }

  const children: Array<DevComponent | string> = []
  const display = rawStyle.display || ''
  const isCurrentGrid = display === 'grid' || display === 'inline-grid'

  const childIds = getOrderedChildren(snapshot, rawStyle, tree)
  for (const childId of childIds) {
    const rendered = await renderNode(childId, tree, ctx, nextTextStyle, isCurrentGrid)
    if (rendered) children.push(rendered)
  }

  return { name: snapshot.tag || 'div', props, children }
}

function getOrderedChildren(
  snapshot: NodeSnapshot,
  style: Record<string, string>,
  tree: VisibleTree
): string[] {
  const display = style.display ?? ''
  const kind = DISPLAY_KIND.get(display)
  if (!kind) return snapshot.children

  const axis = kind === 'grid' ? 'grid' : resolveFlexAxis(snapshot.node, style)
  if (!axis) return snapshot.children

  const entries = snapshot.children.map((id, index) => {
    const node = tree.nodes.get(id)?.node
    const box =
      node && 'absoluteBoundingBox' in node
        ? (node.absoluteBoundingBox as { x: number; y: number } | null)
        : null
    return { id, index, box }
  })

  if (entries.some((entry) => !entry.box)) return snapshot.children

  const EPS = 0.5
  const sorted = [...entries].sort((a, b) => {
    if (axis === 'grid') {
      const deltaY = a.box!.y - b.box!.y
      if (Math.abs(deltaY) > EPS) return deltaY
      const deltaX = a.box!.x - b.box!.x
      if (Math.abs(deltaX) > EPS) return deltaX
      return a.index - b.index
    }
    const delta = a.box![axis] - b.box![axis]
    if (Math.abs(delta) > EPS) return delta
    return a.index - b.index
  })

  return sorted.map((entry) => entry.id)
}

function resolveFlexAxis(node: SceneNode, style: Record<string, string>): 'x' | 'y' | null {
  const direction = style['flex-direction']
  if (direction === 'row' || direction === 'row-reverse') return 'x'
  if (direction === 'column' || direction === 'column-reverse') return 'y'

  if ('layoutMode' in node) {
    const layoutMode = (node as { layoutMode?: string }).layoutMode
    if (layoutMode === 'HORIZONTAL') return 'x'
    if (layoutMode === 'VERTICAL') return 'y'
  }

  if ('inferredAutoLayout' in node) {
    const inferred = (node as { inferredAutoLayout?: { layoutMode?: string } }).inferredAutoLayout
    if (inferred?.layoutMode === 'HORIZONTAL') return 'x'
    if (inferred?.layoutMode === 'VERTICAL') return 'y'
  }

  return null
}

const HOISTABLE_TEXT_STYLE_KEYS = new Set([
  'color',
  'font-family',
  'font-size',
  'line-height',
  'font-weight',
  'letter-spacing',
  'text-transform',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-decoration-thickness',
  'text-decoration-skip-ink',
  'text-underline-offset',
  'text-underline-position'
])

function splitTextStyles(styles: Record<string, string>): {
  textStyle: Record<string, string>
  otherStyle: Record<string, string>
} {
  const textStyle: Record<string, string> = {}
  const otherStyle: Record<string, string> = {}
  for (const [key, value] of Object.entries(styles)) {
    if (HOISTABLE_TEXT_STYLE_KEYS.has(key)) {
      textStyle[key] = value
    } else {
      otherStyle[key] = value
    }
  }
  return { textStyle, otherStyle }
}

function filterHoistableTextStyle(styles: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  Object.entries(styles).forEach(([key, value]) => {
    if (HOISTABLE_TEXT_STYLE_KEYS.has(key)) {
      out[key] = value
    }
  })
  return out
}

function diffTextStyles(
  inherited: Record<string, string> | undefined,
  current: Record<string, string>
): { appliedTextStyle: Record<string, string>; nextTextStyle: Record<string, string> } {
  const appliedTextStyle: Record<string, string> = {}
  const nextTextStyle: Record<string, string> = { ...(inherited ?? {}) }

  for (const [key, value] of Object.entries(current)) {
    if (inherited?.[key] === value) continue
    appliedTextStyle[key] = value
    nextTextStyle[key] = value
  }

  return { appliedTextStyle, nextTextStyle }
}

function mergeDevComponentProps(
  component: DevComponent,
  props?: Record<string, string>
): DevComponent {
  if (!props || !Object.keys(props).length) return component
  const next = { ...component }
  const existing = (next.props ?? {}) as Record<string, string>
  const merged: Record<string, string> = { ...existing }

  Object.entries(props).forEach(([key, value]) => {
    if (!value) return
    if (key === 'class' || key === 'className') {
      if (existing[key]) {
        merged[key] = mergeClass(existing[key], value)
      } else {
        merged[key] = value
      }
      return
    }
    merged[key] = value
  })

  next.props = merged
  return next
}

function hasClippingAncestor(
  snapshot: NodeSnapshot,
  tree: VisibleTree,
  styles: Map<string, Record<string, string>>
): boolean {
  let currentId = snapshot.parentId
  while (currentId) {
    const parent = tree.nodes.get(currentId)
    if (!parent) break
    const node = parent.node

    const clipsContent = 'clipsContent' in node && (node as { clipsContent?: boolean }).clipsContent
    const overflowDirection =
      'overflowDirection' in node
        ? (node as { overflowDirection?: string }).overflowDirection
        : undefined
    if (clipsContent || (overflowDirection && overflowDirection !== 'NONE')) return true

    const style = styles.get(parent.id)
    if (style) {
      const overflow = style.overflow?.toLowerCase()
      const overflowX = style['overflow-x']?.toLowerCase()
      const overflowY = style['overflow-y']?.toLowerCase()
      if ((overflow && overflow !== 'visible') || (overflowX && overflowX !== 'visible')) {
        return true
      }
      if (overflowY && overflowY !== 'visible') return true
    }

    currentId = parent.parentId
  }
  return false
}

function hasVisibleTextFill(
  node: TextNode,
  segments: StyledTextSegment[] | null | undefined
): boolean {
  const nodeFills = Array.isArray(node.fills) ? (node.fills as Paint[]) : null
  if (nodeFills) {
    return nodeFills.some((fill) => isVisiblePaint(fill))
  }

  if (Array.isArray(segments)) {
    for (const seg of segments) {
      const fills = Array.isArray(seg.fills) ? (seg.fills as Paint[]) : null
      if (fills && fills.some((fill) => isVisiblePaint(fill))) return true
    }
    return false
  }

  return true
}

function isVisiblePaint(paint?: Paint): boolean {
  if (!paint || paint.visible === false) return false
  if (typeof paint.opacity === 'number' && paint.opacity <= 0) return false
  if ('gradientStops' in paint && Array.isArray(paint.gradientStops)) {
    return paint.gradientStops.some((stop) => (stop.color?.a ?? 1) > 0)
  }
  return true
}

function isEmptySvg(raw: string): boolean {
  const content = raw.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '')
  if (!content.trim()) return true
  const hasShape = /<(path|rect|circle|ellipse|line|polyline|polygon|image|text|use)\b/i.test(
    content
  )
  return !hasShape
}

function ensureSvgSize(svgProps: Record<string, string>, snapshot: NodeSnapshot): void {
  const hasWidth = typeof svgProps.width === 'string' && svgProps.width.trim().length > 0
  const hasHeight = typeof svgProps.height === 'string' && svgProps.height.trim().length > 0
  if (hasWidth && hasHeight) return

  const width = snapshot.bounds?.width
  const height = snapshot.bounds?.height
  if (!hasWidth && typeof width === 'number' && width > 0) svgProps.width = `${width}px`
  if (!hasHeight && typeof height === 'number' && height > 0) svgProps.height = `${height}px`
}
