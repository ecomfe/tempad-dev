import { MCP_MAX_ASSET_BYTES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureAssetUploaded } from '@/mcp/assets'
import { handleGetScreenshot } from '@/mcp/tools/screenshot'

const SCREENSHOT_HASH = 'a'.repeat(64)
const SCALED_SCREENSHOT_HASH = 'b'.repeat(64)

vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: vi.fn()
}))

function createNode(
  bytesByScale: Map<number, Uint8Array>,
  width = 200,
  height = 100
): SceneNode & { exportAsync: ReturnType<typeof vi.fn> } {
  return {
    width,
    height,
    exportAsync: vi.fn(({ constraint }: { constraint: { value: number } }) => {
      return Promise.resolve(bytesByScale.get(constraint.value) ?? new Uint8Array())
    })
  } as unknown as SceneNode & { exportAsync: ReturnType<typeof vi.fn> }
}

function createPngBytes(width: number, height: number, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function assignGeometry(node: SceneNode, bounds: Rect, parent: BaseNode & ChildrenMixin): void {
  Object.assign(node, {
    absoluteBoundingBox: bounds,
    absoluteRenderBounds: bounds,
    parent,
    type: 'FRAME',
    visible: true
  })
}

describe('mcp/tools/screenshot', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns screenshot metadata when full scale fits size limit', async () => {
    const bytes = createPngBytes(216, 128, 1024)
    const node = createNode(new Map([[1, bytes]]))
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      size: 1024
    })

    const result = await handleGetScreenshot(node)

    expect(node.exportAsync).toHaveBeenCalledTimes(1)
    expect(node.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    })
    expect(ensureAssetUploaded).toHaveBeenCalledWith(bytes, 'image/png', {
      width: 216,
      height: 128
    })
    expect(result).toEqual({
      format: 'png',
      width: 216,
      height: 128,
      scale: 1,
      bytes: 1024,
      asset: {
        hash: SCREENSHOT_HASH,
        url: 'https://example.com/a.png',
        mimeType: 'image/png',
        size: 1024
      }
    })
  })

  it('exports a non-overlapping page ancestor and crops to nested target bounds', async () => {
    const ancestorBytes = createPngBytes(1000, 800, 4096)
    const croppedBytes = createPngBytes(200, 100, 1024)
    const target = createNode(new Map())
    const ancestor = createNode(new Map([[1, ancestorBytes]]), 1000, 800)
    const cropPng = vi.fn(() => Promise.resolve(croppedBytes))
    const page = {
      children: [ancestor],
      type: 'PAGE'
    } as unknown as PageNode
    const row = {
      absoluteBoundingBox: { x: 100, y: 100, width: 800, height: 600 },
      absoluteRenderBounds: { x: 100, y: 100, width: 800, height: 600 },
      children: [target],
      parent: ancestor,
      type: 'FRAME',
      visible: true
    } as unknown as FrameNode
    assignGeometry(ancestor, { x: 0, y: 0, width: 1000, height: 800 }, page)
    Object.assign(ancestor, { children: [row] })
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, row)
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/crop.png',
      mimeType: 'image/png',
      size: 1024
    })

    const result = await handleGetScreenshot(target, { cropPng })

    expect(target.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    })
    expect(ancestor.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 },
      useAbsoluteBounds: true
    })
    expect(cropPng).toHaveBeenCalledWith(ancestorBytes, {
      x: 250,
      y: 300,
      width: 200,
      height: 100
    })
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
  })

  it('crops a node render export to its exact bounding box before considering ancestors', async () => {
    const directBytes = createPngBytes(300, 200, 4096)
    const croppedBytes = createPngBytes(200, 100, 1024)
    const target = createNode(new Map([[1, directBytes]]))
    const cropPng = vi.fn(() => Promise.resolve(croppedBytes))
    const page = {
      children: [target],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, page)
    Object.assign(target, {
      absoluteRenderBounds: { x: 200, y: 250, width: 300, height: 200 }
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/direct-crop.png',
      mimeType: 'image/png',
      size: 1024
    })

    const result = await handleGetScreenshot(target, { cropPng })

    expect(cropPng).toHaveBeenCalledWith(directBytes, {
      x: 50,
      y: 50,
      width: 200,
      height: 100
    })
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
  })

  it('evaluates direct cropped bytes before retrying at a lower scale', async () => {
    const fullBytes = createPngBytes(300, 200, 4096)
    const scaledBytes = createPngBytes(225, 150, 3072)
    const oversizedCrop = new Uint8Array(MCP_MAX_ASSET_BYTES + 1)
    const fittingCrop = createPngBytes(150, 75, 1024)
    const target = createNode(
      new Map([
        [1, fullBytes],
        [0.75, scaledBytes]
      ])
    )
    const cropPng = vi.fn().mockResolvedValueOnce(oversizedCrop).mockResolvedValueOnce(fittingCrop)
    const page = {
      children: [target],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, page)
    Object.assign(target, {
      absoluteRenderBounds: { x: 200, y: 250, width: 300, height: 200 }
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCALED_SCREENSHOT_HASH,
      url: 'https://example.com/scaled-direct-crop.png',
      mimeType: 'image/png',
      size: 1024
    })

    const result = await handleGetScreenshot(target, { cropPng })

    expect(cropPng).toHaveBeenNthCalledWith(1, fullBytes, {
      x: 50,
      y: 50,
      width: 200,
      height: 100
    })
    expect(cropPng).toHaveBeenNthCalledWith(2, scaledBytes, {
      x: 38,
      y: 38,
      width: 150,
      height: 75
    })
    expect(result.scale).toBe(0.75)
    expect(result.width).toBe(150)
    expect(result.height).toBe(75)
  })

  it('uses the ancestor crop when direct render geometry is nonuniform', async () => {
    const malformedDirect = createPngBytes(300, 180, 4096)
    const ancestorBytes = createPngBytes(1000, 800, 8192)
    const croppedBytes = createPngBytes(200, 100, 1024)
    const target = createNode(new Map([[1, malformedDirect]]))
    const ancestor = createNode(new Map([[1, ancestorBytes]]))
    const cropPng = vi.fn(() => Promise.resolve(croppedBytes))
    const page = {
      children: [ancestor],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(ancestor, { x: 0, y: 0, width: 1000, height: 800 }, page)
    Object.assign(ancestor, { children: [target] })
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, ancestor as FrameNode)
    Object.assign(target, {
      absoluteRenderBounds: { x: 200, y: 250, width: 300, height: 200 }
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/ancestor-after-direct.png',
      mimeType: 'image/png',
      size: 1024
    })

    const result = await handleGetScreenshot(target, { cropPng })

    expect(ancestor.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 },
      useAbsoluteBounds: true
    })
    expect(cropPng).toHaveBeenCalledTimes(1)
    expect(cropPng).toHaveBeenCalledWith(ancestorBytes, {
      x: 250,
      y: 300,
      width: 200,
      height: 100
    })
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
  })

  it('falls back to exact-node export when another branch overlaps the target region', async () => {
    const bytes = createPngBytes(200, 100, 1024)
    const target = createNode(new Map([[1, bytes]]))
    const overlapping = createNode(new Map())
    const ancestor = createNode(new Map())
    const cropPng = vi.fn()
    const page = {
      children: [ancestor],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(ancestor, { x: 0, y: 0, width: 1000, height: 800 }, page)
    Object.assign(ancestor, { children: [target, overlapping] })
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, ancestor as FrameNode)
    assignGeometry(overlapping, { x: 460, y: 320, width: 50, height: 50 }, ancestor as FrameNode)
    Object.assign(overlapping, {
      absoluteRenderBounds: { x: 430, y: 300, width: 100, height: 100 }
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/fallback.png',
      mimeType: 'image/png',
      size: 1024
    })

    await handleGetScreenshot(target, { cropPng })

    expect(cropPng).not.toHaveBeenCalled()
    expect(ancestor.exportAsync).not.toHaveBeenCalled()
    expect(target.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    })
  })

  it('evaluates the cropped payload before falling back to a lower scale', async () => {
    const fullAncestor = createPngBytes(1000, 800, 4096)
    const scaledAncestor = createPngBytes(750, 600, 3072)
    const oversizedCrop = new Uint8Array(MCP_MAX_ASSET_BYTES + 1)
    const fittingCrop = createPngBytes(150, 75, 1024)
    const target = createNode(new Map())
    const ancestor = createNode(
      new Map([
        [1, fullAncestor],
        [0.75, scaledAncestor]
      ])
    )
    const cropPng = vi.fn().mockResolvedValueOnce(oversizedCrop).mockResolvedValueOnce(fittingCrop)
    const page = {
      children: [ancestor],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(ancestor, { x: 0, y: 0, width: 1000, height: 800 }, page)
    Object.assign(ancestor, { children: [target] })
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, ancestor as FrameNode)
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCALED_SCREENSHOT_HASH,
      url: 'https://example.com/scaled-crop.png',
      mimeType: 'image/png',
      size: 1024
    })

    const result = await handleGetScreenshot(target, { cropPng })

    expect(ancestor.exportAsync).toHaveBeenCalledTimes(2)
    expect(cropPng).toHaveBeenNthCalledWith(1, fullAncestor, {
      x: 250,
      y: 300,
      width: 200,
      height: 100
    })
    expect(cropPng).toHaveBeenNthCalledWith(2, scaledAncestor, {
      x: 188,
      y: 225,
      width: 150,
      height: 75
    })
    expect(target.exportAsync).toHaveBeenCalledTimes(2)
    expect(result.scale).toBe(0.75)
    expect(result.width).toBe(150)
    expect(result.height).toBe(75)
  })

  it('falls back when ancestor export dimensions imply nonuniform geometry', async () => {
    const malformedAncestor = createPngBytes(1000, 700, 4096)
    const targetBytes = createPngBytes(200, 100, 1024)
    const target = createNode(new Map([[1, targetBytes]]))
    const ancestor = createNode(new Map([[1, malformedAncestor]]))
    const cropPng = vi.fn()
    const page = {
      children: [ancestor],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(ancestor, { x: 0, y: 0, width: 1000, height: 800 }, page)
    Object.assign(ancestor, { children: [target] })
    assignGeometry(target, { x: 250, y: 300, width: 200, height: 100 }, ancestor as FrameNode)
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/geometry-fallback.png',
      mimeType: 'image/png',
      size: 1024
    })

    await handleGetScreenshot(target, { cropPng })

    expect(ancestor.exportAsync).toHaveBeenCalledTimes(1)
    expect(cropPng).not.toHaveBeenCalled()
    expect(target.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    })
  })

  it('rasterizes a page-root SVG so nested updates are fully composed', async () => {
    const svgBytes = new TextEncoder().encode('<svg width="200" height="100"/>')
    const bytes = createPngBytes(200, 100, 1024)
    const target = createNode(new Map())
    vi.mocked(target.exportAsync).mockResolvedValue(svgBytes)
    const rasterizeSvg = vi.fn(() => Promise.resolve(bytes))
    const cropPng = vi.fn()
    const page = {
      children: [target],
      type: 'PAGE'
    } as unknown as PageNode
    assignGeometry(target, { x: 0, y: 0, width: 200, height: 100 }, page)
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCREENSHOT_HASH,
      url: 'https://example.com/page-root.png',
      mimeType: 'image/png',
      size: 1024
    })

    await handleGetScreenshot(target, { cropPng, rasterizeSvg })

    expect(cropPng).not.toHaveBeenCalled()
    expect(target.exportAsync).toHaveBeenCalledWith({
      format: 'SVG'
    })
    expect(rasterizeSvg).toHaveBeenCalledWith(svgBytes, 1)
  })

  it('falls back to lower scales until payload fits', async () => {
    const oversized = new Uint8Array(MCP_MAX_ASSET_BYTES + 1)
    const fitting = createPngBytes(162, 96, 2048)
    const node = createNode(
      new Map([
        [1, oversized],
        [0.75, fitting]
      ])
    )
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: SCALED_SCREENSHOT_HASH,
      url: 'https://example.com/b.png',
      mimeType: 'image/png',
      size: 2048
    })

    const result = await handleGetScreenshot(node)

    expect(node.exportAsync).toHaveBeenNthCalledWith(1, {
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    })
    expect(node.exportAsync).toHaveBeenNthCalledWith(2, {
      format: 'PNG',
      constraint: { type: 'SCALE', value: 0.75 }
    })
    expect(ensureAssetUploaded).toHaveBeenCalledWith(fitting, 'image/png', {
      width: 162,
      height: 96
    })
    expect(result.scale).toBe(0.75)
    expect(result.width).toBe(162)
    expect(result.height).toBe(96)
    expect(result.bytes).toBe(2048)
  })

  it('rejects invalid PNG bytes instead of reporting node bounds as image dimensions', async () => {
    const node = createNode(new Map([[1, new Uint8Array(1024)]]))

    await expect(handleGetScreenshot(node)).rejects.toThrow(
      'Figma returned an invalid PNG screenshot.'
    )
    expect(ensureAssetUploaded).not.toHaveBeenCalled()
  })

  it('throws when all scale attempts exceed the asset upload limit', async () => {
    const oversized = new Uint8Array(MCP_MAX_ASSET_BYTES + 1)
    const node = createNode(
      new Map([
        [1, oversized],
        [0.75, oversized],
        [0.5, oversized],
        [0.25, oversized]
      ])
    )

    await expect(handleGetScreenshot(node)).rejects.toThrow(
      'Screenshot exceeds the asset upload limit at every supported scale. Reduce selection size and retry.'
    )
    expect(node.exportAsync).toHaveBeenCalledTimes(4)
    expect(ensureAssetUploaded).not.toHaveBeenCalled()
  })
})
