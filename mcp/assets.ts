import type { AssetDescriptor } from '@/mcp/shared/types'

import { MCP_ASSET_URI_PREFIX } from '@/mcp/shared/constants'

const uploadedAssets = new Set<string>()
let assetServerUrl: string | null = null

export function setAssetServerUrl(url: string | null): void {
  assetServerUrl = url
}

export function resetUploadedAssets(): void {
  uploadedAssets.clear()
}

export function buildAssetResourceUri(hash: string): string {
  return `${MCP_ASSET_URI_PREFIX}${hash}`
}

export async function ensureAssetUploaded(
  bytes: Uint8Array,
  mimeType: string
): Promise<AssetDescriptor> {
  const hash = await hashBytes(bytes)

  if (!assetServerUrl) {
    throw new Error('Asset server URL is not configured.')
  }

  const url = `${assetServerUrl}/assets/${hash}`
  const resourceUri = buildAssetResourceUri(hash)
  const size = bytes.byteLength

  const descriptor: AssetDescriptor = {
    hash,
    mimeType,
    size,
    resourceUri,
    url
  }

  if (uploadedAssets.has(hash)) {
    return descriptor
  }

  await upload(url, bytes, mimeType)
  uploadedAssets.add(hash)

  return descriptor
}

async function upload(url: string, bytes: Uint8Array, mimeType: string) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType
      },
      body: new Blob([toArrayBuffer(bytes)], { type: mimeType })
    })

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('Failed to upload asset via HTTP.')
  }
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto?.subtle?.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
    return bufferToHex(new Uint8Array(digest))
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
