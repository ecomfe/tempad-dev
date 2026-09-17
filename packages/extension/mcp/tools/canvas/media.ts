import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { readBoundedResponseBytes } from '../../bounded-response'
import { createCodedError } from '../../errors'
import { type ResolvedCanvasAssets, resolvedImageAsset } from './assets'
import { specError } from './errors'

const MAX_VIDEO_BYTES = 100 * 1024 * 1024
const MAX_IMPORTED_IMAGE_HASHES = 256
const importedImageHashes = new Map<string, string>()

export type CanvasMediaState = {
  assets: ResolvedCanvasAssets
  imageHashes: Map<string, string>
  imageAssetKeys: Set<string>
  imageUrls: Map<string, string>
  videoHashes: Map<string, string>
  videoUrls: Set<string>
}

export function createMediaState(assets: ResolvedCanvasAssets): CanvasMediaState {
  return {
    assets,
    imageHashes: new Map(),
    imageAssetKeys: new Set(),
    imageUrls: new Map(),
    videoHashes: new Map(),
    videoUrls: new Set()
  }
}

export async function importCanvasMedia(state: CanvasMediaState): Promise<void> {
  await resolveImageUrls(state)
  resolveImageAssets(state)
  await resolveVideoUrls(state)
}

async function resolveImageUrls(state: CanvasMediaState): Promise<void> {
  for (const [url, usage] of state.imageUrls) {
    try {
      state.imageHashes.set(url, (await figma.createImageAsync(url)).hash)
    } catch {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.IMAGE_IMPORT_FAILED,
        `Image URL for ${usage} could not be imported as a PNG, JPEG, or GIF up to 4096 by 4096 px. Use a direct public image URL in one of those formats, or a resolved image asset for exact bytes.`
      )
    }
  }
}

function resolveImageAssets(state: CanvasMediaState): void {
  for (const key of state.imageAssetKeys) {
    const asset = resolvedImageAsset(state.assets, key)
    if (!asset) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
        `Image asset "${key}" was not resolved.`
      )
    }
    try {
      const cachedHash = importedImageHashes.get(asset.hash)
      if (cachedHash) importedImageHashes.delete(asset.hash)
      const imageHash =
        cachedHash && figma.getImageByHash(cachedHash)
          ? cachedHash
          : figma.createImage(asset.bytes).hash
      importedImageHashes.set(asset.hash, imageHash)
      while (importedImageHashes.size > MAX_IMPORTED_IMAGE_HASHES) {
        importedImageHashes.delete(importedImageHashes.keys().next().value!)
      }
      state.imageHashes.set(`asset:${key}`, imageHash)
    } catch {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.IMAGE_IMPORT_FAILED,
        `Image asset "${key}" could not be imported as a PNG, JPEG, or GIF up to 4096 by 4096 px.`
      )
    }
  }
}

async function readVideoBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return readBoundedResponseBytes(
    response,
    MAX_VIDEO_BYTES,
    () => new Error('Video exceeds 100MB.')
  )
}

async function resolveVideoUrls(state: CanvasMediaState): Promise<void> {
  for (const url of state.videoUrls) {
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        signal: AbortSignal.timeout(60_000)
      })
      const video = await figma.createVideoAsync(await readVideoBytes(response))
      state.videoHashes.set(url, video.hash)
    } catch {
      specError(
        'A video URL could not be imported as an MP4, MOV, or WebM up to 100MB. Figma video uploads require a paid team file.'
      )
    }
  }
}
