import { MCP_HASH_HEX_LENGTH } from '@tempad-dev/mcp-shared'

const HASH_FILENAME_PATTERN = new RegExp(
  `^([a-f0-9]{${MCP_HASH_HEX_LENGTH}})(?:\\.[a-z0-9]+)?$`,
  'i'
)

const MIME_EXTENSION_OVERRIDES = new Map<string, string>([['image/jpeg', 'jpg']])

export function normalizeMimeType(mimeType: string | undefined): string {
  if (!mimeType) return 'application/octet-stream'
  const [normalized] = mimeType.split(';', 1)
  return (normalized || 'application/octet-stream').trim().toLowerCase()
}

export function getImageExtension(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType)
  if (!normalized.startsWith('image/')) return ''
  const override = MIME_EXTENSION_OVERRIDES.get(normalized)
  if (override) return `.${override}`
  const subtype = normalized.slice('image/'.length)
  if (!subtype) return ''
  const ext = subtype.split('+', 1)[0] || subtype
  return ext ? `.${ext}` : ''
}

export function buildAssetFilename(hash: string, mimeType: string): string {
  const ext = getImageExtension(mimeType)
  return ext ? `${hash}${ext}` : hash
}

export function getHashFromAssetFilename(filename: string): string | null {
  const match = HASH_FILENAME_PATTERN.exec(filename)
  return match ? match[1] : null
}
