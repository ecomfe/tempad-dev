import type { AssetDescriptor } from '@tempad-dev/mcp-shared'

import {
  MCP_ASSET_URI_PREFIX,
  MCP_HASH_HEX_LENGTH,
  TEMPAD_MCP_ERROR_CODES
} from '@tempad-dev/mcp-shared'

import { logger } from '@/utils/log'

import { createCodedError } from './errors'

const uploadedAssets = new Set<string>()
const inflightUploads = new Map<string, Promise<void>>()
let assetServerUrl: string | null = null

export function setAssetServerUrl(url: string | null): void {
  assetServerUrl = url
}

export function resetUploadedAssets(): void {
  uploadedAssets.clear()
  inflightUploads.clear()
  // We don't clear the URL here as it might be needed for subsequent calls
}

export function buildAssetResourceUri(hash: string): string {
  return `${MCP_ASSET_URI_PREFIX}${hash}`
}

export async function ensureAssetUploaded(
  bytes: Uint8Array,
  mimeType: string,
  metadata?: { width?: number; height?: number }
): Promise<AssetDescriptor> {
  const hash = await hashBytes(bytes)

  if (!assetServerUrl) {
    logger.error('Asset server URL is missing.')
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
      'Asset server URL is not configured. Ensure MCP is connected and this tab is active.'
    )
  }

  const url = `${assetServerUrl}/assets/${hash}`
  const resourceUri = buildAssetResourceUri(hash)
  const size = bytes.byteLength

  const descriptor: AssetDescriptor = {
    hash,
    mimeType,
    size,
    resourceUri,
    url,
    ...metadata
  }

  const uploadKey = `${assetServerUrl}::${hash}`

  if (uploadedAssets.has(uploadKey)) {
    return descriptor
  }

  if (inflightUploads.has(uploadKey)) {
    await inflightUploads.get(uploadKey)
    return descriptor
  }

  const promise = upload(url, bytes, mimeType, metadata)
    .then(() => {
      uploadedAssets.add(uploadKey)
      logger.log(`Uploaded asset ${hash.slice(0, 8)} (${mimeType}, ${size} bytes) to ${url}`)
    })
    .finally(() => {
      inflightUploads.delete(uploadKey)
    })

  inflightUploads.set(uploadKey, promise)
  await promise

  return descriptor
}

async function upload(
  url: string,
  bytes: Uint8Array,
  mimeType: string,
  metadata?: { width?: number; height?: number }
) {
  try {
    const headers: Record<string, string> = {
      'Content-Type': mimeType
    }
    if (metadata?.width) headers['X-Asset-Width'] = String(metadata.width)
    if (metadata?.height) headers['X-Asset-Height'] = String(metadata.height)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: new Blob([toArrayBuffer(bytes)], { type: mimeType })
    })

    if (!response.ok) {
      logger.error('Asset upload failed.', url, response.status, response.statusText)
      throw new Error(`Upload failed with status ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    logger.error('Failed to upload asset via HTTP.', error)
    throw error instanceof Error ? error : new Error('Failed to upload asset via HTTP.')
  }
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto?.subtle?.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
    const fullHex = bufferToHex(new Uint8Array(digest))
    return fullHex.slice(0, MCP_HASH_HEX_LENGTH)
  }
  throw new Error('crypto.subtle.digest is unavailable in this environment.')
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer
  const isArrayBuffer = typeof ArrayBuffer !== 'undefined' && buffer instanceof ArrayBuffer
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength && isArrayBuffer) {
    return buffer
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
