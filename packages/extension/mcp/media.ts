type ImageMimeType = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'

function hasSignature(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value)
  )
}

export function detectImageMime(bytes: Uint8Array): ImageMimeType | null {
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (
    hasSignature(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasSignature(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif'
  }
  if (
    hasSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp'
  }
  return null
}

export function isVisibleMediaPaint(
  paint: Paint | null | undefined
): paint is ImagePaint | VideoPaint {
  return (
    !!paint &&
    (paint.type === 'IMAGE' || paint.type === 'VIDEO') &&
    paint.visible !== false &&
    (paint.opacity ?? 1) > 0
  )
}
