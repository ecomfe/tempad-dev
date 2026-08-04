import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { ensureAssetUploaded } from '@/mcp/assets'
import { detectImageMime, isVisibleMediaPaint } from '@/mcp/media'
import { BG_URL_RE } from '@/utils/css'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { GetCodeCacheContext } from '../cache'

import { getNodeSemanticsCached } from '../cache'

const imageBytesCache = new Map<string, Promise<Uint8Array>>()

export function hasMediaFills(node: SceneNode, ctx?: GetCodeCacheContext): boolean {
  if (ctx) {
    return getNodeSemanticsCached(node, ctx).paint.hasMediaFill
  }
  return 'fills' in node && Array.isArray(node.fills) && node.fills.some(isVisibleMediaPaint)
}

export async function replaceMediaUrlsWithAssets(
  style: Record<string, string>,
  node: SceneNode,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<Record<string, string>> {
  if (!style['background-color'] && !style['background-image'] && !style.background) return style
  const fills = await collectMediaFillAssets(node, assetRegistry)
  if (!fills.length) return replaceMediaUrlsWithPlaceholder(style, node, config)

  const result = { ...style }
  const regex = new RegExp(BG_URL_RE.source, 'gi')
  const lastAsset = fills.at(-1)
  if (!lastAsset) return replaceMediaUrlsWithPlaceholder(style, node, config)

  for (const key of ['background', 'background-image']) {
    if (!result[key]) continue
    let index = 0
    result[key] = result[key].replace(regex, () => {
      const asset = fills[index] ?? lastAsset
      index++
      return `url('${asset.url}')`
    })
  }

  return result
}

function replaceMediaUrlsWithPlaceholder(
  style: Record<string, string>,
  node: SceneNode,
  config: CodegenConfig
): Record<string, string> {
  const { scale = 1 } = config
  let w = 100
  let h = 100

  if ('width' in node && typeof node.width === 'number') {
    w = Math.round(toDecimalPlace(node.width) * scale)
  }
  if ('height' in node && typeof node.height === 'number') {
    h = Math.round(toDecimalPlace(node.height) * scale)
  }

  const placeholderUrl = `https://placehold.co/${w}x${h}`
  const result = { ...style }
  const regex = new RegExp(BG_URL_RE.source, 'gi')

  for (const key of ['background', 'background-image']) {
    if (result[key]) {
      result[key] = result[key].replace(regex, `url('${placeholderUrl}')`)
    }
  }

  return result
}

async function collectMediaFillAssets(
  node: SceneNode,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<AssetDescriptor[]> {
  if (!('fills' in node)) return []
  const fills = Array.isArray(node.fills) ? (node.fills as Paint[]) : null
  if (!fills?.length) return []

  const imageHashes = collectMediaHashes(fills, (fill) =>
    fill.type === 'IMAGE' ? fill.imageHash : null
  )
  const videoHashes = collectMediaHashes(fills, (fill) =>
    fill.type === 'VIDEO' ? fill.videoHash : null
  )
  const hasVisibleImage = fills.some(
    (fill) => isVisibleMediaPaint(fill) && fill.type === 'IMAGE' && !!fill.imageHash
  )
  const assets: AssetDescriptor[] = []
  let preview: Promise<AssetDescriptor> | undefined
  const getPreview = () =>
    (preview ??= node
      .exportAsync({ format: 'PNG' })
      .then((bytes) => ensureAssetUploaded(bytes, 'image/png')))

  for (const fill of fills) {
    if (!isVisibleMediaPaint(fill)) continue

    if (fill.type === 'VIDEO') {
      if (!fill.videoHash) continue
      try {
        const asset = {
          ...(await getPreview()),
          figmaVideoHashes: videoHashes
        }
        registerAsset(assetRegistry, asset)
        if (!hasVisibleImage) assets.push(asset)
      } catch (error) {
        logger.warn('Failed to export video fill preview:', error)
      }
      continue
    }

    const hash = fill.imageHash
    if (!hash) continue
    try {
      const bytes = await loadImageBytes(hash)
      const asset = {
        ...(await ensureAssetUploaded(bytes, detectImageMime(bytes) ?? 'application/octet-stream')),
        figmaImageHash: hash
      }
      registerAsset(assetRegistry, asset)
      assets.push(asset)
    } catch (error) {
      logger.warn(`Image bytes unavailable for hash ${hash}, falling back to node export.`, error)
      try {
        const asset = {
          ...(await getPreview()),
          figmaImageHashes: imageHashes
        }
        registerAsset(assetRegistry, asset)
        assets.push(asset)
      } catch (fallbackError) {
        logger.warn('Failed to export node for image fill fallback:', fallbackError)
      }
    }
  }

  return assets
}

function collectMediaHashes(
  fills: Paint[],
  getHash: (fill: ImagePaint | VideoPaint) => string | null | undefined
): string[] {
  const hashes = new Set<string>()
  for (const fill of fills) {
    if (!isVisibleMediaPaint(fill)) continue
    const hash = getHash(fill)
    if (hash) hashes.add(hash)
  }
  return [...hashes]
}

function registerAsset(registry: Map<string, AssetDescriptor>, asset: AssetDescriptor): void {
  registry.set(asset.hash, { ...registry.get(asset.hash), ...asset })
}

function loadImageBytes(hash: string): Promise<Uint8Array> {
  let promise = imageBytesCache.get(hash)
  if (!promise) {
    const image = figma.getImageByHash(hash)
    if (!image) {
      throw new Error(`Unable to resolve image for hash ${hash}.`)
    }
    promise = image.getBytesAsync().catch((error) => {
      imageBytesCache.delete(hash)
      throw error
    })
    imageBytesCache.set(hash, promise)
  }
  return promise
}
