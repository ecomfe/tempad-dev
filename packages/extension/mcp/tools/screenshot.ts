import type { GetScreenshotResult } from '@tempad-dev/shared'

import { MCP_MAX_ASSET_BYTES } from '@tempad-dev/shared'

import { ensureAssetUploaded } from '@/mcp/assets'

const SCALE_STEPS = [1, 0.75, 0.5, 0.25]

interface PngCropRect {
  x: number
  y: number
  width: number
  height: number
}

interface CropSource {
  sourceBounds: Rect
  targetBounds: Rect
}

interface AncestorCropSource extends CropSource {
  ancestor: SceneNode
}

interface ScreenshotRuntimeOptions {
  cropPng?: (bytes: Uint8Array, rect: PngCropRect) => Promise<Uint8Array>
}

function finiteRect(value: Rect | null | undefined): Rect | null {
  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return null
  }
  return value
}

function overlapBounds(node: SceneNode): Rect | null {
  const absoluteRenderBounds =
    'absoluteRenderBounds' in node ? node.absoluteRenderBounds : undefined
  return finiteRect(absoluteRenderBounds) ?? finiteRect(node.absoluteBoundingBox)
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function resolveDirectCropSource(node: SceneNode): CropSource | null {
  const sourceBounds = overlapBounds(node)
  const targetBounds = finiteRect(node.absoluteBoundingBox)
  if (
    !sourceBounds ||
    !targetBounds ||
    sameRect(sourceBounds, targetBounds) ||
    !contains(sourceBounds, targetBounds)
  ) {
    return null
  }
  return { sourceBounds, targetBounds }
}

function resolveAncestorCropSource(node: SceneNode): AncestorCropSource | null {
  const targetBounds = finiteRect(node.absoluteBoundingBox)
  if (!targetBounds) return null

  let branch: BaseNode = node
  let parent = node.parent
  let ancestor: SceneNode | null = null

  while (parent) {
    if (!('children' in parent)) return null

    for (const sibling of parent.children) {
      const siblingBounds =
        sibling === branch || sibling.visible === false ? null : overlapBounds(sibling)
      if (siblingBounds && intersects(targetBounds, siblingBounds)) return null
    }

    if (parent.type === 'PAGE') {
      if (!ancestor || ancestor === node) return null
      const ancestorBounds = finiteRect(ancestor.absoluteBoundingBox)
      if (!ancestorBounds || !contains(ancestorBounds, targetBounds)) return null
      return { ancestor, sourceBounds: ancestorBounds, targetBounds }
    }

    if (!('visible' in parent) || !('absoluteBoundingBox' in parent)) return null
    ancestor = parent as SceneNode
    branch = parent
    parent = parent.parent
  }

  return null
}

function resolveCropRect(
  source: CropSource,
  image: { width: number; height: number }
): PngCropRect | null {
  const scaleX = image.width / source.sourceBounds.width
  const scaleY = image.height / source.sourceBounds.height
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0 ||
    Math.abs(scaleX - scaleY) > 0.01
  ) {
    return null
  }

  const left = Math.round((source.targetBounds.x - source.sourceBounds.x) * scaleX)
  const top = Math.round((source.targetBounds.y - source.sourceBounds.y) * scaleY)
  const right = Math.round(
    (source.targetBounds.x + source.targetBounds.width - source.sourceBounds.x) * scaleX
  )
  const bottom = Math.round(
    (source.targetBounds.y + source.targetBounds.height - source.sourceBounds.y) * scaleY
  )
  const rect = { x: left, y: top, width: right - left, height: bottom - top }

  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    return null
  }
  return rect
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Browser canvas could not encode the cropped PNG screenshot.'))
    }, 'image/png')
  })
}

export async function cropPngWithCanvas(bytes: Uint8Array, rect: PngCropRect): Promise<Uint8Array> {
  const sourceBlob = new Blob([bytes.slice().buffer], { type: 'image/png' })
  const bitmap = await createImageBitmap(sourceBlob)

  try {
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x + rect.width > bitmap.width ||
      rect.y + rect.height > bitmap.height
    ) {
      throw new Error('Requested PNG crop is outside the exported source bounds.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser canvas 2D context is unavailable.')
    context.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height
    )
    const cropped = await canvasToPng(canvas)
    return new Uint8Array(await cropped.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const isPng =
    bytes.byteLength >= 24 &&
    signature.every((value, index) => bytes[index] === value) &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52

  if (!isPng) {
    throw new Error('Figma returned an invalid PNG screenshot.')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)

  if (width === 0 || height === 0) {
    throw new Error('Figma returned a PNG screenshot with invalid dimensions.')
  }

  return { width, height }
}

export async function handleGetScreenshot(
  node: SceneNode,
  options: ScreenshotRuntimeOptions = {}
): Promise<GetScreenshotResult> {
  const directCropSource = resolveDirectCropSource(node)
  const ancestorCropSource = resolveAncestorCropSource(node)
  const cropPng = options.cropPng ?? cropPngWithCanvas

  for (const scale of SCALE_STEPS) {
    const directBytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    })
    const directCropRect = directCropSource
      ? resolveCropRect(directCropSource, readPngDimensions(directBytes))
      : null
    let bytes = directCropRect ? await cropPng(directBytes, directCropRect) : directBytes

    if (!directCropRect && ancestorCropSource) {
      const ancestorBytes = await ancestorCropSource.ancestor.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale },
        useAbsoluteBounds: true
      })
      const ancestorDimensions = readPngDimensions(ancestorBytes)
      const ancestorCropRect = resolveCropRect(ancestorCropSource, ancestorDimensions)
      if (ancestorCropRect) bytes = await cropPng(ancestorBytes, ancestorCropRect)
    }
    const { byteLength } = bytes

    if (byteLength <= MCP_MAX_ASSET_BYTES) {
      const { width, height } = readPngDimensions(bytes)
      const asset = await ensureAssetUploaded(bytes, 'image/png', { width, height })

      return {
        format: 'png',
        width,
        height,
        scale,
        bytes: byteLength,
        asset
      }
    }
  }

  throw new Error(
    'Screenshot exceeds the asset upload limit at every supported scale. Reduce selection size and retry.'
  )
}
