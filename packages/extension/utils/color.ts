function toHex(c: number) {
  return Math.round(c * 255)
    .toString(16)
    .padStart(2, '0')
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  // r, g, b are all 0~1
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
