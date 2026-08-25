import { MCP_MAX_ASSET_BYTES } from '@tempad-dev/shared'
import { createHash } from 'node:crypto'

const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/]+={0,2})$/

export interface DecodedImageDataUrl {
  bytes: Buffer
  hash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif'
}

export function decodeImageDataUrl(
  dataUrl: string,
  maxBytes = MCP_MAX_ASSET_BYTES
): DecodedImageDataUrl {
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl)
  if (!match) {
    throw new Error('Expected a base64 PNG, JPEG, or GIF data URL.')
  }

  const mimeType = match[1] as DecodedImageDataUrl['mimeType']
  const encoded = match[2]
  if (encoded.length % 4 !== 0) {
    throw new Error('Image data URL contains invalid base64 padding.')
  }

  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length) throw new Error('Generated image is empty.')
  if (bytes.length > maxBytes) {
    throw new Error(`Generated image exceeds the ${maxBytes}-byte asset limit.`)
  }

  const canonical = bytes.toString('base64')
  if (canonical !== encoded) {
    throw new Error('Image data URL contains invalid base64 data.')
  }

  return {
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
    mimeType
  }
}
