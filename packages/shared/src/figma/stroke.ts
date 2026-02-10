/**
 * Stroke-specific utilities for Figma styles
 */

import type { PaintList, ResolvedPaintStyle } from './types'

import { resolveGradientFromPaints, resolveSolidFromPaints } from './gradient'

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

function patchBorderVarColor(borderValue: string, color: string): string | null {
  const borderParts = splitByTopLevelWhitespace(borderValue)
  if (!borderParts.length) return null

  const lastIndex = borderParts.length - 1
  const tail = borderParts[lastIndex].trim()
  if (!tail.startsWith('var(') || !tail.endsWith(')')) return null

  borderParts[lastIndex] = color
  return borderParts.join(' ')
}

/**
 * Resolves stroke styles from paint array
 * Can handle both solid colors and gradients
 * @param paints Array of paint objects from strokes or stroke style
 * @returns Object with solidColor or gradient, or null
 */
export function resolveStrokeFromPaints(paints?: PaintList): ResolvedPaintStyle | null {
  if (!paints || !Array.isArray(paints)) return null

  // Try gradient first (as it's more complex)
  const gradient = resolveGradientFromPaints(paints)
  if (gradient) {
    return { gradient }
  }

  // Fall back to solid color
  const solidColor = resolveSolidFromPaints(paints)
  if (solidColor) {
    return { solidColor }
  }

  return null
}

/**
 * Applies resolved stroke styles to CSS properties
 * Handles different CSS properties for stroke (border, stroke, outline)
 */
export function applyStrokeToCSS(
  styles: Record<string, string>,
  resolved: ResolvedPaintStyle | null
): Record<string, string> {
  if (!resolved) return styles

  const processed = { ...styles }
  const borderHasVar = processed.border?.includes('var(--') ?? false
  const borderColorHasVar = processed['border-color']?.includes('var(--') ?? false

  // Handle border properties
  if (borderHasVar || borderColorHasVar) {
    if (resolved.gradient) {
      // For gradient strokes, use border-image
      processed['border-image'] = `${resolved.gradient} 1`
      processed['border-image-slice'] = '1'
      // Remove conflicting border-color if present
      delete processed['border-color']
    } else if (resolved.solidColor) {
      if (borderColorHasVar) {
        processed['border-color'] = resolved.solidColor
      } else {
        const patched = patchBorderVarColor(processed.border!, resolved.solidColor)
        if (patched) {
          processed.border = patched
        }
      }
    }
  }

  // Handle SVG stroke property
  if (processed.stroke?.includes('var(--')) {
    if (resolved.gradient) {
      // SVG doesn't directly support CSS gradients in stroke
      // Would need to create SVG gradient definitions
      // For now, we'll leave it as a gradient string
      // In practice, this might need special handling in the rendering layer
      processed.stroke = resolved.gradient
    } else if (resolved.solidColor) {
      processed.stroke = resolved.solidColor
    }
  }

  // Handle outline property (less common but possible)
  if (processed['outline-color']?.includes('var(--')) {
    if (resolved.solidColor) {
      processed['outline-color'] = resolved.solidColor
    }
    // Note: outline doesn't support gradients
  }

  return processed
}
