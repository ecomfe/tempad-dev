/**
 * Figma style resolver utilities
 * Resolves CSS variable references from getCSSAsync to actual style values
 */

import { resolveGradientFromPaints, resolveSolidFromPaints } from './gradient'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i
function hasStyleId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

/**
 * Resolves fill style for a Figma node
 * Handles both fillStyleId and direct fills
 */
export function resolveFillStyleForNode(node: SceneNode): {
  solidColor?: string
  gradient?: string
} | null {
  // Try to resolve from fillStyleId first
  if ('fillStyleId' in node && node.fillStyleId) {
    const styleId = node.fillStyleId
    if (typeof styleId === 'string') {
      try {
        const style = figma.getStyleById(styleId) as PaintStyle | null
        if (style?.paints) {
          const gradient = resolveGradientFromPaints(style.paints)
          if (gradient) return { gradient }

          const solid = resolveSolidFromPaints(style.paints)
          if (solid) return { solidColor: solid }
        }
      } catch (e) {
        console.warn('Failed to resolve fill style:', e)
      }
    }
  }

  // Fallback to direct fills
  if ('fills' in node && Array.isArray(node.fills)) {
    const gradient = resolveGradientFromPaints(node.fills as Paint[])
    if (gradient) return { gradient }

    const solid = resolveSolidFromPaints(node.fills as Paint[])
    if (solid) return { solidColor: solid }
  }

  return null
}

/**
 * Resolves stroke style for a Figma node
 * Handles both strokeStyleId and direct strokes
 */
export function resolveStrokeStyleForNode(node: SceneNode): {
  solidColor?: string
  gradient?: string
} | null {
  // Try to resolve from strokeStyleId first
  if ('strokeStyleId' in node && node.strokeStyleId) {
    const styleId = node.strokeStyleId
    if (typeof styleId === 'string') {
      try {
        const style = figma.getStyleById(styleId) as PaintStyle | null
        if (style?.paints) {
          const gradient = resolveGradientFromPaints(style.paints)
          if (gradient) return { gradient }

          const solid = resolveSolidFromPaints(style.paints)
          if (solid) return { solidColor: solid }
        }
      } catch (e) {
        console.warn('Failed to resolve stroke style:', e)
      }
    }
  }

  // Fallback to direct strokes
  if ('strokes' in node && Array.isArray(node.strokes)) {
    const gradient = resolveGradientFromPaints(node.strokes as Paint[])
    if (gradient) return { gradient }

    const solid = resolveSolidFromPaints(node.strokes as Paint[])
    if (solid) return { solidColor: solid }
  }

  return null
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

  // Remove Figma's default lightgray fallback for image fills.
  if (
    processed.background &&
    BG_URL_LIGHTGRAY_RE.test(processed.background) &&
    'fills' in node &&
    Array.isArray(node.fills)
  ) {
    const solidFill = resolveSolidFromPaints(node.fills as Paint[])
    if (solidFill) {
      processed['background-color'] = solidFill
    }
    processed.background = processed.background.replace(/\s*,?\s*lightgray\b/i, '').trim()
  }

  const resolvedFill = resolveFillStyleForNode(node)
  const fillStyleId = 'fillStyleId' in node ? node.fillStyleId : null
  const hasFillStyle = hasStyleId(fillStyleId)

  // Process background/fill styles
  if (resolvedFill?.gradient) {
    if (processed.background && hasFillStyle) {
      processed.background = resolvedFill.gradient
    } else if (processed['background-color'] && hasFillStyle) {
      processed.background = resolvedFill.gradient
      delete processed['background-color']
    }
  } else if (resolvedFill?.solidColor) {
    if (processed.background && hasFillStyle) {
      // If it's a solid color, use background-color instead
      processed['background-color'] = resolvedFill.solidColor
      delete processed.background
    }
    if (processed['background-color'] && hasFillStyle) {
      processed['background-color'] = resolvedFill.solidColor
    }
    if (processed.color && hasFillStyle) {
      processed.color = resolvedFill.solidColor
    }
    if (processed.fill && hasFillStyle) {
      processed.fill = resolvedFill.solidColor
    }
  }

  const resolvedStroke = resolveStrokeStyleForNode(node)
  const strokeStyleId = 'strokeStyleId' in node ? node.strokeStyleId : null
  const hasStrokeStyle = hasStyleId(strokeStyleId)

  // Process stroke styles (border in CSS)
  if (resolvedStroke?.gradient && (processed.border || processed['border-color'])) {
    // For gradient strokes, we might need to use border-image
    processed['border-image'] = resolvedStroke.gradient
    processed['border-image-slice'] = '1'
  } else if (resolvedStroke?.solidColor && hasStrokeStyle) {
    // Update border-color
    if (processed['border-color']) {
      processed['border-color'] = resolvedStroke.solidColor
    } else if (processed.border) {
      // Parse and update border shorthand
      const borderParts = processed.border.split(/\s+/)
      const varIndex = borderParts.findIndex((part) => part.includes('var(--'))
      if (varIndex >= 0) {
        borderParts[varIndex] = resolvedStroke.solidColor
        processed.border = borderParts.join(' ')
      }
    }
  }

  // Process stroke property (SVG elements)
  if (processed.stroke && resolvedStroke?.gradient) {
    // For SVG, we might need to create a gradient definition
    // For now, just use the first color of the gradient
    processed.stroke = resolvedStroke.gradient
  } else if (processed.stroke && hasStrokeStyle) {
    if (resolvedStroke?.solidColor) {
      processed.stroke = resolvedStroke.solidColor
    }
  }

  return processed
}
