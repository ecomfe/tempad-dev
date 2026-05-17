/**
 * Figma style resolver utilities
 * Reconciles getCSSAsync output with node/style paint data.
 */

import type {
  FigmaLookupReaders,
  NodePaintStyleInput,
  PaintList,
  PaintResolutionSize,
  PaintVariableBindings
} from './types'

import { formatHexAlpha, normalizeFigmaVarName, replaceVarFunctions } from '../css'
import { getVariableCssName, resolveVariableAlias } from '../figma-variables'
import {
  resolveBackgroundFillFromPaints,
  resolveGradientFromPaints,
  resolveSolidFromPaints
} from './gradient'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray\b/i
const BG_URL_RE = /url\(/i

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id) => figma.getStyleById(id),
  getVariableById: (id) => figma.variables.getVariableById(id)
}

type ResolvedBackgroundFill = ReturnType<typeof resolveBackgroundFillFromPaints>
type ResolvedPaintValue = {
  solidColor?: string
  gradient?: string
}
type PaintSource = {
  paints: PaintList
  bindings?: PaintVariableBindings
  name?: string
}
export type ResolveStyleOptions = {
  emitSafeStyleNameVars?: boolean
}

function hasStyleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPaintStyle(style: BaseStyle | null): style is PaintStyle {
  return !!style && 'paints' in style && Array.isArray(style.paints)
}

function isVisibleSolidPaint(paint: Paint | null | undefined): paint is SolidPaint {
  return !!paint && paint.visible !== false && paint.type === 'SOLID' && !!paint.color
}

function getSingleVisibleSolidPaint(paints: PaintList): SolidPaint | null {
  if (!Array.isArray(paints)) return null

  let visibleSolid: SolidPaint | null = null
  for (const paint of paints) {
    if (!paint || paint.visible === false) continue
    if (!isVisibleSolidPaint(paint)) return null
    if (visibleSolid) return null
    visibleSolid = paint
  }

  return visibleSolid
}

function getIndexedVariableBinding(bindings: PaintVariableBindings, index: number): unknown {
  if (!Array.isArray(bindings)) return null
  const binding = bindings[index]
  if (Array.isArray(binding)) return binding[0] ?? null
  return binding ?? null
}

function resolveBoundSolidPaint(
  paint: SolidPaint,
  index: number,
  bindings: PaintVariableBindings,
  readers: FigmaLookupReaders
): string | null {
  const binding = getIndexedVariableBinding(bindings, index)
  const variable =
    binding && typeof binding === 'object'
      ? resolveVariableAlias(binding as { id?: unknown }, readers)
      : null
  if (!variable) return null

  return `var(${getVariableCssName(variable)}, ${formatHexAlpha(paint.color, paint.opacity)})`
}

function resolveSolidPaintWithBindings(
  paint: SolidPaint,
  index: number,
  bindings: PaintVariableBindings,
  readers: FigmaLookupReaders
): string | null {
  return (
    resolveBoundSolidPaint(paint, index, bindings, readers) ??
    resolveSolidFromPaints([paint], readers)
  )
}

function resolvePaintValueFromPaints(
  paints: PaintList,
  size?: PaintResolutionSize,
  readers: FigmaLookupReaders = DEFAULT_READERS,
  bindings?: PaintVariableBindings
): ResolvedPaintValue | null {
  if (!paints) return null
  const gradient = resolveGradientFromPaints(paints, size, readers)
  if (gradient) return { gradient }

  let solidEntry: { paint: SolidPaint; index: number } | null = null
  for (let index = 0; index < paints.length; index += 1) {
    const paint = paints[index]
    if (isVisibleSolidPaint(paint)) {
      solidEntry = { paint, index }
      break
    }
  }
  const solidColor = solidEntry
    ? resolveSolidPaintWithBindings(solidEntry.paint, solidEntry.index, bindings, readers)
    : null

  return solidColor ? { solidColor } : null
}

// A style-name var is safe only when one CSS value fully represents the style.
function getSafePaintStyleNameVarExpr(
  source: PaintSource,
  fallback: string | undefined,
  options: ResolveStyleOptions
): string | null {
  if (
    !options.emitSafeStyleNameVars ||
    !source.name ||
    !fallback ||
    containsCssVarFunction(fallback)
  ) {
    return null
  }
  if (!getSingleVisibleSolidPaint(source.paints)) return null

  const name = normalizeFigmaVarName(source.name)
  if (name === '--unnamed') return null
  return `var(${name}, ${fallback})`
}

