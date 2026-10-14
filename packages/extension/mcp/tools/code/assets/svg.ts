import { parseSync, stringify, type INode } from 'svgson'

import type { CodegenConfig } from '@/utils/codegen'

import { normalizeCssValue } from '@/utils/css'
import { toDecimalPlace } from '@/utils/number'

type PaintSource = 'default' | 'explicit'

type PaintContext = {
  fill: string
  fillSource: PaintSource
  stroke: string
  strokeSource: PaintSource
}

const DEFAULT_CONTEXT: PaintContext = {
  fill: 'black',
  fillSource: 'default',
  stroke: 'none',
  strokeSource: 'default'
}

const PRESENTATION_KEYS = new Set([
  'clip-path',
  'fill',
  'fill-opacity',
  'filter',
  'mask',
  'opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width'
])

export function normalizeThemeableSvg(
  svg: string,
  config: CodegenConfig,
  options: { width: number; height: number; idPrefix: string }
): { content: string; props: Record<string, string> } | null {
  const root = prepareSvg(svg)
  if (!root) return null

  stabilizeIds(root, options.idPrefix)
  applyThemeableColors(root)
  applyRootSizing(root, config, options.width, options.height)
  return serializeSvg(root)
}

export function ensureSvgRootSize(
  svg: string,
  config: CodegenConfig,
  width: number,
  height: number
): { content: string; props: Record<string, string> } | null {
  const root = prepareSvg(svg)
  if (!root) return null

  applyRootSizing(root, config, width, height)
  return serializeSvg(root)
}

export function normalizeSvgExport(
  svg: string,
  node: Pick<SceneNode, 'width' | 'height' | 'absoluteTransform'> & {
    absoluteRenderBounds?: Rect | null
  },
  flowTransform?: Transform
): { content: string; x: number; y: number; width: number; height: number } | null {
  const root = parseSvg(svg)
  if (!root || node.width < 0 || node.height < 0) return null
  const [[a, c, tx], [b, d, ty]] = node.absoluteTransform ?? [
    [1, 0, 0],
    [0, 1, 0]
  ]
  const determinant = a * d - b * c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return null
  const [originX = 0, originY = 0] =
    root.attributes.viewBox
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? []
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) return null

  const geometryX = Math.min(0, a * node.width, c * node.height, a * node.width + c * node.height)
  const geometryY = Math.min(0, b * node.width, d * node.height, b * node.width + d * node.height)
  const geometryWidth = Math.abs(a * node.width) + Math.abs(c * node.height)
  const geometryHeight = Math.abs(b * node.width) + Math.abs(d * node.height)
  const bounds = node.absoluteRenderBounds
  const render =
    bounds && Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0
      ? { x: bounds.x - tx, y: bounds.y - ty, width: bounds.width, height: bounds.height }
      : null
  const renderBoundsExport = node.width === 0 || node.height === 0
  if (renderBoundsExport && !render) return null

  // Full-node exports retain unclipped path/filter geometry. Expand their
  // viewport for visible effects, never shrink it to ancestor-clipped bounds.
  // Degenerate lines require native render-bounds export instead.
  const x = (renderBoundsExport ? render!.x : geometryX) - originX
  const y = (renderBoundsExport ? render!.y : geometryY) - originY
  let matrix: [number, number, number, number, number, number] = [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (d * x - c * y) / determinant,
    (a * y - b * x) / determinant
  ]
  const minX = Math.min(geometryX, render?.x ?? geometryX)
  const minY = Math.min(geometryY, render?.y ?? geometryY)
  const maxX = Math.max(
    geometryX + geometryWidth,
    render ? render.x + render.width : geometryX + geometryWidth
  )
  const maxY = Math.max(
    geometryY + geometryHeight,
    render ? render.y + render.height : geometryY + geometryHeight
  )
  let corners = (
    [
      [minX, minY],
      [maxX, minY],
      [minX, maxY],
      [maxX, maxY]
    ] as const
  ).map(([u, v]): [number, number] => [
    (d * u - c * v) / determinant,
    (a * v - b * u) / determinant
  ])
  if (flowTransform) {
    const [[fa, fc], [fb, fd]] = flowTransform
    const offsetX = Math.min(
      0,
      fa * node.width,
      fc * node.height,
      fa * node.width + fc * node.height
    )
    const offsetY = Math.min(
      0,
      fb * node.width,
      fd * node.height,
      fb * node.width + fd * node.height
    )
    const [ma, mb, mc, md, mx, my] = matrix
    matrix = [
      fa * ma + fc * mb,
      fb * ma + fd * mb,
      fa * mc + fc * md,
      fb * mc + fd * md,
      fa * mx + fc * my - offsetX,
      fb * mx + fd * my - offsetY
    ]
    corners = corners.map(([u, v]) => [fa * u + fc * v - offsetX, fb * u + fd * v - offsetY])
  }
  const left = toDecimalPlace(Math.min(...corners.map(([u]) => u)))
  const top = toDecimalPlace(Math.min(...corners.map(([, v]) => v)))
  const width = roundedSize(Math.max(...corners.map(([u]) => u)) - left)
  const height = roundedSize(Math.max(...corners.map(([, v]) => v)) - top)
  if (matrix.some((value, index) => Math.abs(value - [1, 0, 0, 1, 0, 0][index]!) > 1e-10)) {
    root.children = [
      {
        name: 'g',
        type: 'element',
        value: '',
        attributes: { transform: `matrix(${matrix.join(' ')})` },
        children: root.children
      }
    ]
  }
  // Native exports round the viewport up to whole pixels. The node's exact
  // dimensions prevent that padding from scaling or shifting the artwork.
  // Keep the whole inverse-mapped export rectangle. Cropping it to local node
  // bounds would cut off strokes on rotated edges when used as an <img>.
  root.attributes.viewBox = `${left} ${top} ${width} ${height}`
  root.attributes.width = `${width}px`
  root.attributes.height = `${height}px`
  return { content: stringify(root), x: left, y: top, width, height }
}

