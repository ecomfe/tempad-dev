import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssetStore } from '../src/asset-store'

import { createAssetHttpServer } from '../src/asset-http-server'
import { buildAssetFilename } from '../src/asset-utils'
import { ASSET_DIR } from '../src/shared'

type StoreMock = {
  [K in keyof AssetStore]: ReturnType<typeof vi.fn>
}

function createStoreMock(): AssetStore & StoreMock {
  return {
    list: vi.fn(() => []),
    has: vi.fn(() => false),
    get: vi.fn(),
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
  it('reuses the exact port and both capabilities, and refuses a conflicting listener', async () => {
    const store = createStoreMock()
    const options = { accessToken: 'a'.repeat(64), legacyAccessToken: 'b'.repeat(64) }
    const first = createAssetHttpServer(store, options)
    await first.start()
    const base = first.getBaseUrl()
    const legacy = first.getBaseUrl(true)
    const port = Number(new URL(base).port)
    const conflict = createAssetHttpServer(store, { ...options, port })
    await expect(conflict.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    first.stop()
    const second = createAssetHttpServer(store, { ...options, port })
    await second.start()
    try {
      expect(second.getBaseUrl()).toBe(base)
      expect(second.getBaseUrl(true)).toBe(legacy)
      expect((await fetch(assetUrl(base))).status).toBe(404)
      expect(
        (await fetch(assetUrl(base), { headers: { Origin: 'https://other.invalid' } })).status
      ).toBe(403)
    } finally {
      second.stop()
    }
  })

  it('fences new transfers during recovery without affecting authentication or admitted uploads', async () => {
    const store = createStoreMock()
    let admit = true
    const body = Buffer.from('admitted asset')
    const hash = createHash('sha256').update(body).digest('hex')
    const filename = `${hash}.png`
    const server = createAssetHttpServer(store, { admit: () => admit })
    await server.start()
    createdPaths.push(join(ASSET_DIR, filename))
    const url = `${server.getBaseUrl()}/assets/${filename}`
    const upload = request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Length': body.length }
    })
    const uploaded = new Promise<number | undefined>((resolve, reject) => {
      upload.once('error', reject)
      upload.once('response', (response) => {
        response.resume()
        resolve(response.statusCode)
      })
    })
    void uploaded.catch(() => {})
    try {
      expect(server.pendingTransfers).toBe(0)
      upload.write(body.subarray(0, 1))
      await vi.waitFor(() => expect(server.pendingTransfers).toBe(1))
      store.get.mockClear()
      admit = false
      expect((await fetch(url)).status).toBe(503)
      expect(
        (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body }))
          .status
      ).toBe(503)
      expect(store.get).not.toHaveBeenCalled()
      upload.end(body.subarray(1))
      expect(await uploaded).toBe(201)
      await vi.waitFor(() => expect(server.pendingTransfers).toBe(0))
      admit = true
      expect((await fetch(url)).status).toBe(404)
      expect(store.get).toHaveBeenCalledWith(hash)
    } finally {
      upload.destroy()
      server.stop()
    }
  })

  it('uploads and downloads an image subtype with a hyphen through its generated filename', async () => {
    const store = createStoreMock()
    const records = new Map<string, ReturnType<AssetStore['get']>>()
    store.get.mockImplementation((hash) => records.get(hash))
    store.upsert.mockImplementation((record) => records.set(record.hash, record))
    const body = Buffer.from('icon bytes')
    const hash = createHash('sha256').update(body).digest('hex')
    const filename = buildAssetFilename(hash, 'image/x-icon')
    const activity = vi.fn()
    const server = createAssetHttpServer(store, { onActivity: activity })
    await server.start()
    const url = `${server.getBaseUrl()}/assets/${filename}`
    createdPaths.push(join(ASSET_DIR, filename))
    try {
      const uploaded = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'image/x-icon' },
        body
      })
      expect(uploaded.status).toBe(201)
      await vi.waitFor(() => expect(activity).toHaveBeenCalledTimes(2))
      const downloaded = await fetch(url)
      expect(downloaded.status).toBe(200)
      expect(downloaded.headers.get('content-type')).toBe('image/x-icon')
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(body)
      await vi.waitFor(() => expect(activity).toHaveBeenCalledTimes(4))
    } finally {
      server.stop()
    }
  })

  it('accepts short hashes only on the legacy capability and refuses full-content collisions', async () => {
    const store = createStoreMock()
    const records = new Map<string, ReturnType<AssetStore['get']>>()
    store.get.mockImplementation((hash) => records.get(hash))
    store.upsert.mockImplementation((record) => records.set(record.hash, record))
    const server = createAssetHttpServer(store)
    await server.start()
    const hash = '55acb7b6'
    const body = 'legacy-collision-59924'
    const collidingBody = 'legacy-collision-69327'
    const url = `${server.getBaseUrl(true)}/assets/${hash}`
    createdPaths.push(join(ASSET_DIR, `${hash}.png`))
    const upload = (text: string, target = url) =>
      fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: text
      })
    try {
      expect(server.getBaseUrl(true)).not.toBe(server.getBaseUrl())
      expect((await upload(body, `${server.getBaseUrl()}/assets/${hash}`)).status).toBe(400)
      expect((await upload('wrong digest')).status).toBe(400)
      expect((await upload(body)).status).toBe(201)
      expect((await upload(body)).status).toBe(200)
      expect((await upload(collidingBody)).status).toBe(409)
      expect((await upload('wrong digest')).status).toBe(400)
      expect(await (await fetch(url)).text()).toBe(body)
      expect(readFileSync(join(ASSET_DIR, `${hash}.png`), 'utf8')).toBe(body)
    } finally {
      server.stop()
    }
  })
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

  it('preserves returned local paths when repeated uploads change MIME metadata', async () => {
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
        filePath: legacyPath,
        mimeType: 'image/png'
      })
    )

    createdPaths.push(expectedPath)
    server.stop()
  })

  it('preserves one asset path when concurrent uploads finish with different MIME types', async () => {
    const store = createStoreMock()
    const records = new Map<string, ReturnType<AssetStore['get']>>()
    store.get.mockImplementation((hash) => records.get(hash))
    store.upsert.mockImplementation((record) => records.set(record.hash, record))
    const body = Buffer.from('concurrent image bytes')
    const hash = createHash('sha256').update(body).digest('hex')
    const firstPath = join(ASSET_DIR, `${hash}.png`)
    createdPaths.push(firstPath, join(ASSET_DIR, `${hash}.jpg`))
    const server = createAssetHttpServer(store)
    await server.start()
    const upload = (mimeType: string) => {
      const uploading = request(`${server.getBaseUrl()}/assets/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': mimeType, 'Content-Length': body.length }
      })
      const completed = new Promise<number | undefined>((resolve, reject) => {
        uploading.on('error', reject)
        uploading.on('response', (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        })
      })
      uploading.flushHeaders()
      return { uploading, completed }
    }
    const first = upload('image/png')
    const second = upload('image/jpeg')
    try {
      // Both bodies reserve a new upload before either asset exists.
      await vi.waitFor(() => expect(store.get).toHaveBeenCalledTimes(2))
      first.uploading.end(body)
      expect(await first.completed).toBe(201)
      second.uploading.end(body)
      expect.soft(await second.completed).toBe(200)
      expect.soft(records.get(hash)?.filePath).toBe(firstPath)
      expect.soft(records.get(hash)?.mimeType).toBe('image/jpeg')
      expect(readdirSync(ASSET_DIR).filter((name) => name.startsWith(hash))).toEqual([
        `${hash}.png`
      ])
      expect(readFileSync(firstPath)).toEqual(body)
    } finally {
      first.uploading.destroy()
      second.uploading.destroy()
      await Promise.allSettled([first.completed, second.completed])
      server.stop()
    }
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
