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

    const optionsRes = await fetch(`${baseUrl}/assets/abcdef12.png`, { method: 'OPTIONS' })
    expect(optionsRes.status).toBe(204)
    expect(optionsRes.headers.get('access-control-allow-origin')).toBe('*')

    const notFoundRes = await fetch(`${baseUrl}/unknown`)
    expect(notFoundRes.status).toBe(404)

    const invalidMethodRes = await fetch(`${baseUrl}/assets/abcdef12.png`, { method: 'PUT' })
    expect(invalidMethodRes.status).toBe(405)

    server.stop()
    expect(() => server.getBaseUrl()).toThrow('Asset HTTP server is not running.')
  })

  it('serves downloads, handles missing records, and prunes missing files', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    store.get.mockReturnValueOnce(undefined)
    const missingRecordRes = await fetch(`${baseUrl}/assets/abcdef12.png`)
    expect(missingRecordRes.status).toBe(404)

    store.get.mockReturnValueOnce({
      hash: 'abcdef12',
      filePath: '/no/such/file.png',
      mimeType: 'image/png',
      size: 0,
      uploadedAt: 1,
      lastAccess: 1
    })
    const missingFileRes = await fetch(`${baseUrl}/assets/abcdef12.png`)
    expect(missingFileRes.status).toBe(404)
    expect(store.remove).toHaveBeenCalledWith('abcdef12', { removeFile: false })

    const existingPath = join(ASSET_DIR, 'abcdef12.png')
    trackFile(existingPath, 'hello')
    store.get.mockReturnValueOnce({
      hash: 'abcdef12',
      filePath: existingPath,
      mimeType: 'text/plain',
      size: 5,
      uploadedAt: 1,
      lastAccess: 1
    })
    const okRes = await fetch(`${baseUrl}/assets/abcdef12.png`)
    expect(okRes.status).toBe(200)
    expect(await okRes.text()).toBe('hello')
    expect(store.touch).toHaveBeenCalledWith('abcdef12')

    server.stop()
  })

  it('handles upload for existing assets and updates metadata', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    const existingPath = join(ASSET_DIR, 'abcdef12.png')
    trackFile(existingPath, 'already-there')
    store.get.mockReturnValueOnce({
      hash: 'abcdef12',
      filePath: existingPath,
      mimeType: 'application/octet-stream',
      size: 12,
      uploadedAt: 100,
      lastAccess: 100
    })

    const res = await fetch(`${baseUrl}/assets/abcdef12.png`, {
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
        hash: 'abcdef12',
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

    const legacyPath = join(ASSET_DIR, 'abcdef12')
    const expectedPath = join(ASSET_DIR, 'abcdef12.png')
    trackFile(legacyPath, 'legacy')
    store.get.mockReturnValueOnce({
      hash: 'abcdef12',
      filePath: legacyPath,
      mimeType: 'application/octet-stream',
      size: 6,
      uploadedAt: 100,
      lastAccess: 100
    })

    const res = await fetch(`${baseUrl}/assets/abcdef12.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: 'ignored'
    })
    expect(res.status).toBe(200)
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: 'abcdef12',
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

    const mismatchRes = await fetch(`${baseUrl}/assets/aaaaaaaa.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: 'payload'
    })
    expect(mismatchRes.status).toBe(400)
    expect((await mismatchRes.json()) as { error: string }).toEqual({ error: 'Hash Mismatch' })

    const body = Buffer.from('new-image-bytes')
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
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
    const server = createAssetHttpServer(store)
    await server.start()
    const baseUrl = server.getBaseUrl()

    store.get.mockReturnValue(undefined)
    const oversizedBody = Buffer.alloc(8 * 1024 * 1024 + 1, 1)
    const res = await fetch(`${baseUrl}/assets/abcdef12.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: oversizedBody
    })

    expect(res.status).toBe(413)
    expect((await res.json()) as { error: string }).toEqual({ error: 'Payload Too Large' })
    server.stop()
  })
})
