import {
  MCP_ASSET_URI_PREFIX,
  MCP_HASH_HEX_LENGTH,
  TEMPAD_MCP_ERROR_CODES
} from '@tempad-dev/shared'
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
  buildAssetResourceUri,
  ensureAssetUploaded,
  resetUploadedAssets,
  setAssetServerUrl
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
  vi.unstubAllGlobals()
})

describe('mcp/assets', () => {
  it('builds resource URIs using the MCP asset prefix', () => {
    expect(buildAssetResourceUri('deadbeef')).toBe(`${MCP_ASSET_URI_PREFIX}deadbeef`)
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
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(ensureAssetUploaded(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toMatchObject(
      {
        code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
        message: expect.stringContaining('Asset server URL is not configured')
      }
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads assets once and reuses completed uploads from cache', async () => {
    mockCryptoDigest()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK'
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    setAssetServerUrl('http://assets.local')

    const bytes = new Uint8Array([10, 20, 30, 40])

    const first = await ensureAssetUploaded(bytes, 'image/png', { width: 300, height: 200 })
    const second = await ensureAssetUploaded(bytes, 'image/png', { width: 300, height: 200 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`http://assets.local/assets/${EXPECTED_HASH}`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'image/png',
      'X-Asset-Width': '300',
      'X-Asset-Height': '200'
    })
    expect(init.body).toBeInstanceOf(Blob)

    expect(first).toEqual({
      hash: EXPECTED_HASH,
      mimeType: 'image/png',
      size: bytes.byteLength,
      resourceUri: `${MCP_ASSET_URI_PREFIX}${EXPECTED_HASH}`,
      url: `http://assets.local/assets/${EXPECTED_HASH}`,
      width: 300,
      height: 200
    })
    expect(second).toEqual(first)
  })

  it('deduplicates in-flight uploads for identical server/hash pairs', async () => {
    mockCryptoDigest()
    let resolveResponse!: (value: { ok: boolean; status: number; statusText: string }) => void
    const pending = new Promise<{ ok: boolean; status: number; statusText: string }>((resolve) => {
      resolveResponse = resolve as (value: {
        ok: boolean
        status: number
        statusText: string
      }) => void
    })
    const fetchMock = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    setAssetServerUrl('http://assets.local')

    // Subarray forces a copy path in toArrayBuffer.
    const bytes = new Uint8Array([0, 7, 8, 9]).subarray(1)
    const firstPromise = ensureAssetUploaded(bytes, 'image/svg+xml')
    const secondPromise = ensureAssetUploaded(bytes, 'image/svg+xml')

    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveResponse({ ok: true, status: 200, statusText: 'OK' })

    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first).toEqual(second)
  })

  it('throws when upload endpoint returns a non-ok status', async () => {
    mockCryptoDigest()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      statusText: 'Too Large'
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    setAssetServerUrl('http://assets.local')

    await expect(ensureAssetUploaded(new Uint8Array([9, 9, 9]), 'image/png')).rejects.toThrow(
      'Upload failed with status 413 Too Large'
    )
  })

  it('normalizes non-error upload failures into Error instances', async () => {
    mockCryptoDigest()
    const fetchMock = vi.fn().mockRejectedValue('network down')
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    setAssetServerUrl('http://assets.local')

    await expect(ensureAssetUploaded(new Uint8Array([5, 4, 3]), 'image/png')).rejects.toThrow(
      'Failed to upload asset via HTTP.'
    )
  })
})
