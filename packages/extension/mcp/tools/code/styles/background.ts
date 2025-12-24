import {
  canonicalizeColor,
  formatHexAlpha,
  parseBackgroundShorthand,
  preprocessCssValue,
  stripFallback
} from '@/utils/css'

const BG_URL_LIGHTGRAY_RE = /url\(.*?\)\s+lightgray/i

export function cleanFigmaSpecificStyles(
  style: Record<string, string>,
  node?: SceneNode
): Record<string, string> {
  if (!node) return style
  const processed = style

  if (processed.background) {
    const bgValue = processed.background
    const normalized = stripFallback(preprocessCssValue(bgValue)).trim()

    if (isSolidBackground(normalized)) {
      processed['background-color'] = normalized
      delete processed.background
    } else {
      if (BG_URL_LIGHTGRAY_RE.test(bgValue) && 'fills' in node && Array.isArray(node.fills)) {
        const parsed = parseBackgroundShorthand(bgValue)

        if (parsed.image) processed['background-image'] = parsed.image
        if (parsed.size) processed['background-size'] = parsed.size
        if (parsed.repeat) processed['background-repeat'] = parsed.repeat
        if (parsed.position) processed['background-position'] = parsed.position

        const solidFill = node.fills.find(
          (f) => f.type === 'SOLID' && f.visible !== false
        ) as SolidPaint

        if (solidFill && solidFill.color) {
          processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
        }

        delete processed.background
      }
    }
  }

  if (
    node.type !== 'TEXT' &&
    !processed.background &&
    !processed['background-color'] &&
    'fills' in node &&
    Array.isArray(node.fills)
  ) {
    const solidFill = node.fills.find(
      (f) => f.type === 'SOLID' && f.visible !== false
    ) as SolidPaint
    if (solidFill && solidFill.color) {
      processed['background-color'] = formatHexAlpha(solidFill.color, solidFill.opacity)
    }
  }

  return processed
}

function isSolidBackground(value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/var\(\s*--[A-Za-z0-9_-]+\s*\)/i.test(trimmed)) return true
  return canonicalizeColor(trimmed.toLowerCase()) !== null
}
