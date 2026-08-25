import { createHash } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssetStore } from '../src/asset-store'

import { createAssetHttpServer } from '../src/asset-http-server'
import { ASSET_DIR } from '../src/shared'

type StoreMock = {
  [K in keyof AssetStore]: ReturnType<typeof vi.fn>
}

function createStoreMock(): AssetStore & StoreMock {
  return {
    list: vi.fn(() => []),
    has: vi.fn(() => false),
    get: vi.fn(),
    getMany: vi.fn(() => []),
    upsert: vi.fn(),
    touch: vi.fn(),
    remove: vi.fn(),
    reconcile: vi.fn(),
    flush: vi.fn()
  } as unknown as AssetStore & StoreMock
}

const createdPaths: string[] = []
const ASSET_HASH = 'a'.repeat(64)
const ASSET_FILENAME = `${ASSET_HASH}.png`
const LEGACY_ASSET_HASH = 'b'.repeat(8)

function assetUrl(baseUrl: string): string {
  return `${baseUrl}/assets/${ASSET_FILENAME}`
}

function trackFile(path: string, content: string | Buffer = ''): void {
  writeFileSync(path, content)
  createdPaths.push(path)
}

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { force: true })
  }
})

describe('asset-http-server', () => {
  it('starts/stops and handles routing errors', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)

    expect(() => server.getBaseUrl()).toThrow('Asset HTTP server is not running.')

    await server.start()
    await server.start()
    const baseUrl = server.getBaseUrl()

    const extensionOrigin = 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
    const optionsRes = await fetch(assetUrl(baseUrl), {
      method: 'OPTIONS',
      headers: { Origin: extensionOrigin }
    })
    expect(optionsRes.status).toBe(204)
    expect(optionsRes.headers.get('access-control-allow-origin')).toBe(extensionOrigin)

    const unauthenticatedUrl = assetUrl(new URL(baseUrl).origin)
    expect((await fetch(unauthenticatedUrl)).status).toBe(404)
    expect(
      (
        await fetch(unauthenticatedUrl, {
          method: 'OPTIONS',
          headers: { Origin: extensionOrigin }
        })
      ).status
    ).toBe(404)
    expect(
      (
        await fetch(assetUrl(baseUrl), {
          headers: { Origin: 'https://evil.example' }
        })
      ).status
    ).toBe(403)

    const notFoundRes = await fetch(`${baseUrl}/unknown`)
    expect(notFoundRes.status).toBe(404)

    const invalidMethodRes = await fetch(assetUrl(baseUrl), { method: 'PUT' })
    expect(invalidMethodRes.status).toBe(405)

    server.stop()
    expect(() => server.getBaseUrl()).toThrow('Asset HTTP server is not running.')
  })

  it('allows extension-origin asset requests only for the active extension', async () => {
    const store = createStoreMock()
    const activeOrigin = 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
    const server = createAssetHttpServer(store, {
      authorizeExtensionOrigin: (origin) => origin === activeOrigin
    })
    await server.start()
    const url = assetUrl(server.getBaseUrl())

    expect(
      (
        await fetch(url, {
          method: 'OPTIONS',
          headers: { Origin: activeOrigin }
        })
      ).status
    ).toBe(204)
    expect(
      (
        await fetch(url, {
          method: 'OPTIONS',
          headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
        })
      ).status
    ).toBe(403)

    server.stop()
  })

  it('serves downloads, handles missing records, and prunes missing files', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    store.get.mockReturnValueOnce(undefined)
    const missingRecordRes = await fetch(assetUrl(baseUrl))
    expect(missingRecordRes.status).toBe(404)

    store.get.mockReturnValueOnce({
      hash: ASSET_HASH,
      filePath: '/no/such/file.png',
      mimeType: 'image/png',
      size: 0,
      uploadedAt: 1,
      lastAccess: 1
    })
    const missingFileRes = await fetch(assetUrl(baseUrl))
    expect(missingFileRes.status).toBe(404)
    expect(store.remove).toHaveBeenCalledWith(ASSET_HASH, { removeFile: false })

    const existingPath = join(ASSET_DIR, ASSET_FILENAME)
    trackFile(existingPath, 'hello')
    store.get.mockReturnValueOnce({
      hash: ASSET_HASH,
      filePath: existingPath,
      mimeType: 'text/plain',
      size: 5,
      uploadedAt: 1,
      lastAccess: 1
    })
    const okRes = await fetch(assetUrl(baseUrl))
    expect(okRes.status).toBe(200)
    expect(await okRes.text()).toBe('hello')
    expect(store.touch).toHaveBeenCalledWith(ASSET_HASH)

    const legacyPath = join(ASSET_DIR, `${LEGACY_ASSET_HASH}.png`)
    trackFile(legacyPath, 'legacy')
    store.get.mockReturnValueOnce({
      hash: LEGACY_ASSET_HASH,
      filePath: legacyPath,
      mimeType: 'text/plain',
      size: 6,
      uploadedAt: 1,
      lastAccess: 1
    })
    const legacyUrl = `${baseUrl}/assets/${LEGACY_ASSET_HASH}.png`
    const legacyRes = await fetch(legacyUrl)
    expect(legacyRes.status).toBe(200)
    expect(await legacyRes.text()).toBe('legacy')
    expect(store.touch).toHaveBeenCalledWith(LEGACY_ASSET_HASH)
    const legacyUploadRes = await fetch(legacyUrl, { method: 'POST', body: 'legacy' })
    expect(legacyUploadRes.status).toBe(400)

    server.stop()
  })

  it('handles upload for existing assets and updates metadata', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    const existingPath = join(ASSET_DIR, ASSET_FILENAME)
    trackFile(existingPath, 'already-there')
    store.get.mockReturnValueOnce({
      hash: ASSET_HASH,
      filePath: existingPath,
      mimeType: 'application/octet-stream',
      size: 12,
      uploadedAt: 100,
      lastAccess: 100
    })

    const res = await fetch(assetUrl(baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'image/png',
        'x-asset-width': '320',
        'x-asset-height': '240'
      },
      body: 'ignored'
    })
    const payload = (await res.json()) as { message: string }

    expect(res.status).toBe(200)
    expect(payload.message).toBe('Asset Already Exists')
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: ASSET_HASH,
        filePath: existingPath,
        mimeType: 'image/png',
        metadata: { width: 320, height: 240 }
      })
    )

    server.stop()
  })

  it('renames existing asset path to extension-aware target when needed', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    const legacyPath = join(ASSET_DIR, ASSET_HASH)
    const expectedPath = join(ASSET_DIR, ASSET_FILENAME)
    trackFile(legacyPath, 'legacy')
    store.get.mockReturnValueOnce({
      hash: ASSET_HASH,
      filePath: legacyPath,
      mimeType: 'application/octet-stream',
      size: 6,
      uploadedAt: 100,
      lastAccess: 100
    })

    const res = await fetch(assetUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: 'ignored'
    })
    expect(res.status).toBe(200)
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: ASSET_HASH,
        filePath: expectedPath,
        mimeType: 'image/png'
      })
    )

    createdPaths.push(expectedPath)
    server.stop()
  })

  it('returns hash mismatch and handles successful uploads', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    store.get.mockReturnValue(undefined)

    const mismatchRes = await fetch(assetUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: 'payload'
    })
    expect(mismatchRes.status).toBe(400)
    expect((await mismatchRes.json()) as { error: string }).toEqual({ error: 'Hash Mismatch' })

    const body = Buffer.from('new-image-bytes')
    const hash = createHash('sha256').update(body).digest('hex')
    const uploadRes = await fetch(`${baseUrl}/assets/${hash}.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body
    })

    expect(uploadRes.status).toBe(201)
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        hash,
        filePath: join(ASSET_DIR, `${hash}.png`),
        mimeType: 'image/png',
        size: body.length
      })
    )

    createdPaths.push(join(ASSET_DIR, `${hash}.png`))
    server.stop()
  })

  it('rejects payloads that exceed the maximum configured asset size', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store, { maxAssetSizeBytes: 8 })
    await server.start()
    const baseUrl = server.getBaseUrl()

    store.get.mockReturnValue(undefined)
    const oversizedBody = Buffer.alloc(9, 1)
    const res = await fetch(assetUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: oversizedBody
    })

    expect(res.status).toBe(413)
    expect((await res.json()) as { error: string }).toEqual({ error: 'Payload Too Large' })
    server.stop()
  })

  it('rejects uploads that would exceed the aggregate asset quota', async () => {
    const store = createStoreMock()
    store.list.mockReturnValue([
      {
        hash: '1111111111111111111111111111111111111111111111111111111111111111',
        filePath: '/tmp/existing',
        mimeType: 'image/png',
        size: 5,
        uploadedAt: 1,
        lastAccess: 1
      }
    ])
    const server = createAssetHttpServer(store, { maxAssetStoreBytes: 8 })
    await server.start()

    const body = Buffer.from('four')
    const hash = createHash('sha256').update(body).digest('hex')
    const res = await fetch(`${server.getBaseUrl()}/assets/${hash}.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body
    })

    expect(res.status).toBe(507)
    expect((await res.json()) as { error: string }).toEqual({
      error: 'Asset Store Quota Exceeded'
    })
    expect(store.upsert).not.toHaveBeenCalled()
    server.stop()
  })
})
