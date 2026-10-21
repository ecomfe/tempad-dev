import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { ensureAssetUploaded } from '@/mcp/assets'
import { detectImageMime, isVisibleMediaPaint } from '@/mcp/media'
import { BG_URL_RE, parseBackgroundShorthand, splitByTopLevelComma } from '@/utils/css'
import { getCssPaintLayers } from '@/utils/figma-paint'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { GetCodeCacheContext } from '../cache'

import { getNodeSemanticsCached } from '../cache'

type MediaFillAsset = { asset: AssetDescriptor; tileSize?: string }

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
  assetRegistry: Map<string, AssetDescriptor>,
  videoPreviewAssetHashes?: Set<string>,
  imageBytesCache = new Map<string, Promise<Uint8Array>>(),
  imageSizesCache: GetCodeCacheContext['imageSizes'] = new Map(),
  assertActive?: () => void
): Promise<Record<string, string>> {
  assertActive?.()
  if (!style['background-color'] && !style['background-image'] && !style.background) return style
  const fills = await collectMediaFillAssets(
    node,
    assetRegistry,
    imageBytesCache,
    imageSizesCache,
    videoPreviewAssetHashes,
    assertActive
  )
  assertActive?.()
  const lastAsset = fills.at(-1)
  if (!lastAsset) return replaceMediaUrlsWithPlaceholder(style, node, config)

  const result = { ...style }
  const regex = new RegExp(BG_URL_RE.source, 'gi')

  for (const key of ['background', 'background-image']) {
    if (!result[key]) continue
    let index = 0
    result[key] = result[key].replace(regex, () => {
      const { asset } = fills[index] ?? lastAsset
      index++
      return `url('${asset.url}')`
    })
  }

  if (fills.some((fill) => fill.tileSize)) correctTileSizes(result, fills)
  return result
}

function correctTileSizes(style: Record<string, string>, fills: MediaFillAsset[]): void {
  let tileSizes: (string | undefined)[] = []
  for (const key of ['background', 'background-image']) {
    if (!style[key]) continue
    let index = 0
    const layers = splitByTopLevelComma(style[key])
    tileSizes = []
    for (const [layerIndex, layer] of layers.entries()) {
      const urls = layer.match(new RegExp(BG_URL_RE.source, 'gi')) ?? []
      const tileSize = urls.length === 1 ? fills[index]?.tileSize : undefined
      index += urls.length
      tileSizes.push(tileSize)
      if (!tileSize || key !== 'background') continue
      // Mask URLs so their slashes and dimension-like path segments are never rewritten.
      const layout = layer.replace(BG_URL_RE, (url) => ' '.repeat(url.length))
      const size = parseBackgroundShorthand(layout).size
      const slash = /\/\s*/.exec(layout)
      if (!size || !slash) continue
      const start = slash.index + slash[0].length
      if (!layout.startsWith(size, start)) continue
      layers[layerIndex] = layer.slice(0, start) + tileSize + layer.slice(start + size.length)
    }
    style[key] = layers.join(', ')
  }
  if (style['background-size'] && tileSizes.some(Boolean)) {
    const sizes = splitByTopLevelComma(style['background-size'])
    style['background-size'] = tileSizes
      .map((tileSize, index) => tileSize ?? sizes[index % sizes.length])
      .join(', ')
  }
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
  assetRegistry: Map<string, AssetDescriptor>,
  imageBytesCache: Map<string, Promise<Uint8Array>>,
  imageSizesCache: GetCodeCacheContext['imageSizes'],
  videoPreviewAssetHashes?: Set<string>,
  assertActive?: () => void
): Promise<MediaFillAsset[]> {
  if (!('fills' in node)) return []
  const fills = Array.isArray(node.fills) ? (node.fills as Paint[]) : null
  if (!fills?.length) return []

  const imageHashes = collectMediaHashes(fills, (fill) =>
    fill.type === 'IMAGE' ? fill.imageHash : null
  )
  const videoHashes = collectMediaHashes(fills, (fill) =>
    fill.type === 'VIDEO' ? fill.videoHash : null
  )
  const assets: MediaFillAsset[] = []
  let preview: Promise<AssetDescriptor> | undefined
  const getPreview = () => {
    assertActive?.()
    return (preview ??= node.exportAsync({ format: 'PNG' }).then((bytes) => {
      assertActive?.()
      return ensureAssetUploaded(bytes, 'image/png')
    }))
  }

  for (const { paint: fill } of getCssPaintLayers(fills)) {
    assertActive?.()
    if (!isVisibleMediaPaint(fill)) continue

    if (fill.type === 'VIDEO') {
      if (!fill.videoHash) continue
      try {
        const asset = {
          ...(await getPreview()),
          figmaVideoHashes: videoHashes
        }
        assertActive?.()
        registerAsset(assetRegistry, asset)
        videoPreviewAssetHashes?.add(asset.hash)
        if (!imageHashes.length) assets.push({ asset })
      } catch (error) {
        assertActive?.()
        logger.warn('Failed to export video fill preview:', error)
      }
      continue
    }

    const hash = fill.imageHash
    if (!hash) continue
    try {
      const bytes = await loadImageBytes(hash, imageBytesCache)
      assertActive?.()
      const asset = {
        ...(await ensureAssetUploaded(bytes, detectImageMime(bytes) ?? 'application/octet-stream')),
        figmaImageHash: hash
      }
      assertActive?.()
      // Figma CSS can round the Tile period; only native bytes share these intrinsic dimensions.
      const tileSize =
        fill.scaleMode === 'TILE' ? await getTileSize(fill, hash, imageSizesCache) : undefined
      assertActive?.()
      registerAsset(assetRegistry, asset)
      assets.push({ asset, tileSize })
    } catch (error) {
      assertActive?.()
      logger.warn(`Image bytes unavailable for hash ${hash}, falling back to node export.`, error)
      try {
        const asset = {
          ...(await getPreview()),
          figmaImageHashes: imageHashes
        }
        assertActive?.()
        registerAsset(assetRegistry, asset)
        assets.push({ asset })
      } catch (fallbackError) {
        assertActive?.()
        logger.warn('Failed to export node for image fill fallback:', fallbackError)
      }
    }
  }

  return assets
}

async function getTileSize(
  fill: ImagePaint,
  hash: string,
  cache: GetCodeCacheContext['imageSizes']
): Promise<string | undefined> {
  const scale = fill.scalingFactor ?? 1
  if (!Number.isFinite(scale) || scale <= 0) return
  let promise = cache.get(hash)
  if (!promise) {
    promise = Promise.resolve()
      .then(() => figma.getImageByHash(hash)?.getSizeAsync?.() ?? null)
      .catch(() => null)
    cache.set(hash, promise)
  }
  const size = await promise
  if (!size) return
  const width = size.width * scale
  const height = size.height * scale
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
  return `${toDecimalPlace(width)}px ${toDecimalPlace(height)}px`
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

function loadImageBytes(
  hash: string,
  imageBytesCache: Map<string, Promise<Uint8Array>>
): Promise<Uint8Array> {
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
