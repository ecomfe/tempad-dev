import type { IncomingMessage } from 'node:http'

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssetStore } from '../src/asset-store'

type MockState = {
  address: { port: number } | string
  listenError?: Error
  pipelineError?: Error & { code?: string }
  digest: string
  readMode: 'normal' | 'error-before' | 'error-after'
  exists: Map<string, boolean>
  statError?: Error & { code?: string }
  statSize: number
  renameError?: Error
  unlinkError?: Error
  requestHandler?: (req: IncomingMessage, res: unknown) => void
}

const state = vi.hoisted<MockState>(() => ({
  address: { port: 19001 },
  digest: 'abcdef12feedbeef',
  readMode: 'normal',
  exists: new Map(),
  statSize: 16
}))

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
  existsSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  pipeline: vi.fn(),
  createHash: vi.fn(),
  getHashFromAssetFilename: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'n1'
}))

vi.mock('node:http', () => ({
  createServer: mocks.createServer
}))

vi.mock('node:fs', () => ({
  createReadStream: mocks.createReadStream,
  createWriteStream: mocks.createWriteStream,
  existsSync: mocks.existsSync,
  renameSync: mocks.renameSync,
  statSync: mocks.statSync,
  unlinkSync: mocks.unlinkSync
}))

vi.mock('node:stream', async () => {
  const actual = await vi.importActual<typeof import('node:stream')>('node:stream')
  return {
    ...actual,
    Transform: actual.Transform,
    pipeline: mocks.pipeline
  }
})

vi.mock('node:crypto', () => ({
  createHash: mocks.createHash
}))

vi.mock('../src/config', () => ({
  getMcpServerConfig: () => ({ maxAssetSizeBytes: 8 * 1024 * 1024 })
}))

vi.mock('../src/shared', () => ({
  ASSET_DIR: '/tmp/mock-assets',
  log: mocks.log
}))

vi.mock('../src/asset-utils', () => ({
  buildAssetFilename: (hash: string) => `${hash}.png`,
  normalizeMimeType: (value?: string) => (value || 'application/octet-stream').split(';', 1)[0],
  getHashFromAssetFilename: mocks.getHashFromAssetFilename
}))

import { createAssetHttpServer } from '../src/asset-http-server'

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

function createRequest(input: {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
}) {
  return {
    method: 'GET',
    url: '/assets/abcdef12.png',
    headers: {},
    resume: vi.fn(),
    ...input
  } as IncomingMessage & { resume: ReturnType<typeof vi.fn> }
}

function createResponse(input?: { headersSent?: boolean; keepHeadersSentOnWriteHead?: boolean }) {
  const finishCallbacks: Array<() => void> = []
  const res = {
    statusCode: 200,
    headersSent: input?.headersSent ?? false,
    headers: {} as Record<string, string>,
    body: '',
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'finish') finishCallbacks.push(cb)
      return res
    }),
    setHeader: vi.fn((key: string, value: string) => {
      res.headers[key] = value
    }),
    writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
      res.statusCode = status
      if (!input?.keepHeadersSentOnWriteHead) {
        res.headersSent = true
      }
      if (headers) Object.assign(res.headers, headers)
    }),
    end: vi.fn((body?: string) => {
      if (body) res.body = body
      finishCallbacks.forEach((cb) => cb())
    })
  }
  return res
}

function readJson(res: ReturnType<typeof createResponse>) {
  return JSON.parse(res.body) as Record<string, unknown>
}

beforeEach(() => {
  state.address = { port: 19001 }
  state.listenError = undefined
  state.pipelineError = undefined
  state.digest = 'abcdef12feedbeef'
  state.readMode = 'normal'
  state.exists.clear()
  state.statError = undefined
  state.statSize = 16
  state.renameError = undefined
  state.unlinkError = undefined
  state.requestHandler = undefined

  vi.clearAllMocks()

  mocks.createServer.mockImplementation((handler: (req: IncomingMessage, res: unknown) => void) => {
    state.requestHandler = handler
    const emitter = new EventEmitter()
    const server = {
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        emitter.once(event, cb)
        return server
      }),
      off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        emitter.off(event, cb)
        return server
      }),
      listen: vi.fn(() => {
        if (state.listenError) emitter.emit('error', state.listenError)
        else emitter.emit('listening')
      }),
      close: vi.fn(),
      address: vi.fn(() => state.address)
    }
    return server
  })

  mocks.createReadStream.mockImplementation(() => {
    const stream = new EventEmitter() as EventEmitter & { pipe: (target: unknown) => void }
    stream.pipe = (target: unknown) => {
      if (state.readMode === 'error-before') {
        stream.emit('error', new Error('stream failed'))
        return
      }
      if (state.readMode === 'error-after') {
        ;(target as { headersSent: boolean }).headersSent = true
        stream.emit('error', new Error('stream failed'))
        return
      }
      stream.emit('open')
    }
    return stream
  })

  mocks.createWriteStream.mockImplementation(() => ({}))
  mocks.existsSync.mockImplementation((filePath: string) => state.exists.get(filePath) ?? false)
  mocks.renameSync.mockImplementation(() => {
    if (state.renameError) throw state.renameError
  })
  mocks.statSync.mockImplementation(() => {
    if (state.statError) throw state.statError
    return { size: state.statSize }
  })
  mocks.unlinkSync.mockImplementation(() => {
    if (state.unlinkError) throw state.unlinkError
  })

  mocks.pipeline.mockImplementation(
    (_req: unknown, _monitor: unknown, _writeStream: unknown, done: (err?: Error) => void) => {
      done(state.pipelineError)
    }
  )

  mocks.createHash.mockImplementation(() => ({
    update: vi.fn(),
    digest: vi.fn(() => state.digest)
  }))

  mocks.getHashFromAssetFilename.mockImplementation((filename: string) => {
    const match = /^([a-f0-9]{8})(?:\.[a-z0-9]+)?$/i.exec(filename)
    return match ? match[1] : null
  })
})