export function extractSvgAttributes(svg: string): Record<string, string> {
  const root = parseSvg(svg)
  return root ? { ...root.attributes } : {}
}

function parseSvg(svg: string): INode | null {
  try {
    const root = parseSync(svg)
    if (root.type !== 'element' || root.name.toLowerCase() !== 'svg') return null
    return root
  } catch {
    return null
  }
}

function prepareSvg(svg: string): INode | null {
  const root = parseSvg(svg)
  if (!root) return null
  visitElements(root, liftPresentationStyles)
  return root
}

function serializeSvg(root: INode): { content: string; props: Record<string, string> } {
  sortAttributesDeep(root)
  return {
    content: stringify(root),
    props: { ...root.attributes }
  }
}

function visitElements(node: INode, visit: (node: INode) => void): void {
  if (node.type !== 'element') return
  visit(node)
  node.children.forEach((child) => visitElements(child, visit))
}

function applyThemeableColors(root: INode): void {
  const walk = (node: INode, parent: PaintContext) => {
    if (node.type !== 'element') return

    const next = resolveContext(node, parent)
    const explicitFill = node.attributes.fill
    const explicitStroke = node.attributes.stroke

    if (explicitFill) {
      const normalizedFill = normalizePaintToken(explicitFill) ?? explicitFill.toLowerCase()
      if (normalizedFill === 'none') {
        if (parent.fill === 'none' && parent.fillSource === 'default') delete node.attributes.fill
      } else if (normalizedFill === parent.fill && parent.fillSource === 'explicit') {
        delete node.attributes.fill
      } else {
        node.attributes.fill = 'currentColor'
      }
    }

    if (explicitStroke) {
      const normalizedStroke = normalizePaintToken(explicitStroke) ?? explicitStroke.toLowerCase()
      if (normalizedStroke === 'none') {
        if (parent.stroke === 'none' && parent.strokeSource === 'default') {
          delete node.attributes.stroke
        }
      } else if (normalizedStroke === parent.stroke && parent.strokeSource === 'explicit') {
        delete node.attributes.stroke
      } else {
        node.attributes.stroke = 'currentColor'
      }
    }

    node.children.forEach((child) => {
      if (child.type === 'element') walk(child, next)
    })
  }

  walk(root, DEFAULT_CONTEXT)
}

