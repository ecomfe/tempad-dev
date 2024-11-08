export function fadeTo(hex: string, alpha: number = 1): string {
  let h = hex.replace(/^#/, '')

  if (alpha === 1) {
    if (h.length === 6 && h[0] === h[1] && h[2] === h[3] && h[4] === h[5]) {
      return `#${h[0]}${h[2]}${h[4]}`
    }
    return hex
  }

  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }

  if (h.length !== 6) {
    throw new Error('Invalid hex color')
  }

  // Ensure valid alpha value
  alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha

  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
