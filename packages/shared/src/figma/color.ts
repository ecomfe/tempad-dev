/**
 * Color utilities for Figma styles
 */

/**
 * Formats a Figma color with opacity to hex notation
 * @param color RGB color object with values 0-1
 * @param opacity Optional opacity value 0-1
 * @returns Hex color string (e.g., "#FF0000" or "#FF0000CC")
 */
export function formatHexAlpha(
  color: { r: number; g: number; b: number },
  opacity: number = 1
): string {
  const toHex = (n: number) => {
    const i = Math.min(255, Math.max(0, Math.round(n * 255)))
    return i.toString(16).padStart(2, '0').toUpperCase()
  }

  const r = toHex(color.r)
  const g = toHex(color.g)
  const b = toHex(color.b)

  if (opacity >= 0.99) {
    // Full opacity - use shorter format if possible
    if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1]) {
      return `#${r[0]}${g[0]}${b[0]}`
    }
    return `#${r}${g}${b}`
  }

  // With transparency
  const a = toHex(opacity)
  if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1] && a[0] === a[1]) {
    return `#${r[0]}${g[0]}${b[0]}${a[0]}`
  }

  return `#${r}${g}${b}${a}`
}