afterEach(() => {
  state.requestHandler = undefined
})

describe('asset-http-server unit branches', () => {
  it('treats stop as a no-op before start', () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    expect(() => server.stop()).not.toThrow()
  })

  it('rejects start when listen fails or address is not an object', async () => {
    const store = createStoreMock()

    state.listenError = new Error('listen failed')
    await expect(createAssetHttpServer(store).start()).rejects.toThrow('listen failed')

    state.listenError = undefined
    state.address = 'pipe://mock'
    await expect(createAssetHttpServer(store).start()).rejects.toThrow(
      'Failed to determine HTTP server port.'
    )
  })

  it('handles routing guards for missing URL and non-asset paths', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()

    const missingUrlRes = createResponse()
    state.requestHandler?.(createRequest({ url: undefined }), missingUrlRes)
    expect(missingUrlRes.statusCode).toBe(400)
    expect(readJson(missingUrlRes)).toEqual({ error: 'Missing URL' })

    const badPathRes = createResponse()
    state.requestHandler?.(createRequest({ url: '/x/y' }), badPathRes)
    expect(badPathRes.statusCode).toBe(404)
    expect(readJson(badPathRes)).toEqual({ error: 'Not Found' })

    const badHashRes = createResponse()
    state.requestHandler?.(createRequest({ url: '/assets/not-a-hash.png' }), badHashRes)
    expect(badHashRes.statusCode).toBe(404)
    expect(readJson(badHashRes)).toEqual({ error: 'Not Found' })
  })

  it('covers download stat failures and stream error handling branches', async () => {
    const store = createStoreMock()
    store.get.mockReturnValue({
      hash: 'abcdef12',
      filePath: '/tmp/mock-assets/abcdef12.png',
      mimeType: 'image/png',
      size: 10,
      uploadedAt: 1,
      lastAccess: 1
    })

    const server = createAssetHttpServer(store)
    await server.start()

    state.statError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const statErrorRes = createResponse()
    state.requestHandler?.(createRequest({ url: '/assets/abcdef12.png' }), statErrorRes)
    expect(statErrorRes.statusCode).toBe(500)
    expect(readJson(statErrorRes)).toEqual({ error: 'Internal Server Error' })

    state.statError = undefined
    state.readMode = 'error-before'
    const notSentRes = createResponse({ keepHeadersSentOnWriteHead: true })
    state.requestHandler?.(createRequest({ url: '/assets/abcdef12.png' }), notSentRes)
    expect(notSentRes.statusCode).toBe(500)
    expect(readJson(notSentRes)).toEqual({ error: 'Internal Server Error' })

    state.readMode = 'error-after'
    const sentRes = createResponse()
    state.requestHandler?.(createRequest({ url: '/assets/abcdef12.png' }), sentRes)
    expect(sentRes.statusCode).toBe(200)
    expect(sentRes.end).toHaveBeenCalled()
  })

  it('covers existing upload paths including rename warnings and headers-sent responses', async () => {
    const store = createStoreMock()
    const existing = {
      hash: 'abcdef12',
      filePath: '/tmp/mock-assets/legacy.bin',
      mimeType: 'application/octet-stream',
      size: 10,
      uploadedAt: 1,
      lastAccess: 1
    }
    store.get.mockReturnValue(existing)

    const server = createAssetHttpServer(store)
    await server.start()

    state.exists.set('/tmp/mock-assets/legacy.bin', false)
    state.exists.set('/tmp/mock-assets/abcdef12.png', true)
    const fallbackPathReq = createRequest({
      method: 'POST',
      url: '/assets/abcdef12.png',
      headers: {
        'content-type': ['image/png'],
        'x-asset-width': '320',
        'x-asset-height': '240'
      }
    })
    const fallbackPathRes = createResponse()
    state.requestHandler?.(fallbackPathReq, fallbackPathRes)
    expect(fallbackPathReq.resume).toHaveBeenCalled()
    expect(fallbackPathRes.statusCode).toBe(200)
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/mock-assets/abcdef12.png',
        mimeType: 'image/png',
        metadata: { width: 320, height: 240 }
      })
    )

    existing.filePath = '/tmp/mock-assets/legacy-noext'
    state.exists.set('/tmp/mock-assets/legacy-noext', true)
    state.exists.set('/tmp/mock-assets/abcdef12.png', false)
    state.renameError = new Error('rename failed')
    const renameWarnRes = createResponse({ headersSent: true })
    state.requestHandler?.(
      createRequest({
        method: 'POST',
        url: '/assets/abcdef12.png',
        headers: { 'content-type': 'image/png' }
      }),
      renameWarnRes
    )
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error), hash: 'abcdef12' }),
      'Failed to rename existing asset to include extension.'
    )
    expect(renameWarnRes.writeHead).not.toHaveBeenCalled()
  })

  it('falls back to upload pipeline when existing record paths are both missing', async () => {
    const store = createStoreMock()
    store.get.mockReturnValue({
      hash: 'abcdef12',
      filePath: '/tmp/mock-assets/missing-legacy',
      mimeType: 'application/octet-stream',
      size: 1,
      uploadedAt: 1,
      lastAccess: 1
    })
    state.exists.set('/tmp/mock-assets/missing-legacy', false)
    state.exists.set('/tmp/mock-assets/abcdef12.png', false)
    state.pipelineError = new Error('boom')

    const server = createAssetHttpServer(store)
    await server.start()

    const res = createResponse()
    state.requestHandler?.(
      createRequest({
        method: 'POST',
        url: '/assets/abcdef12.png',
        headers: { 'content-type': 'image/png' }
      }),
      res
    )
    expect(mocks.createWriteStream).toHaveBeenCalled()
    expect(res.statusCode).toBe(500)
  })

  it('covers upload pipeline errors and rename failure after successful hashing', async () => {
    const store = createStoreMock()
    store.get.mockReturnValue(undefined)
    const server = createAssetHttpServer(store)
    await server.start()

    state.pipelineError = new Error('PayloadTooLarge')
    state.exists.set('/tmp/mock-assets/abcdef12.png.tmp.n1', true)
    state.unlinkError = new Error('unlink failed')
    const tooLargeRes = createResponse()
    state.requestHandler?.(
      createRequest({
        method: 'POST',
        url: '/assets/abcdef12.png',
        headers: { 'content-type': '' }
      }),
      tooLargeRes
    )
    expect(tooLargeRes.statusCode).toBe(413)
    expect(readJson(tooLargeRes)).toEqual({ error: 'Payload Too Large' })

    state.pipelineError = Object.assign(new Error('closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })
    state.unlinkError = undefined
    const prematureRes = createResponse()
    state.requestHandler?.(
      createRequest({ method: 'POST', url: '/assets/abcdef12.png' }),
      prematureRes
    )
    expect(prematureRes.statusCode).toBe(400)
    expect(readJson(prematureRes)).toEqual({ error: 'Upload Incomplete' })

    state.pipelineError = new Error('boom')
    const genericRes = createResponse()
    state.requestHandler?.(
      createRequest({ method: 'POST', url: '/assets/abcdef12.png' }),
      genericRes
    )
    expect(genericRes.statusCode).toBe(500)
    expect(readJson(genericRes)).toEqual({ error: 'Internal Server Error' })

    const genericSentRes = createResponse({ headersSent: true })
    state.requestHandler?.(
      createRequest({
        method: 'POST',
        url: '/assets/abcdef12.png',
        headers: { 'content-type': 'image/png' }
      }),
      genericSentRes
    )
    expect(genericSentRes.writeHead).not.toHaveBeenCalled()

    state.pipelineError = undefined
    state.digest = 'abcdef12cafebabe'
    state.renameError = new Error('rename temp failed')
    const renameRes = createResponse()
    state.requestHandler?.(
      createRequest({ method: 'POST', url: '/assets/abcdef12.png' }),
      renameRes
    )
    expect(renameRes.statusCode).toBe(500)
    expect(readJson(renameRes)).toEqual({ error: 'Internal Server Error' })
  })

  it('sends JSON error without rewriting headers when response is already committed', async () => {
    const store = createStoreMock()
    const server = createAssetHttpServer(store)
    await server.start()

    const res = createResponse({ headersSent: true })
    state.requestHandler?.(createRequest({ url: undefined }), res)
    expect(res.writeHead).not.toHaveBeenCalled()
    expect(readJson(res)).toEqual({ error: 'Missing URL' })
  })
})
