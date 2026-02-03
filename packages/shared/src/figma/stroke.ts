/**
 * Stroke-specific utilities for Figma styles
 */

import { resolveGradientFromPaints, resolveSolidFromPaints } from './gradient'

/**
 * Resolves stroke styles from paint array
 * Can handle both solid colors and gradients
 * @param paints Array of paint objects from strokes or stroke style
 * @returns Object with solidColor or gradient, or null
 */
export function resolveStrokeFromPaints(paints?: Paint[] | ReadonlyArray<Paint> | null): {
  solidColor?: string
  gradient?: string
} | null {
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
  resolved: { solidColor?: string; gradient?: string } | null
): Record<string, string> {
  if (!resolved) return styles

  const processed = { ...styles }

  // Handle border properties
  if (processed.border?.includes('var(--') || processed['border-color']?.includes('var(--')) {
    if (resolved.gradient) {
      // For gradient strokes, use border-image
      processed['border-image'] = `${resolved.gradient} 1`
      processed['border-image-slice'] = '1'
      // Remove conflicting border-color if present
      delete processed['border-color']
    } else if (resolved.solidColor) {
      if (processed['border-color']) {
        processed['border-color'] = resolved.solidColor
      } else if (processed.border) {
        // Parse and update border shorthand
        const borderParts = processed.border.split(/\s+/)
        const varIndex = borderParts.findIndex((part) => part.includes('var(--'))
        if (varIndex >= 0) {
          borderParts[varIndex] = resolved.solidColor
          processed.border = borderParts.join(' ')
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
