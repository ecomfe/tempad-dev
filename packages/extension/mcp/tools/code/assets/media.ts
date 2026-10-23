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

type MediaFillAsset = { type: 'IMAGE' | 'VIDEO'; asset?: AssetDescriptor; tileSize?: string }

const IMAGE_SIZE_TIMEOUT_MS = 1000

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
  const placeholderUrl = getPlaceholderUrl(node, config)
  const sharedImageAsset = getSharedImageAsset(fills)
  const result = { ...style }
  const regex = new RegExp(BG_URL_RE.source, 'gi')

  for (const key of ['background', 'background-image']) {
    if (!result[key]) continue
    const mappedFills = getCssMediaFills(result[key], fills)
    let index = 0
    result[key] = result[key].replace(regex, () => {
      const asset = (mappedFills[index] ?? mappedFills.at(-1))?.asset ?? sharedImageAsset
      index++
      return `url('${asset ? asset.url : placeholderUrl}')`
    })
  }

  if (fills.some((fill) => fill.tileSize)) correctTileSizes(result, fills)
  return result
}

function getCssMediaFills(value: string, fills: MediaFillAsset[]): MediaFillAsset[] {
  const urlCount = value.match(new RegExp(BG_URL_RE.source, 'gi'))?.length ?? 0
  if (urlCount === fills.length) return fills
  // Native CSS can omit videos from a mixed media stack. Keep failed image slots
  // so an unavailable asset never shifts a later image into the wrong layer.
  const images = fills.filter((fill) => fill.type === 'IMAGE')
  if (urlCount === images.length) return images
  // Repeated URLs can safely share one paint. Keep partial multi-paint stacks
  // unmapped because their source paints cannot be identified.
  return fills.length === 1 ? fills : []
}

function getSharedImageAsset(fills: MediaFillAsset[]): AssetDescriptor | undefined {
  const asset = fills[0]?.asset
  if (!asset?.figmaImageHash) return
  // Uncertain paint geometry still permits the URL when every candidate uses the
  // same native image. Do not extend this fallback to Tile dimensions or previews.
  return fills.every(
    (fill) =>
      fill.type === 'IMAGE' &&
      fill.asset?.figmaImageHash === asset.figmaImageHash &&
      fill.asset?.hash === asset.hash
  )
    ? asset
    : undefined
}

function correctTileSizes(style: Record<string, string>, fills: MediaFillAsset[]): void {
  let tileSizes: (string | undefined)[] = []
  for (const key of ['background', 'background-image']) {
    if (!style[key]) continue
    tileSizes = []
    const mappedFills = getCssMediaFills(style[key], fills)
    const urlCount = style[key].match(new RegExp(BG_URL_RE.source, 'gi'))?.length ?? 0
    // A partial stack does not identify which native paint supplied each URL.
    if (urlCount !== mappedFills.length) continue
    let index = 0
    const layers = splitByTopLevelComma(style[key])
    for (const [layerIndex, layer] of layers.entries()) {
      const urls = layer.match(new RegExp(BG_URL_RE.source, 'gi')) ?? []
      const tileSize = urls.length === 1 ? mappedFills[index]?.tileSize : undefined
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

function getPlaceholderUrl(node: SceneNode, config: CodegenConfig): string {
  const { scale = 1 } = config
  let w = 100
  let h = 100

  if ('width' in node && typeof node.width === 'number') {
    w = Math.round(toDecimalPlace(node.width) * scale)
  }
  if ('height' in node && typeof node.height === 'number') {
    h = Math.round(toDecimalPlace(node.height) * scale)
  }

  return `https://placehold.co/${w}x${h}`
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
  const sizeBudget = { remainingMs: IMAGE_SIZE_TIMEOUT_MS }
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
    const slot: MediaFillAsset = { type: fill.type }
    assets.push(slot)

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
        slot.asset = asset
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
      let tileSize: string | undefined
      if (fill.scaleMode === 'TILE') {
        tileSize = await getTileSize(fill, hash, imageSizesCache, sizeBudget)
      }
      assertActive?.()
      registerAsset(assetRegistry, asset)
      slot.asset = asset
      slot.tileSize = tileSize
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
        slot.asset = asset
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
  cache: GetCodeCacheContext['imageSizes'],
  budget: { remainingMs: number }
): Promise<string | undefined> {
  const scale = fill.scalingFactor ?? 1
  if (!Number.isFinite(scale) || scale <= 0) return
  let promise = cache.get(hash)
  if (!promise) {
    if (budget.remainingMs <= 0) return
    const read = Promise.resolve()
      .then(() => figma.getImageByHash(hash)?.getSizeAsync?.() ?? null)
      .catch(() => null)
    // Dimensions refine native CSS but must never block export. Cache the bounded
    // result so later roots and shell retries do not wait on the same stalled read.
    promise = withSizeTimeout(read, IMAGE_SIZE_TIMEOUT_MS)
    cache.set(hash, promise)
  }
  const start = performance.now()
  // A node's remaining budget limits this wait, not the shared read. Later nodes
  // may still use dimensions that finish within the read's full timeout.
  const size = await withSizeTimeout(promise, budget.remainingMs)
  budget.remainingMs = Math.max(0, budget.remainingMs - (performance.now() - start))
  if (!size) return
  const width = size.width * scale
  const height = size.height * scale
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
  return `${toDecimalPlace(width)}px ${toDecimalPlace(height)}px`
}

function withSizeTimeout<T>(read: Promise<T>, timeoutMs: number): Promise<T | null> {
  // A settled cache entry costs no wait; an exhausted budget never waits for a pending read.
  if (timeoutMs <= 0) return Promise.race([read, Promise.resolve(null)])
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer))
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
  const existing = registry.get(asset.hash)
  const merged = { ...existing, ...asset }
  for (const key of ['figmaImageHashes', 'figmaVideoHashes'] as const) {
    if (existing?.[key] && asset[key]) {
      merged[key] = [...new Set([...existing[key], ...asset[key]])]
    }
  }
  registry.set(asset.hash, merged)
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
