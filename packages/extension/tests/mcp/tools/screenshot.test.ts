import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureAssetUploaded } from '@/mcp/assets'
import { handleGetScreenshot } from '@/mcp/tools/screenshot'

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

describe('mcp/tools/screenshot', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns screenshot metadata when full scale fits size limit', async () => {
    const bytes = new Uint8Array(1024)
    const node = createNode(new Map([[1, bytes]]))
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'abcd1234',
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
      width: 200,
      height: 100
    })
    expect(result).toEqual({
      format: 'png',
      width: 200,
      height: 100,
      scale: 1,
      bytes: 1024,
      asset: {
        hash: 'abcd1234',
        url: 'https://example.com/a.png',
        mimeType: 'image/png',
        size: 1024
      }
    })
  })

  it('falls back to lower scales until payload fits', async () => {
    const oversized = new Uint8Array(4 * 1024 * 1024)
    const fitting = new Uint8Array(2048)
    const node = createNode(
      new Map([
        [1, oversized],
        [0.75, fitting]
      ])
    )
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'efgh5678',
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
      width: 150,
      height: 75
    })
    expect(result.scale).toBe(0.75)
    expect(result.width).toBe(150)
    expect(result.height).toBe(75)
    expect(result.bytes).toBe(2048)
  })

  it('throws when all scale attempts exceed the transport limit', async () => {
    const oversized = new Uint8Array(4 * 1024 * 1024)
    const node = createNode(
      new Map([
        [1, oversized],
        [0.75, oversized],
        [0.5, oversized],
        [0.25, oversized]
      ])
    )

    await expect(handleGetScreenshot(node)).rejects.toThrow(
      'Screenshot payload too large to return. Reduce selection size or scale and retry.'
    )
    expect(node.exportAsync).toHaveBeenCalledTimes(4)
    expect(ensureAssetUploaded).not.toHaveBeenCalled()
  })
})
