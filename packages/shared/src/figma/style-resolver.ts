/**
 * Figma style resolver utilities
 * Resolves CSS variable references from getCSSAsync to actual style values
 */

import type { PaintList, ResolvedPaintStyle } from './types'

import { resolveGradientFromPaints, resolveSolidFromPaints } from './gradient'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i
const BG_URL_RE = /url\(/i

type NodeDimensions = {
  width: number
  height: number
}

function hasStyleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPaintStyle(style: BaseStyle | null): style is PaintStyle {
  return !!style && 'paints' in style && Array.isArray(style.paints)
}

function resolvePaintStyleFromPaints(
  paints: PaintList,
  size?: NodeDimensions
): ResolvedPaintStyle | null {
  if (!paints) return null
  const gradient = resolveGradientFromPaints(paints, size)
  if (gradient) return { gradient }
  const solidColor = resolveSolidFromPaints(paints)
  return solidColor ? { solidColor } : null
}

function resolvePaintStyleFromStyleId(
  styleId: unknown,
  kind: 'fill' | 'stroke',
  size?: NodeDimensions
): ResolvedPaintStyle | null {
  if (!hasStyleId(styleId)) return null

  try {
    const style = figma.getStyleById(styleId)
    if (!isPaintStyle(style)) return null
    return resolvePaintStyleFromPaints(style.paints, size)
  } catch (error) {
    console.warn(`Failed to resolve ${kind} style:`, error)
    return null
  }
}

function getNodeFillStyleId(node: SceneNode): unknown {
  return 'fillStyleId' in node ? node.fillStyleId : null
}

function getNodeStrokeStyleId(node: SceneNode): unknown {
  return 'strokeStyleId' in node ? node.strokeStyleId : null
}

function getNodeFillPaints(node: SceneNode): PaintList {
  if ('fills' in node && Array.isArray(node.fills)) {
    return node.fills
  }
  return null
}

function getNodeStrokePaints(node: SceneNode): PaintList {
  if ('strokes' in node && Array.isArray(node.strokes)) {
    return node.strokes
  }
  return null
}

function resolveNodePaintStyle(
  styleId: unknown,
  paints: PaintList,
  kind: 'fill' | 'stroke',
  size?: NodeDimensions
): ResolvedPaintStyle | null {
  return (
    resolvePaintStyleFromStyleId(styleId, kind, size) ?? resolvePaintStyleFromPaints(paints, size)
  )
}

function getNodeDimensions(node: SceneNode): NodeDimensions | undefined {
  if (!('width' in node) || !('height' in node)) return undefined

  const width = node.width
  const height = node.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  return { width, height }
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

function patchBorderVarColor(borderValue: string, color: string): string | null {
  const borderParts = splitByTopLevelWhitespace(borderValue)
  if (!borderParts.length) return null

  const lastIndex = borderParts.length - 1
  if (!isVarFunctionToken(borderParts[lastIndex])) return null

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

/**
 * Resolves fill style for a Figma node
 * Handles both fillStyleId and direct fills
 */
export function resolveFillStyleForNode(node: SceneNode): ResolvedPaintStyle | null {
  return resolveNodePaintStyle(
    getNodeFillStyleId(node),
    getNodeFillPaints(node),
    'fill',
    getNodeDimensions(node)
  )
}

/**
 * Resolves stroke style for a Figma node
 * Handles both strokeStyleId and direct strokes
 */
export function resolveStrokeStyleForNode(node: SceneNode): ResolvedPaintStyle | null {
  return resolveNodePaintStyle(
    getNodeStrokeStyleId(node),
    getNodeStrokePaints(node),
    'stroke',
    getNodeDimensions(node)
  )
}

/**
 * Main function to resolve all styles from a node
 * Replaces CSS variable references with actual values
 */
export async function resolveStylesFromNode(
  cssStyles: Record<string, string>,
  node: SceneNode
): Promise<Record<string, string>> {
  const processed = { ...cssStyles }
  const fillPaints = getNodeFillPaints(node)

  // Remove Figma's default lightgray fallback for image fills.
  if (processed.background && BG_URL_LIGHTGRAY_RE.test(processed.background) && fillPaints) {
    const solidFill = resolveSolidFromPaints(fillPaints)
    if (solidFill) {
      processed['background-color'] = solidFill
    }
    processed.background = processed.background.replace(/\s*,?\s*lightgray\b/i, '').trim()
  }

  const resolvedFill = resolveFillStyleForNode(node)
  const hasUrlBackground =
    typeof processed.background === 'string' && BG_URL_RE.test(processed.background)

  // Process background/fill styles
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
    if (processed.color) {
      processed.color = resolvedFill.solidColor
    }
    if (processed.fill) {
      processed.fill = resolvedFill.solidColor
    }
  }

  const resolvedStroke = resolveStrokeStyleForNode(node)

  // Process stroke styles (border in CSS)
  if (resolvedStroke?.gradient && hasBorderChannels(processed)) {
    // For gradient strokes, we might need to use border-image
    processed['border-image'] = resolvedStroke.gradient
    processed['border-image-slice'] = '1'
  } else if (resolvedStroke?.solidColor) {
    // Update border-color
    if (processed['border-color']) {
      processed['border-color'] = resolvedStroke.solidColor
    } else if (processed.border) {
      const patched = patchBorderVarColor(processed.border, resolvedStroke.solidColor)
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
