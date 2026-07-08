import { MCP_HASH_HEX_LENGTH, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
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
  ensureAssetUploaded,
  resetUploadedAssets,
  setAssetServerUrl,
  setAssetUploader
} from '@/mcp/assets'

const DIGEST_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
const DIGEST_HEX = Array.from(DIGEST_BYTES)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('')
const EXPECTED_HASH = DIGEST_HEX.slice(0, MCP_HASH_HEX_LENGTH)

function mockCryptoDigest() {
  vi.stubGlobal('crypto', {
    subtle: {
      digest: vi.fn(async () => DIGEST_BYTES.buffer.slice(0))
    }
  } as unknown as Crypto)
}

afterEach(() => {
  resetUploadedAssets()
  setAssetServerUrl(null)
  setAssetUploader(null)
  vi.unstubAllGlobals()
})

describe('mcp/assets', () => {
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
