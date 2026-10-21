import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureAssetUploaded } from '@/mcp/assets'
import { hasMediaFills, replaceMediaUrlsWithAssets } from '@/mcp/tools/code/assets/media'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
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
      getSizeAsync?: () => Promise<{ width: number; height: number }>
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
  it.each(
    ['image bytes', 'image dimensions', 'video preview', 'image fallback', 'asset upload'].flatMap(
      (stage) => ['resolve', 'reject'].map((outcome) => ({ stage, outcome }))
    )
  )('stops after an expired $stage request settles with $outcome', async ({ stage, outcome }) => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let finish!: () => void
    const stall = <T>(value: T) =>
      new Promise<T>((resolve, reject) => {
        finish = () =>
          outcome === 'resolve' ? resolve(value) : reject(new Error('Native request failed'))
        started()
      })
    const asset = {
      hash: 'asset',
      url: 'https://assets.test/asset',
      mimeType: 'image/png',
      size: png.length
    }
    vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)
    if (stage === 'asset upload')
      vi.mocked(ensureAssetUploaded).mockImplementationOnce(() => stall(asset))
    const unread = vi.fn(async () => png)
    setFigmaImages({
      unread: { getBytesAsync: unread },
      first:
        stage === 'image fallback'
          ? null
          : {
              getBytesAsync: () => (stage === 'image bytes' ? stall(png) : Promise.resolve(png)),
              getSizeAsync: () => stall({ width: 96, height: 96 })
            }
    })
    const exportAsync = vi.fn(() =>
      stage === 'video preview' || stage === 'image fallback' ? stall(png) : Promise.resolve(png)
    )
    const registry = new Map()
    const previewHashes = new Set<string>()
    const controller = new AbortController()
    const pending = replaceMediaUrlsWithAssets(
      { background: 'url(first), url(unread)' },
      {
        fills: [
          imagePaint('unread'),
          stage === 'video preview'
            ? videoPaint('first')
            : {
                ...imagePaint('first'),
                ...(stage === 'image dimensions' ? { scaleMode: 'TILE', scalingFactor: 0.5 } : {})
              }
        ],
        exportAsync
      } as unknown as SceneNode,
      config,
      registry,
      previewHashes,
      new Map(),
      new Map(),
      () => controller.signal.throwIfAborted()
    )
    await ready
    const reason = new Error('Code generation timed out')
    controller.abort(reason)
    const rejected = expect(pending).rejects.toBe(reason)
    finish()
    await rejected

    expect(ensureAssetUploaded).toHaveBeenCalledTimes(
      stage === 'asset upload' || stage === 'image dimensions' ? 1 : 0
    )
    expect(exportAsync).toHaveBeenCalledTimes(
      stage === 'video preview' || stage === 'image fallback' ? 1 : 0
    )
    expect(unread).not.toHaveBeenCalled()
    expect(registry.size).toBe(0)
    expect(previewHashes.size).toBe(0)
  })

  it('does not retain image bytes between requests', async () => {
    const getBytesAsync = vi.fn(async () => png)
    setFigmaImages({ fresh: { getBytesAsync } })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'fresh',
      url: 'https://assets.test/fresh',
      mimeType: 'image/png',
      size: 8
    })
    const node = { fills: [imagePaint('fresh')] } as unknown as SceneNode
    await replaceMediaUrlsWithAssets({ background: 'url(image)' }, node, config, new Map())
    await replaceMediaUrlsWithAssets({ background: 'url(image)' }, node, config, new Map())
    expect(getBytesAsync).toHaveBeenCalledTimes(2)
  })

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
      "url('https://assets.local/application-octet-stream'), url('https://assets.local/image-webp'), url('https://assets.local/image-gif'), url('https://assets.local/image-jpeg'), url('https://assets.local/image-png'), url('https://assets.local/image-png'), linear-gradient(red, blue)"
    )
    expect(result['background-image']).toBe("url('https://assets.local/application-octet-stream')")
    expect(vi.mocked(ensureAssetUploaded).mock.calls.map((call) => call[1])).toEqual([
      'application/octet-stream',
      'image/webp',
      'image/gif',
      'image/jpeg',
      'image/png'
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

  it('uses native Tile dimensions while preserving mixed background geometry and order', async () => {
    const getSizeAsync = vi.fn(async () => ({ width: 96, height: 64 }))
    const cropSize = vi.fn(async () => ({ width: 96, height: 64 }))
    setFigmaImages({
      tile: { getBytesAsync: async () => png, getSizeAsync },
      crop: { getBytesAsync: async () => jpeg, getSizeAsync: cropSize }
    })
    vi.mocked(ensureAssetUploaded).mockImplementation(async (bytes) => ({
      hash: bytes === png ? 'tile' : 'crop',
      url: `https://assets.local/${bytes === png ? 'tile' : 'crop'}.png`,
      mimeType: 'image/png',
      size: bytes.length
    }))
    const node = {
      fills: [
        { ...imagePaint('crop'), scaleMode: 'CROP' },
        { ...imagePaint('tile'), scaleMode: 'TILE', scalingFactor: 0.5 }
      ]
    } as unknown as SceneNode
    const result = await replaceMediaUrlsWithAssets(
      {
        background:
          'linear-gradient(red, blue), url("https://figma.test/50px 50px/tile.png") 0% 0% / 50px 50px repeat, url(crop) -2.08px -14.75px / 104.167% 145.833% no-repeat',
        'background-size': 'auto, 50px 50px, 104.167% 145.833%'
      },
      node,
      config,
      new Map()
    )
    expect(result).toEqual({
      background:
        "linear-gradient(red, blue), url('https://assets.local/tile.png') 0% 0% / 48px 32px repeat, url('https://assets.local/crop.png') -2.08px -14.75px / 104.167% 145.833% no-repeat",
      'background-size': 'auto, 48px 32px, 104.167% 145.833%'
    })
    expect(getSizeAsync).toHaveBeenCalledTimes(1)
    expect(cropSize).not.toHaveBeenCalled()
  })

  it.each(['missing', 'rejected', 'invalid', 'fallback'])(
    'retains native CSS geometry when Tile dimensions are %s',
    async (mode) => {
      const getSizeAsync = vi.fn(async () => {
        if (mode === 'rejected') throw new Error('Size unavailable')
        return { width: mode === 'invalid' ? 0 : 96, height: 96 }
      })
      setFigmaImages({
        tile: {
          getBytesAsync: async () => {
            if (mode === 'fallback') throw new Error('Bytes unavailable')
            return png
          },
          ...(mode === 'missing' ? {} : { getSizeAsync })
        }
      })
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: 'tile',
        url: 'https://assets.local/tile.png',
        mimeType: 'image/png',
        size: png.length
      })
      const registry = new Map()
      const result = await replaceMediaUrlsWithAssets(
        { 'background-image': 'url(tile)', 'background-size': '50px 50px' },
        {
          fills: [{ ...imagePaint('tile'), scaleMode: 'TILE', scalingFactor: 0.5 }],
          exportAsync: async () => png
        } as unknown as SceneNode,
        config,
        registry
      )
      expect(result).toEqual({
        'background-image': "url('https://assets.local/tile.png')",
        'background-size': '50px 50px'
      })
      if (mode === 'fallback') {
        expect(getSizeAsync).not.toHaveBeenCalled()
        expect(registry.get('tile')).toHaveProperty('figmaImageHashes', ['tile'])
      }
    }
  )

  it('preserves unfamiliar shorthand syntax instead of rewriting a color function slash', async () => {
    setFigmaImages({
      tile: {
        getBytesAsync: async () => png,
        getSizeAsync: async () => ({ width: 96, height: 96 })
      }
    })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'tile',
      url: 'https://assets.local/tile.png',
      mimeType: 'image/png',
      size: png.length
    })
    const result = await replaceMediaUrlsWithAssets(
      { background: 'rgb(0 0 0 / 0.5) url(tile) 0% 0% / 50px 50px repeat' },
      {
        fills: [{ ...imagePaint('tile'), scaleMode: 'TILE', scalingFactor: 0.5 }]
      } as unknown as SceneNode,
      config,
      new Map()
    )
    expect(result.background).toBe(
      "rgb(0 0 0 / 0.5) url('https://assets.local/tile.png') 0% 0% / 50px 50px repeat"
    )
  })

  it('caches native dimensions per request and applies each Tile scale to the correct layer', async () => {
    const getBytesAsync = vi.fn(async () => png)
    const getSizeAsync = vi.fn(async () => ({ width: 97, height: 63 }))
    setFigmaImages({ tile: { getBytesAsync, getSizeAsync } })
    vi.mocked(ensureAssetUploaded).mockResolvedValue({
      hash: 'tile',
      url: 'https://assets.local/tile.png',
      mimeType: 'image/png',
      size: png.length
    })
    const style = {
      'background-image': 'linear-gradient(red, blue), url(first), url(second)',
      'background-size': '50px 50px'
    }
    const node = {
      fills: [0.5, 0.25].map((scalingFactor) => ({
        ...imagePaint('tile'),
        scaleMode: 'TILE',
        scalingFactor
      }))
    } as unknown as SceneNode
    const cache = createGetCodeCacheContext()
    for (let i = 0; i < 2; i++) {
      const result = await replaceMediaUrlsWithAssets(
        style,
        node,
        config,
        new Map(),
        undefined,
        cache.imageBytes,
        cache.imageSizes
      )
      expect(result['background-size']).toBe('50px 50px, 24.25px 15.75px, 48.5px 31.5px')
    }
    expect(getBytesAsync).toHaveBeenCalledTimes(1)
    expect(getSizeAsync).toHaveBeenCalledTimes(1)
    await replaceMediaUrlsWithAssets(style, node, config, new Map())
    expect(getBytesAsync).toHaveBeenCalledTimes(2)
    expect(getSizeAsync).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, 0, NaN])(
    'handles a Tile scale of %s conservatively',
    async (scalingFactor) => {
      const getSizeAsync = vi.fn(async () => ({ width: 96, height: 96 }))
      setFigmaImages({ tile: { getBytesAsync: async () => png, getSizeAsync } })
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: 'tile',
        url: 'https://assets.local/tile.png',
        mimeType: 'image/png',
        size: png.length
      })
      const result = await replaceMediaUrlsWithAssets(
        { 'background-image': 'url(tile)', 'background-size': '100px 100px' },
        {
          fills: [{ ...imagePaint('tile'), scaleMode: 'TILE', scalingFactor }]
        } as unknown as SceneNode,
        config,
        new Map()
      )
      expect(result['background-size']).toBe(
        scalingFactor === undefined ? '96px 96px' : '100px 100px'
      )
      expect(getSizeAsync).toHaveBeenCalledTimes(scalingFactor === undefined ? 1 : 0)
    }
  )

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
    const videoPreviewAssetHashes = new Set<string>()

    const result = await replaceMediaUrlsWithAssets(
      { background: "url('figma-image')" },
      {
        fills: [videoPaint('video-first'), imagePaint('hash-image')],
        exportAsync: vi.fn(async () => png)
      } as unknown as SceneNode,
      config,
      registry,
      videoPreviewAssetHashes
    )

    expect(result.background).toBe("url('https://assets.local/image')")
    expect(Array.from(registry.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ figmaVideoHashes: ['video-first'] }),
        expect.objectContaining({ figmaImageHash: 'hash-image' })
      ])
    )
    expect(videoPreviewAssetHashes).toEqual(new Set(['asset-video-preview']))
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
