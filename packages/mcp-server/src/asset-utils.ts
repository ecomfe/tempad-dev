import { MCP_HASH_HEX_LENGTH, MCP_LEGACY_HASH_HEX_LENGTH } from '@tempad-dev/shared'

const HASH_FILENAME_PATTERN = new RegExp(
  `^([a-f0-9]{${MCP_HASH_HEX_LENGTH}}|[a-f0-9]{${MCP_LEGACY_HASH_HEX_LENGTH}})(?:\\.[a-z0-9]+)?$`
)

const SAFE_IMAGE_EXTENSION_PATTERN = /^[a-z0-9-]+$/

export function normalizeMimeType(mimeType: string | undefined): string {
  if (!mimeType) return 'application/octet-stream'
  const [normalized] = mimeType.split(';', 1)
  return (normalized || 'application/octet-stream').trim().toLowerCase()
}

export function getImageExtension(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType)
  if (!normalized.startsWith('image/')) return ''
  if (normalized === 'image/jpeg') return '.jpg'
  const subtype = normalized.slice('image/'.length)
  if (!subtype) return ''
  const ext = subtype.split('+', 1)[0] || subtype
  if (!SAFE_IMAGE_EXTENSION_PATTERN.test(ext)) return ''
  return `.${ext}`
}

export function buildAssetFilename(hash: string, mimeType: string): string {
  const ext = getImageExtension(mimeType)
  return ext ? `${hash}${ext}` : hash
}

export function getHashFromAssetFilename(filename: string): string | null {
  const match = HASH_FILENAME_PATTERN.exec(filename)
  return match ? match[1] : null
}
