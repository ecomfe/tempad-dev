import type { AssetDescriptor, BridgeToPageMessage, PageToBridgeMessage } from '@tempad-dev/shared'

import { MCP_MAX_ASSET_BYTES, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { logger } from '@/utils/log'

import { base64ToBytes, digestMatchesAssetHash, sha256Hex } from './encoding'
import { createCodedError } from './errors'

const uploadedAssets = new Set<string>()
const inflightUploads = new Map<string, Promise<void>>()
const downloadedAssets = new Map<string, Promise<DownloadedAsset>>()
let assetCacheGeneration = 0
let assetServerUrl: string | null = null
let assetUploader: AssetUploader | null = null
let assetDownloader: AssetDownloader | null = null

type AssetUploadPayload = Extract<PageToBridgeMessage, { type: 'mcp.uploadAsset' }>['payload']
type AssetDownloadPayload = NonNullable<
  Extract<BridgeToPageMessage, { type: 'mcp.assetDownloadResult' }>['payload']
>

export type AssetUploadRequest = Omit<AssetUploadPayload, 'base64'> & {
  bytes: Uint8Array
}

type AssetUploader = (request: AssetUploadRequest) => Promise<void>
type DownloadedAsset = {
  bytes: Uint8Array
  mimeType: string
}
export type AssetDownloader = (hash: string) => Promise<AssetDownloadPayload>

export function setAssetServerUrl(url: string | null): void {
  assetServerUrl = url
}

export function setAssetUploader(uploader: AssetUploader | null): void {
  assetUploader = uploader
}

export function setAssetDownloader(downloader: AssetDownloader | null): void {
  assetDownloader = downloader
}

export function resetAssetCache(): void {
  assetCacheGeneration += 1
  uploadedAssets.clear()
  inflightUploads.clear()
  downloadedAssets.clear()
}

export function downloadAsset(hash: string): Promise<DownloadedAsset> {
  const cached = downloadedAssets.get(hash)
  if (cached) return cached
  const promise = requestAsset(hash).catch((error) => {
    if (downloadedAssets.get(hash) === promise) downloadedAssets.delete(hash)
    throw error
  })
  downloadedAssets.set(hash, promise)
  return promise
}

export async function ensureAssetUploaded(
  bytes: Uint8Array,
  mimeType: string,
  metadata?: AssetUploadRequest['metadata']
): Promise<AssetDescriptor> {
  if (bytes.byteLength > MCP_MAX_ASSET_BYTES) {
    throw new Error(
      `Asset is too large to upload (${bytes.byteLength} bytes; maximum ${MCP_MAX_ASSET_BYTES}).`
    )
  }

  const hash = await sha256Hex(bytes)

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
  const generation = assetCacheGeneration

  if (uploadedAssets.has(uploadKey)) {
    return descriptor
  }

  const inflight = inflightUploads.get(uploadKey)
  if (inflight) {
    await inflight
    return descriptor
  }

  const promise = uploadAsset({ bytes, hash, metadata, mimeType })
    .then(() => {
      if (generation === assetCacheGeneration) uploadedAssets.add(uploadKey)
      logger.log(`Uploaded asset ${hash.slice(0, 8)} (${mimeType}, ${size} bytes) to ${url}`)
    })
    .finally(() => {
      if (inflightUploads.get(uploadKey) === promise) inflightUploads.delete(uploadKey)
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

async function requestAsset(hash: string): Promise<DownloadedAsset> {
  if (!assetDownloader) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.ASSET_BRIDGE_UNAVAILABLE,
      'MCP asset download bridge is not connected.'
    )
  }
  const payload = await assetDownloader(hash)
  const bytes = base64ToBytes(payload.base64)
  if (bytes.byteLength !== payload.size) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.ASSET_HASH_MISMATCH,
      `Asset "${hash}" size did not match its descriptor.`
    )
  }
  if (!digestMatchesAssetHash(await sha256Hex(bytes), hash)) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.ASSET_HASH_MISMATCH,
      `Asset "${hash}" did not match its SHA-256 digest.`
    )
  }
  return { bytes, mimeType: payload.mimeType }
}
