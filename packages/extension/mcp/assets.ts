import type { AssetDescriptor } from '@tempad-dev/shared'

import { MCP_HASH_HEX_LENGTH, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { logger } from '@/utils/log'

import { createCodedError } from './errors'

const uploadedAssets = new Set<string>()
const inflightUploads = new Map<string, Promise<void>>()
let assetServerUrl: string | null = null
let assetUploader: AssetUploader | null = null

export type AssetUploadRequest = {
  bytes: Uint8Array
  hash: string
  metadata?: { width?: number; height?: number; themeable?: boolean }
  mimeType: string
}

export type AssetUploader = (request: AssetUploadRequest) => Promise<void>

export function setAssetServerUrl(url: string | null): void {
  assetServerUrl = url
}

export function setAssetUploader(uploader: AssetUploader | null): void {
  assetUploader = uploader
}

export function resetUploadedAssets(): void {
  uploadedAssets.clear()
  inflightUploads.clear()
  // We don't clear the URL here as it might be needed for subsequent calls
}

export async function ensureAssetUploaded(
  bytes: Uint8Array,
  mimeType: string,
  metadata?: { width?: number; height?: number; themeable?: boolean }
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
  const size = bytes.byteLength

  const descriptor: AssetDescriptor = {
    hash,
    mimeType,
    size,
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

  const promise = uploadAsset({ bytes, hash, metadata, mimeType })
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

async function uploadAsset(request: AssetUploadRequest): Promise<void> {
  if (!assetUploader) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED,
      'MCP asset upload bridge is not connected.'
    )
  }
  try {
    await assetUploader(request)
  } catch (error) {
    logger.error('Failed to upload asset via MCP bridge.', error)
    throw error instanceof Error ? error : new Error('Failed to upload asset via MCP bridge.')
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