function getPaintStyleSource(
  styleId: unknown,
  kind: 'fill' | 'stroke',
  readers: FigmaLookupReaders = DEFAULT_READERS
): PaintSource | null {
  if (!hasStyleId(styleId)) return null

  try {
    const style = readers.getStyleById(styleId)
    if (!isPaintStyle(style)) return null
    return {
      paints: style.paints,
      name: typeof style.name === 'string' ? style.name : undefined,
      bindings: (style as { boundVariables?: { paints?: PaintVariableBindings } }).boundVariables
        ?.paints
    }
  } catch (error) {
    console.warn(`Failed to resolve ${kind} style:`, error)
    return null
  }
}

function getEffectivePaintSource(
  styleId: unknown,
  paints: PaintList,
  bindings: PaintVariableBindings,
  kind: 'fill' | 'stroke',
  readers: FigmaLookupReaders = DEFAULT_READERS
): PaintSource {
  return getPaintStyleSource(styleId, kind, readers) ?? { paints, bindings }
}

function getNodeDimensions(node: SceneNode): PaintResolutionSize | undefined {
  if (!('width' in node) || !('height' in node)) return undefined

  const width = node.width
  const height = node.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  return { width, height }
}

function createNodePaintStyleInput(node: SceneNode): NodePaintStyleInput {
  const boundVariables = (node as { boundVariables?: Record<string, unknown> }).boundVariables

  return {
    fillStyleId: 'fillStyleId' in node ? node.fillStyleId : null,
    strokeStyleId: 'strokeStyleId' in node ? node.strokeStyleId : null,
    fills: 'fills' in node && Array.isArray(node.fills) ? node.fills : null,
    strokes: 'strokes' in node && Array.isArray(node.strokes) ? node.strokes : null,
    fillVariableBindings: boundVariables?.fills as PaintVariableBindings | undefined,
    strokeVariableBindings: boundVariables?.strokes as PaintVariableBindings | undefined,
    dimensions: getNodeDimensions(node)
  }
}

function splitByTopLevelWhitespace(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: '"' | "'" | null = null
  let buffer = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (quote) {
      if (ch === '\\') {
        buffer += ch
        i++
        if (i < input.length) buffer += input[i]
        continue
      }
      if (ch === quote) quote = null
      buffer += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      buffer += ch
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)

    if (/\s/.test(ch) && depth === 0) {
      if (buffer) {
        out.push(buffer)
        buffer = ''
      }
      continue
    }

    buffer += ch
  }

  if (buffer) out.push(buffer)
  return out
}

function isVarFunctionToken(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('var(') && trimmed.endsWith(')')
}

