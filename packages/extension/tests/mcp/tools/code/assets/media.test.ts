import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureAssetUploaded } from '@/mcp/assets'
import { hasMediaFills, replaceMediaUrlsWithAssets } from '@/mcp/tools/code/assets/media'
import { logger } from '@/utils/log'

vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: vi.fn()
}))

vi.mock('@/utils/log', () => ({
  logger: {
    warn: vi.fn()
  }
}))

const config = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
} as const

function setFigmaImages(
  images: Record<
    string,
    {
      getBytesAsync: () => Promise<Uint8Array>
    } | null
  >
): void {
  ;(globalThis as { figma?: PluginAPI }).figma = {
    getImageByHash: vi.fn((hash: string) => images[hash] ?? null)
  } as unknown as PluginAPI
}

function imagePaint(hash: string, visible = true): Paint {
  return {
    type: 'IMAGE',
    visible,
    imageHash: hash
  } as unknown as Paint
}

function videoPaint(hash: string, visible = true): Paint {
  return {
    type: 'VIDEO',
    visible,
    videoHash: hash
  } as unknown as Paint
}

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00])
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
])
const unknown = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00])

describe('assets/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (globalThis as { figma?: PluginAPI }).figma
  })

  it('detects only visible image and video fills', () => {
    expect(hasMediaFills({} as SceneNode)).toBe(false)
    expect(
      hasMediaFills({
        fills: [
          { type: 'SOLID', visible: true },
          imagePaint('hidden', false),
          { ...videoPaint('transparent'), opacity: 0 }
        ]
      } as unknown as SceneNode)
    ).toBe(false)
    expect(
      hasMediaFills({
        fills: [imagePaint('visible')]
      } as unknown as SceneNode)
    ).toBe(true)
    expect(
      hasMediaFills({
        fills: [videoPaint('visible')]
      } as unknown as SceneNode)
    ).toBe(true)
  })

  it('skips media export when CSS has no background field', async () => {
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'video-preview',
      url: 'https://assets.local/video-preview',
      mimeType: 'image/png',
      size: 1
    })
    const style = { color: 'red' }
    const registry = new Map()
    const result = await replaceMediaUrlsWithAssets(
      style,
      {
        fills: [videoPaint('video-a')],
        exportAsync: vi.fn(async () => png)
      } as unknown as SceneNode,
      config,
      registry
    )

    expect(result).toBe(style)
    expect(Array.from(registry.values())).toEqual([])
    expect(ensureAssetUploaded).not.toHaveBeenCalled()
  })

  it('falls back to placeholder urls with default and scaled node dimensions', async () => {
    const styleWithoutFillsProperty = {
      background: "url('x')"
    }
    const styleWithoutArrayFills = {
      background: "linear-gradient(red, blue), url('x')",
      'background-image': "url('y')"
    }
    const styleWithArrayFills = {
      background: "url('x')",
      'background-image': "url('y')"
    }
    const styleWithImplicitScale = {
      background: "url('x')"
    }

    const noFillsResult = await replaceMediaUrlsWithAssets(
      styleWithoutFillsProperty,
      {} as unknown as SceneNode,
      config,
      new Map()
    )
    const defaultResult = await replaceMediaUrlsWithAssets(
      styleWithoutArrayFills,
      { fills: { invalid: true } } as unknown as SceneNode,
      config,
      new Map()
    )
    const scaledResult = await replaceMediaUrlsWithAssets(
      styleWithArrayFills,
      {
        fills: [],
        width: 10.4,
        height: 20.4
      } as unknown as SceneNode,
      { ...config, scale: 2 },
      new Map()
    )
    const implicitScaleResult = await replaceMediaUrlsWithAssets(
      styleWithImplicitScale,
      {
        fills: [],
        width: 2,
        height: 3
      } as unknown as SceneNode,
      { cssUnit: 'px', rootFontSize: 16 } as unknown as typeof config,
      new Map()
    )

    expect(noFillsResult).toEqual({
      background: "url('https://placehold.co/100x100')"
    })
    expect(defaultResult).toEqual({
      background: "linear-gradient(red, blue), url('https://placehold.co/100x100')",
      'background-image': "url('https://placehold.co/100x100')"
    })
    expect(scaledResult).toEqual({
      background: "url('https://placehold.co/21x41')",
      'background-image': "url('https://placehold.co/21x41')"
    })
    expect(implicitScaleResult).toEqual({
      background: "url('https://placehold.co/2x3')"
    })
  })

  it('replaces urls with uploaded assets and detects all supported image mimes', async () => {
    setFigmaImages({
      'hash-png': { getBytesAsync: async () => png },
      'hash-jpeg': { getBytesAsync: async () => jpeg },
      'hash-gif': { getBytesAsync: async () => gif },
      'hash-webp': { getBytesAsync: async () => webp },
      'hash-unknown': { getBytesAsync: async () => unknown }
    })

    vi.mocked(ensureAssetUploaded).mockImplementation(async (_bytes, mimeType) => {
      const suffix = mimeType.replace('/', '-')
      return {
        hash: `asset-${suffix}`,
        url: `https://assets.local/${suffix}`,
        mimeType,
        size: 1
      }
    })

    const style = {
      background:
        "url('a'), url('b'), url('c'), url('d'), url('e'), url('f'), linear-gradient(red, blue)",
      'background-image': "url('g')"
    }
    const node = {
      fills: [
        { type: 'SOLID', visible: true },
        imagePaint('hash-hidden', false),
        { type: 'IMAGE', visible: true },
        imagePaint('hash-png'),
        imagePaint('hash-jpeg'),
        imagePaint('hash-gif'),
        imagePaint('hash-webp'),
        imagePaint('hash-unknown')
      ]
    } as unknown as SceneNode

    const registry = new Map()
    const result = await replaceMediaUrlsWithAssets(style, node, config, registry)

    expect(result.background).toBe(
      "url('https://assets.local/image-png'), url('https://assets.local/image-jpeg'), url('https://assets.local/image-gif'), url('https://assets.local/image-webp'), url('https://assets.local/application-octet-stream'), url('https://assets.local/application-octet-stream'), linear-gradient(red, blue)"
    )
    expect(result['background-image']).toBe("url('https://assets.local/image-png')")
    expect(vi.mocked(ensureAssetUploaded).mock.calls.map((call) => call[1])).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/octet-stream'
    ])
    expect(Array.from(registry.keys()).sort()).toEqual([
      'asset-application-octet-stream',
      'asset-image-gif',
      'asset-image-jpeg',
      'asset-image-png',
      'asset-image-webp'
    ])
    expect(Array.from(registry.values(), (asset) => asset.figmaImageHash).sort()).toEqual([
      'hash-gif',
      'hash-jpeg',
      'hash-png',
      'hash-unknown',
      'hash-webp'
    ])
  })

  it('reuses cached image bytes for repeated image hashes', async () => {
    const getBytesAsync = vi.fn(async () => png)
    setFigmaImages({
      'hash-cache-reuse': { getBytesAsync }
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'asset-cache',
      url: 'https://assets.local/cache',
      mimeType: 'image/png',
      size: 1
    })

    const result = await replaceMediaUrlsWithAssets(
      {
        background: "url('x')"
      },
      {
        fills: [imagePaint('hash-cache-reuse'), imagePaint('hash-cache-reuse')]
      } as unknown as SceneNode,
      config,
      new Map()
    )

    expect(result.background).toBe("url('https://assets.local/cache')")
    expect(getBytesAsync).toHaveBeenCalledTimes(1)
  })

  it('uses one composited preview and preserves ordered unique video hashes', async () => {
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'asset-video-preview',
      url: 'https://assets.local/video-preview',
      mimeType: 'image/png',
      size: 1
    })
    const exportAsync = vi.fn(async () => png)
    const registry = new Map()

    const result = await replaceMediaUrlsWithAssets(
      {
        background: "url('a'), url('b'), url('c')"
      },
      {
        fills: [
          videoPaint('video-a'),
          videoPaint('video-b'),
          videoPaint('video-a'),
          videoPaint('hidden', false)
        ],
        exportAsync
      } as unknown as SceneNode,
      config,
      registry
    )

    expect(result.background).toBe(
      "url('https://assets.local/video-preview'), url('https://assets.local/video-preview'), url('https://assets.local/video-preview')"
    )
    expect(exportAsync).toHaveBeenCalledTimes(1)
    expect(ensureAssetUploaded).toHaveBeenCalledWith(png, 'image/png')
    expect(Array.from(registry.values())).toEqual([
      expect.objectContaining({
        figmaVideoHashes: ['video-a', 'video-b']
      })
    ])
  })

  it('keeps video previews out of positional image URL replacement', async () => {
    setFigmaImages({
      'hash-image': { getBytesAsync: async () => jpeg }
    })
    vi.mocked(ensureAssetUploaded).mockImplementation(async (bytes, mimeType) => ({
      hash: bytes === jpeg ? 'asset-image' : 'asset-video-preview',
      url: bytes === jpeg ? 'https://assets.local/image' : 'https://assets.local/video-preview',
      mimeType,
      size: bytes.byteLength
    }))
    const registry = new Map()

    const result = await replaceMediaUrlsWithAssets(
      { background: "url('figma-image')" },
      {
        fills: [videoPaint('video-first'), imagePaint('hash-image')],
        exportAsync: vi.fn(async () => png)
      } as unknown as SceneNode,
      config,
      registry
    )

    expect(result.background).toBe("url('https://assets.local/image')")
    expect(Array.from(registry.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ figmaVideoHashes: ['video-first'] }),
        expect.objectContaining({ figmaImageHash: 'hash-image' })
      ])
    )
  })

  it('retains all native media hashes on a shared rendered fallback', async () => {
    setFigmaImages({
      'hash-fallback-a': null,
      'hash-fallback-b': null
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'asset-fallback',
      url: 'https://assets.local/fallback',
      mimeType: 'image/jpeg',
      size: 1
    })

    const exportAsync = vi.fn(async () => jpeg)
    const registry = new Map()
    const result = await replaceMediaUrlsWithAssets(
      {
        background: "url('x'), url('y'), url('z')"
      },
      {
        fills: [
          imagePaint('hash-fallback-a'),
          videoPaint('video-fallback'),
          imagePaint('hash-fallback-b')
        ],
        exportAsync
      } as unknown as SceneNode,
      config,
      registry
    )

    expect(result.background).toBe(
      "url('https://assets.local/fallback'), url('https://assets.local/fallback'), url('https://assets.local/fallback')"
    )
    expect(Array.from(registry.values())).toEqual([
      expect.objectContaining({
        figmaImageHashes: ['hash-fallback-a', 'hash-fallback-b'],
        figmaVideoHashes: ['video-fallback']
      })
    ])
    expect(exportAsync).toHaveBeenCalledTimes(1)
  })

  it('falls back to placeholder when both image bytes and node export fail', async () => {
    const getBytesAsync = vi.fn(async () => {
      throw new Error('read failed')
    })
    setFigmaImages({
      'hash-fallback-fail': { getBytesAsync }
    })

    const node = {
      fills: [imagePaint('hash-fallback-fail')],
      width: 9,
      height: 9,
      exportAsync: vi.fn(async () => {
        throw new Error('export failed')
      })
    } as unknown as SceneNode

    const style = { background: "url('x')" }
    const first = await replaceMediaUrlsWithAssets(style, node, config, new Map())
    const second = await replaceMediaUrlsWithAssets(style, node, config, new Map())

    expect(first.background).toBe("url('https://placehold.co/9x9')")
    expect(second.background).toBe("url('https://placehold.co/9x9')")
    expect(getBytesAsync).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to export node for image fill fallback:',
      expect.any(Error)
    )
  })
})
