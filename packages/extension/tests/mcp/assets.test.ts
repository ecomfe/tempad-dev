import { MCP_MAX_ASSET_BYTES, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/log', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

import {
  downloadAsset,
  ensureAssetUploaded,
  resetAssetCache,
  setAssetDownloader,
  setAssetServerUrl,
  setAssetUploader
} from '@/mcp/assets'

const DIGEST_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
const DIGEST_HEX = Array.from(DIGEST_BYTES)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('')
const EXPECTED_HASH = DIGEST_HEX

function mockCryptoDigest() {
  vi.stubGlobal('crypto', {
    subtle: {
      digest: vi.fn(async () => DIGEST_BYTES.buffer.slice(0))
    }
  } as unknown as Crypto)
}

afterEach(() => {
  resetAssetCache()
  setAssetServerUrl(null)
  setAssetDownloader(null)
  setAssetUploader(null)
  vi.unstubAllGlobals()
})

describe('mcp/assets', () => {
  it('downloads, verifies, and caches content-addressed assets', async () => {
    mockCryptoDigest()
    const downloader = vi.fn().mockResolvedValue({
      base64: 'AQID',
      mimeType: 'image/png',
      size: 3
    })
    setAssetDownloader(downloader)

    const first = await downloadAsset(EXPECTED_HASH)
    const second = await downloadAsset(EXPECTED_HASH)

    expect(downloader).toHaveBeenCalledTimes(1)
    expect(first).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png'
    })
    expect(second).toBe(first)
  })

  it('accepts legacy short hashes for cached downloads during migration', async () => {
    mockCryptoDigest()
    const downloader = vi.fn().mockResolvedValue({
      base64: 'AQID',
      mimeType: 'image/png',
      size: 3
    })
    setAssetDownloader(downloader)

    await expect(downloadAsset(EXPECTED_HASH.slice(0, 8))).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png'
    })
  })

  it('rejects unavailable or invalid downloads without caching failures', async () => {
    await expect(downloadAsset(EXPECTED_HASH)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.ASSET_BRIDGE_UNAVAILABLE
    })

    mockCryptoDigest()
    const downloader = vi.fn().mockResolvedValue({
      base64: 'AQID',
      mimeType: 'image/png',
      size: 4
    })
    setAssetDownloader(downloader)
    await expect(downloadAsset(EXPECTED_HASH)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.ASSET_HASH_MISMATCH
    })
    await expect(downloadAsset(EXPECTED_HASH)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.ASSET_HASH_MISMATCH
    })
    expect(downloader).toHaveBeenCalledTimes(2)
  })

  it('rejects oversized assets before hashing or uploading', async () => {
    const digest = vi.fn()
    vi.stubGlobal('crypto', { subtle: { digest } })
    const uploadMock = vi.fn()
    setAssetUploader(uploadMock)
    setAssetServerUrl('http://assets.local')

    await expect(
      ensureAssetUploaded(new Uint8Array(MCP_MAX_ASSET_BYTES + 1), 'image/png')
    ).rejects.toThrow('Asset is too large to upload')

    expect(digest).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('throws when crypto digest is unavailable in current runtime', async () => {
    vi.stubGlobal('crypto', {} as Crypto)
    setAssetServerUrl('http://assets.local')

    await expect(ensureAssetUploaded(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toThrow(
      'crypto.subtle.digest is unavailable in this environment.'
    )
  })

  it('throws a coded error when asset server URL is missing', async () => {
    mockCryptoDigest()

    await expect(ensureAssetUploaded(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toMatchObject(
      {
        code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
        message: expect.stringContaining('Asset server URL is not configured')
      }
    )
  })

  it('throws a coded error when the bridge uploader is unavailable', async () => {
    mockCryptoDigest()
    setAssetServerUrl('http://assets.local')

    await expect(ensureAssetUploaded(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toMatchObject(
      {
        code: TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED,
        message: 'MCP asset upload bridge is not connected.'
      }
    )
  })

  it('uploads assets once and reuses completed uploads from cache', async () => {
    mockCryptoDigest()
    const uploadMock = vi.fn().mockResolvedValue(undefined)
    setAssetUploader(uploadMock)
    setAssetServerUrl('http://assets.local')

    const bytes = new Uint8Array([10, 20, 30, 40])

    const first = await ensureAssetUploaded(bytes, 'image/png', {
      width: 300,
      height: 200,
      themeable: true
    })
    const second = await ensureAssetUploaded(bytes, 'image/png', {
      width: 300,
      height: 200,
      themeable: true
    })

    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledWith({
      bytes,
      hash: EXPECTED_HASH,
      metadata: {
        height: 200,
        themeable: true,
        width: 300
      },
      mimeType: 'image/png'
    })

    expect(first).toEqual({
      hash: EXPECTED_HASH,
      mimeType: 'image/png',
      size: bytes.byteLength,
      url: `http://assets.local/assets/${EXPECTED_HASH}`,
      width: 300,
      height: 200,
      themeable: true
    })
    expect(second).toEqual(first)
  })

  it('deduplicates in-flight uploads for identical server/hash pairs', async () => {
    mockCryptoDigest()
    let resolveUpload!: () => void
    const pending = new Promise<void>((resolve) => {
      resolveUpload = resolve
    })
    const uploadMock = vi.fn().mockReturnValue(pending)
    setAssetUploader(uploadMock)
    setAssetServerUrl('http://assets.local')

    // Subarray forces a copy path in toArrayBuffer.
    const bytes = new Uint8Array([0, 7, 8, 9]).subarray(1)
    const firstPromise = ensureAssetUploaded(bytes, 'image/svg+xml')
    const secondPromise = ensureAssetUploaded(bytes, 'image/svg+xml')

    await Promise.resolve()
    await Promise.resolve()
    expect(uploadMock).toHaveBeenCalledTimes(1)
    resolveUpload()

    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first).toEqual(second)
  })

  it('does not let a pre-reset upload mark a newer generation as complete', async () => {
    mockCryptoDigest()
    const resolvers: Array<() => void> = []
    const uploadMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve)
        })
    )
    setAssetUploader(uploadMock)
    setAssetServerUrl('http://assets.local')
    const bytes = new Uint8Array([1, 2, 3])

    const stale = ensureAssetUploaded(bytes, 'image/png')
    await vi.waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
    resetAssetCache()
    const current = ensureAssetUploaded(bytes, 'image/png')
    await vi.waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2))

    resolvers[0]!()
    await stale
    let joinedCurrent = false
    const joined = ensureAssetUploaded(bytes, 'image/png').then(() => {
      joinedCurrent = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(joinedCurrent).toBe(false)
    expect(uploadMock).toHaveBeenCalledTimes(2)

    resolvers[1]!()
    await Promise.all([current, joined])
  })

  it('does not let a stale failed download evict a newer cached promise', async () => {
    mockCryptoDigest()
    let rejectStale!: (error: Error) => void
    let resolveCurrent!: (value: { base64: string; mimeType: string; size: number }) => void
    const downloader = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectStale = reject
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCurrent = resolve
          })
      )
    setAssetDownloader(downloader)

    const stale = downloadAsset(EXPECTED_HASH).catch((error) => error)
    resetAssetCache()
    const current = downloadAsset(EXPECTED_HASH)
    rejectStale(new Error('stale failure'))
    await stale
    const joined = downloadAsset(EXPECTED_HASH)

    expect(joined).toBe(current)
    expect(downloader).toHaveBeenCalledTimes(2)
    resolveCurrent({ base64: 'AQID', mimeType: 'image/png', size: 3 })
    await expect(joined).resolves.toMatchObject({ mimeType: 'image/png' })
  })

  it('propagates uploader errors', async () => {
    mockCryptoDigest()
    const uploadMock = vi
      .fn()
      .mockRejectedValue(new Error('Upload failed with status 413 Too Large'))
    setAssetUploader(uploadMock)
    setAssetServerUrl('http://assets.local')

    await expect(ensureAssetUploaded(new Uint8Array([9, 9, 9]), 'image/png')).rejects.toThrow(
      'Upload failed with status 413 Too Large'
    )
  })

  it('normalizes non-error upload failures into Error instances', async () => {
    mockCryptoDigest()
    const uploadMock = vi.fn().mockRejectedValue('network down')
    setAssetUploader(uploadMock)
    setAssetServerUrl('http://assets.local')

    await expect(ensureAssetUploaded(new Uint8Array([5, 4, 3]), 'image/png')).rejects.toThrow(
      'Failed to upload asset via MCP bridge.'
    )
  })
})