function applyRootSizing(root: INode, config: CodegenConfig, width: number, height: number): void {
  const viewBox = root.attributes.viewBox?.trim()
  const viewBoxSize = viewBox ? parseViewBoxSize(viewBox) : null
  const widthBox = viewBoxSize?.width ?? parseLength(root.attributes.width) ?? roundedSize(width)
  const heightBox =
    viewBoxSize?.height ?? parseLength(root.attributes.height) ?? roundedSize(height)

  if (!viewBox && widthBox > 0 && heightBox > 0) {
    root.attributes.viewBox = `0 0 ${String(roundedSize(widthBox))} ${String(roundedSize(heightBox))}`
  }

  root.attributes.width = normalizeSize(width, config)
  root.attributes.height = normalizeSize(height, config)
}

function stabilizeIds(root: INode, seed: string): void {
  const prefix = `tp-${sanitizeId(seed)}-`
  const idMap = new Map<string, string>()
  let count = 0

  visitElements(root, (node) => {
    const id = node.attributes.id
    if (!id) return
    const nextId = `${prefix}${count++}`
    idMap.set(id, nextId)
    node.attributes.id = nextId
  })

  if (!idMap.size) return

  visitElements(root, (node) => {
    Object.entries(node.attributes).forEach(([key, value]) => {
      node.attributes[key] = replaceIdRefs(value, idMap)
    })
  })
}

function replaceIdRefs(value: string, idMap: Map<string, string>): string {
  let next = value
  idMap.forEach((mapped, original) => {
    const hashPattern = new RegExp(`url\\(#${escapeRegExp(original)}\\)`, 'g')
    const hrefPattern = new RegExp(`^#${escapeRegExp(original)}$`)
    next = next.replace(hashPattern, `url(#${mapped})`)
    if (hrefPattern.test(next)) {
      next = `#${mapped}`
    }
  })
  return next
}

function resolveContext(node: INode, parent: PaintContext): PaintContext {
  const fill = normalizePaintToken(node.attributes.fill) ?? parent.fill
  const fillSource = node.attributes.fill ? 'explicit' : parent.fillSource
  const stroke = normalizePaintToken(node.attributes.stroke) ?? parent.stroke
  const strokeSource = node.attributes.stroke ? 'explicit' : parent.strokeSource

  return {
    fill,
    fillSource,
    stroke,
    strokeSource
  }
}

function liftPresentationStyles(node: INode): void {
  if (!node.attributes.style) return

  const style = parseStyleAttribute(node.attributes.style)
  let changed = false

  PRESENTATION_KEYS.forEach((key) => {
    const value = style[key]
    if (!value || node.attributes[key]) return
    node.attributes[key] = value
    delete style[key]
    changed = true
  })

  if (!Object.keys(style).length) {
    delete node.attributes.style
    return
  }
  if (changed) {
    node.attributes.style = stringifyStyleAttribute(style)
  }
}

function parseStyleAttribute(value?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value) return out

  value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const index = entry.indexOf(':')
      if (index === -1) return
      const key = entry.slice(0, index).trim()
      const styleValue = entry.slice(index + 1).trim()
      if (!key || !styleValue) return
      out[key] = styleValue
    })

  return out
}

function stringifyStyleAttribute(style: Record<string, string>): string {
  return Object.entries(style)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join(';')
}

function sortAttributesDeep(node: INode): void {
  if (node.type !== 'element') return
  node.attributes = Object.fromEntries(
    Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b))
  )
  node.children.forEach(sortAttributesDeep)
}

function normalizePaintToken(value?: string): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  return normalized.replace(/\s+/g, ' ')
}

function normalizeSize(value: number, config: CodegenConfig): string {
  return normalizeCssValue(`${roundedSize(value)}px`, config)
}

function roundedSize(value: number): number {
  return Math.max(0, toDecimalPlace(value))
}

function parseViewBoxSize(value: string): { width: number; height: number } | null {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map((item) => Number.parseFloat(item))
  const width = parts[2]
  const height = parts[3]
  if (
    parts.length !== 4 ||
    width === undefined ||
    height === undefined ||
    parts.some((item) => !Number.isFinite(item))
  ) {
    return null
  }
  return {
    width,
    height
  }
}

function parseLength(value?: string): number | null {
  if (!value) return null
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))/)
  const rawLength = match?.[1]
  if (!rawLength) return null
  const parsed = Number.parseFloat(rawLength)
  return Number.isFinite(parsed) ? parsed : null
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