function isCssColorValue(value: string): boolean {
  const trimmed = value.trim()
  if (/^#[\da-f]{3,8}$/i.test(trimmed)) return true
  if (/^(?:rgb|rgba|hsl|hsla|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(trimmed)) {
    return true
  }
  return /^(?:currentColor|transparent)$/i.test(trimmed)
}

function containsCssVarFunction(value: string | null | undefined): boolean {
  if (!value) return false

  let found = false
  replaceVarFunctions(value, ({ full }) => {
    found = true
    return full
  })

  return found
}

function replaceBorderShorthandColor(borderValue: string, color: string): string | null {
  const borderParts = splitByTopLevelWhitespace(borderValue)
  if (!borderParts.length) return null

  const lastIndex = borderParts.length - 1
  const current = borderParts[lastIndex]
  if (!isVarFunctionToken(current) && !(color.startsWith('var(') && isCssColorValue(current))) {
    return null
  }

  borderParts[lastIndex] = color
  return borderParts.join(' ')
}

function hasBorderChannels(style: Record<string, string>): boolean {
  return Object.entries(style).some(([key, value]) => {
    if (!value?.trim()) return false
    if (!/^border(?:$|-)/.test(key)) return false
    if (key.includes('radius') || key === 'border-image' || key === 'border-image-slice') {
      return false
    }
    return true
  })
}

function applyResolvedBackgroundFill(
  style: Record<string, string>,
  resolved: ResolvedBackgroundFill | null
): boolean {
  if (!resolved) return false

  if (!style.background && !style['background-color']) {
    return false
  }

  if (resolved.kind === 'layers') {
    style.background = resolved.value.join(', ')
    delete style['background-color']
    return true
  }

  if (style.background) {
    style['background-color'] = resolved.value
    delete style.background
    return true
  }

  if (style['background-color']) {
    style['background-color'] = resolved.value
    return true
  }

  return false
}

/**
 * Main function to resolve all styles from a node
 * Replaces CSS variable references with actual values
 */
export async function resolveStylesFromNodeData(
  cssStyles: Record<string, string>,
  input: NodePaintStyleInput,
  readers: FigmaLookupReaders = DEFAULT_READERS,
  options: ResolveStyleOptions = {}
): Promise<Record<string, string>> {
  const processed = { ...cssStyles }
  const effectiveFillSource = getEffectivePaintSource(
    input.fillStyleId,
    input.fills,
    input.fillVariableBindings,
    'fill',
    readers
  )
  const effectiveFillPaints = effectiveFillSource.paints
  const resolvedFillBase = resolvePaintValueFromPaints(
    effectiveFillPaints,
    input.dimensions,
    readers,
    effectiveFillSource.bindings
  )
  const safeFillStyleNameVarExpr = getSafePaintStyleNameVarExpr(
    effectiveFillSource,
    resolvedFillBase?.solidColor,
    options
  )
  const resolvedFill =
    resolvedFillBase && safeFillStyleNameVarExpr
      ? { ...resolvedFillBase, solidColor: safeFillStyleNameVarExpr }
      : resolvedFillBase

  // Remove Figma's default lightgray fallback for image fills.
  if (
    processed.background &&
    BG_URL_LIGHTGRAY_RE.test(processed.background) &&
    effectiveFillPaints
  ) {
    if (resolvedFill?.solidColor) {
      processed['background-color'] = resolvedFill.solidColor
    }
    processed.background = processed.background.replace(/\s*,?\s*lightgray\b/i, '').trim()
  }

  const hasUrlBackground =
    typeof processed.background === 'string' && BG_URL_RE.test(processed.background)
  const resolvedBackgroundFill = hasUrlBackground
    ? null
    : resolveBackgroundFillFromPaints(effectiveFillPaints, input.dimensions, readers, {
        resolveSolidPaint: (paint, readers, index) =>
          safeFillStyleNameVarExpr ??
          resolveSolidPaintWithBindings(paint, index, effectiveFillSource.bindings, readers)
      })
  const appliedResolvedBackgroundFill = applyResolvedBackgroundFill(
    processed,
    resolvedBackgroundFill
  )

  // Process background/fill styles
  if (!appliedResolvedBackgroundFill) {
    if (resolvedFill?.gradient) {
      if (processed.background && !hasUrlBackground) {
        processed.background = resolvedFill.gradient
      } else if (processed['background-color']) {
        processed.background = resolvedFill.gradient
        delete processed['background-color']
      }
    } else if (resolvedFill?.solidColor) {
      if (processed.background && !hasUrlBackground) {
        // If it's a solid color, use background-color instead
        processed['background-color'] = resolvedFill.solidColor
        delete processed.background
      }
      if (processed['background-color']) {
        processed['background-color'] = resolvedFill.solidColor
      }
    }
  }

  if (resolvedFill?.solidColor) {
    if (processed.color) {
      processed.color = resolvedFill.solidColor
    }
    if (processed.fill) {
      processed.fill = resolvedFill.solidColor
    }
  }

  const effectiveStrokeSource = getEffectivePaintSource(
    input.strokeStyleId,
    input.strokes,
    input.strokeVariableBindings,
    'stroke',
    readers
  )
  const resolvedStrokeBase = resolvePaintValueFromPaints(
    effectiveStrokeSource.paints,
    input.dimensions,
    readers,
    effectiveStrokeSource.bindings
  )
  const safeStrokeStyleNameVarExpr = getSafePaintStyleNameVarExpr(
    effectiveStrokeSource,
    resolvedStrokeBase?.solidColor,
    options
  )
  const resolvedStroke =
    resolvedStrokeBase && safeStrokeStyleNameVarExpr
      ? { ...resolvedStrokeBase, solidColor: safeStrokeStyleNameVarExpr }
      : resolvedStrokeBase

  // Process stroke styles (border in CSS)
  if (resolvedStroke?.gradient && hasBorderChannels(processed)) {
    // For gradient strokes, we might need to use border-image
    processed['border-image'] = resolvedStroke.gradient
    processed['border-image-slice'] = '1'
  } else if (resolvedStroke?.solidColor) {
    // Update border-color
    if (processed['border-color']) {
      processed['border-color'] = resolvedStroke.solidColor
    }
    if (processed.border) {
      const patched = replaceBorderShorthandColor(processed.border, resolvedStroke.solidColor)
      if (patched) {
        processed.border = patched
      }
    }
  }

  // Process stroke property (SVG elements)
  if (processed.stroke && resolvedStroke?.gradient) {
    // For SVG, we might need to create a gradient definition
    // For now, just use the first color of the gradient
    processed.stroke = resolvedStroke.gradient
  } else if (processed.stroke && resolvedStroke?.solidColor) {
    processed.stroke = resolvedStroke.solidColor
  }

  return processed
}

export async function resolveStylesFromNode(
  cssStyles: Record<string, string>,
  node: SceneNode,
  readers?: FigmaLookupReaders,
  options?: ResolveStyleOptions
): Promise<Record<string, string>> {
  return resolveStylesFromNodeData(cssStyles, createNodePaintStyleInput(node), readers, options)
}
