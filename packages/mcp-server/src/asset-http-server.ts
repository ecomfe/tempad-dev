import type { IncomingMessage, ServerResponse } from 'node:http'

import { MCP_HASH_HEX_LENGTH } from '@tempad-dev/shared'
import { nanoid } from 'nanoid'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pipeline, Transform } from 'node:stream'
import { URL } from 'node:url'

import type { AssetStore } from './asset-store'
import type { AssetRecord } from './types'

import { buildAssetFilename, getHashFromAssetFilename, normalizeMimeType } from './asset-utils'
import { getMcpServerConfig } from './config'
import {
  createCapabilityToken,
  createExtensionOriginPolicy,
  isAllowedExtensionOrigin,
  secretsEqual
} from './security'
import { ASSET_DIR, log } from './shared'

const LOOPBACK_HOST = '127.0.0.1'
const HASH_HEX_PATTERN = new RegExp(`^[a-f0-9]{${MCP_HASH_HEX_LENGTH}}$`, 'i')
const ASSET_REQUEST_TIMEOUT_MS = 15_000
const ASSET_HEADERS_TIMEOUT_MS = 5_000
const ASSET_KEEP_ALIVE_TIMEOUT_MS = 5_000
const ASSET_MAX_HEADERS = 32
const ASSET_MAX_CONNECTIONS = 128
const ASSET_MAX_CONCURRENT_DOWNLOADS = 128

export interface AssetHttpServerOptions {
  accessToken?: string
  maxAssetSizeBytes?: number
  maxAssetStoreBytes?: number
  maxConcurrentUploads?: number
  authorizeExtensionOrigin?: (origin: string) => boolean
}

export interface AssetHttpServer {
  start(): Promise<void>
  stop(): void
  getBaseUrl(): string
}

export function createAssetHttpServer(
  store: AssetStore,
  options: AssetHttpServerOptions = {}
): AssetHttpServer {
  const config = getMcpServerConfig()
  const accessToken = options.accessToken ?? createCapabilityToken()
  const maxAssetSizeBytes = options.maxAssetSizeBytes ?? config.maxAssetSizeBytes
  const maxAssetStoreBytes = options.maxAssetStoreBytes ?? config.maxAssetStoreBytes
  const maxConcurrentUploads = options.maxConcurrentUploads ?? config.maxConcurrentAssetUploads
  const originPolicy = createExtensionOriginPolicy(config.allowedExtensionOrigins)
  const server = createServer(handleRequest)
  server.requestTimeout = ASSET_REQUEST_TIMEOUT_MS
  server.headersTimeout = ASSET_HEADERS_TIMEOUT_MS
  server.keepAliveTimeout = ASSET_KEEP_ALIVE_TIMEOUT_MS
  server.maxHeadersCount = ASSET_MAX_HEADERS
  server.maxConnections = ASSET_MAX_CONNECTIONS
  let port: number | null = null
  let activeDownloads = 0
  let activeUploads = 0
  let reservedUploadBytes = 0

  async function start(): Promise<void> {
    if (port !== null) return
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        const address = server.address()
        if (address && typeof address === 'object') {
          port = address.port
          resolve()
        } else {
          reject(new Error('Failed to determine HTTP server port.'))
        }
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, LOOPBACK_HOST)
    })
    log.info({ port }, 'Asset HTTP server ready.')
  }

  function stop(): void {
    if (port === null) return
    server.close()
    port = null
  }

  function getBaseUrl(): string {
    if (port === null) throw new Error('Asset HTTP server is not running.')
    return `http://${LOOPBACK_HOST}:${port}/${accessToken}`
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const startedAt = Date.now()
    res.on('finish', () => {
      log.info(
        {
          method: req.method,
          route: redactAssetRequestUrl(req.url),
          status: res.statusCode,
          durationMs: Date.now() - startedAt
        },
        'HTTP asset request completed.'
      )
    })

    if (!req.url) {
      sendError(res, 400, 'Missing URL')
      return
    }

    const url = new URL(req.url, getBaseUrl())
    const segments = url.pathname.split('/').filter(Boolean)
    if (
      segments.length !== 3 ||
      !secretsEqual(segments[0] ?? '', accessToken) ||
      segments[1] !== 'assets'
    ) {
      sendError(res, 404, 'Not Found')
      return
    }

    const origin = getHeader(req, 'origin')
    if (
      origin &&
      (!isAllowedExtensionOrigin(origin, originPolicy) ||
        (options.authorizeExtensionOrigin && !options.authorizeExtensionOrigin(origin)))
    ) {
      sendError(res, 403, 'Forbidden')
      return
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Asset-Width, X-Asset-Height, X-Asset-Themeable'
      )
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const filename = segments[2]
    const hash = getHashFromAssetFilename(filename)
    if (!hash) {
      sendError(res, 404, 'Not Found')
      return
    }

    if (req.method === 'POST') {
      handleUpload(req, res, hash)
      return
    }

    if (req.method === 'GET') {
      handleDownload(req, res, hash)
      return
    }

    sendError(res, 405, 'Method Not Allowed')
  }

  function handleDownload(req: IncomingMessage, res: ServerResponse, hash: string): void {
    const record = store.get(hash)
    if (!record) {
      sendError(res, 404, 'Asset Not Found')
      return
    }

    let stat
    try {
      stat = statSync(record.filePath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        store.remove(hash, { removeFile: false })
        sendError(res, 404, 'Asset Not Found')
      } else {
        log.error({ error, hash }, 'Failed to stat asset file.')
        sendError(res, 500, 'Internal Server Error')
      }
      return
    }

    if (activeDownloads >= ASSET_MAX_CONCURRENT_DOWNLOADS) {
      res.setHeader('Connection', 'close')
      sendError(res, 429, 'Too Many Concurrent Downloads')
      return
    }

    activeDownloads += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      activeDownloads -= 1
    }
    res.once('finish', release)
    res.once('close', release)
    res.setTimeout(ASSET_REQUEST_TIMEOUT_MS, () => res.destroy())

    res.writeHead(200, {
      'Content-Type': record.mimeType,
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `attachment; filename="${buildAssetFilename(hash, record.mimeType)}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    })

    const stream = createReadStream(record.filePath)
    stream.on('error', (error) => {
      log.warn({ error, hash }, 'Failed to stream asset file.')
      if (!res.headersSent) {
        sendError(res, 500, 'Internal Server Error')
      } else {
        res.end()
      }
    })
    stream.on('open', () => {
      store.touch(hash)
    })
    stream.pipe(res)
  }

  function handleUpload(req: IncomingMessage, res: ServerResponse, hash: string): void {
    if (!HASH_HEX_PATTERN.test(hash)) {
      req.resume()
      sendError(res, 400, 'Invalid Hash')
      return
    }

    const declaredSize = parseContentLength(req)
    if (declaredSize === 'invalid') {
      req.resume()
      sendError(res, 400, 'Invalid Content-Length')
      return
    }
    if (declaredSize !== null && declaredSize > maxAssetSizeBytes) {
      req.resume()
      sendError(res, 413, 'Payload Too Large')
      return
    }

    const mimeType = normalizeMimeType(getHeader(req, 'content-type'))
    const filename = buildAssetFilename(hash, mimeType)
    const filePath = join(ASSET_DIR, filename)

    const width = parseInt(getHeader(req, 'x-asset-width') ?? '', 10)
    const height = parseInt(getHeader(req, 'x-asset-height') ?? '', 10)
    const themeable = getHeader(req, 'x-asset-themeable') === 'true'
    const metadata: NonNullable<AssetRecord['metadata']> = {}
    if (Number.isFinite(width) && width > 0) metadata.width = width
    if (Number.isFinite(height) && height > 0) metadata.height = height
    if (themeable) metadata.themeable = true
    const assetMetadata = Object.keys(metadata).length ? metadata : undefined

    const existing = store.get(hash)
    if (existing) {
      let existingPath = existing.filePath
      if (!existsSync(existingPath) && existsSync(filePath)) {
        existing.filePath = filePath
        existingPath = filePath
      }

      if (existsSync(existingPath)) {
        if (existingPath !== filePath) {
          try {
            renameSync(existingPath, filePath)
            existing.filePath = filePath
          } catch (error) {
            log.warn({ error, hash }, 'Failed to rename existing asset to include extension.')
          }
        }

        // Drain request to ensure connection is clean
        req.resume()

        if (assetMetadata) {
          existing.metadata = {
            ...existing.metadata,
            ...assetMetadata
          }
        }
        if (existing.mimeType !== mimeType) existing.mimeType = mimeType
        existing.lastAccess = Date.now()
        store.upsert(existing)
        sendJson(res, 200, { message: 'Asset Already Exists' })
        return
      }
    }

    if (activeUploads >= maxConcurrentUploads) {
      req.resume()
      res.setHeader('Connection', 'close')
      sendError(res, 429, 'Too Many Concurrent Uploads')
      return
    }

    const reservationBytes = declaredSize ?? maxAssetSizeBytes
    if (
      getStoredAssetBytes(store, hash) + reservedUploadBytes + reservationBytes >
      maxAssetStoreBytes
    ) {
      req.resume()
      sendError(res, 507, 'Asset Store Quota Exceeded')
      return
    }

    const tmpPath = `${filePath}.tmp.${nanoid()}`
    const writeStream = createWriteStream(tmpPath)
    const hasher = createHash('sha256')
    let size = 0
    activeUploads += 1
    reservedUploadBytes += reservationBytes

    const cleanup = () => {
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath)
        } catch (e) {
          log.warn({ error: e, tmpPath }, 'Failed to cleanup temp file.')
        }
      }
    }

    const monitor = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length
        if (size > maxAssetSizeBytes) {
          callback(new Error('PayloadTooLarge'))
          return
        }
        hasher.update(chunk)
        callback(null, chunk)
      }
    })

    pipeline(req, monitor, writeStream, (err) => {
      activeUploads -= 1
      reservedUploadBytes -= reservationBytes
      if (err) {
        cleanup()
        if (err.message === 'PayloadTooLarge') {
          sendError(res, 413, 'Payload Too Large')
        } else if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          log.warn({ hash }, 'Upload request closed prematurely.')
          sendError(res, 400, 'Upload Incomplete')
        } else {
          log.error({ error: err, hash }, 'Upload pipeline failed.')
          if (!res.headersSent) {
            sendError(res, 500, 'Internal Server Error')
          }
        }
        return
      }

      const computedHash = hasher.digest('hex').slice(0, MCP_HASH_HEX_LENGTH)
      if (computedHash !== hash) {
        cleanup()
        sendError(res, 400, 'Hash Mismatch')
        return
      }

      if (getStoredAssetBytes(store, hash) + reservedUploadBytes + size > maxAssetStoreBytes) {
        cleanup()
        sendError(res, 507, 'Asset Store Quota Exceeded')
        return
      }

      try {
        renameSync(tmpPath, filePath)
      } catch (error) {
        log.error({ error, hash }, 'Failed to rename temp file to asset.')
        cleanup()
        sendError(res, 500, 'Internal Server Error')
        return
      }

      store.upsert({
        hash,
        filePath,
        mimeType,
        size,
        metadata: assetMetadata
      })
      log.info({ hash, size }, 'Stored uploaded asset via HTTP.')
      sendJson(res, 201, { message: 'Created', hash, size })
    })
  }

  function redactAssetRequestUrl(requestUrl: string | undefined): string | undefined {
    if (!requestUrl) return requestUrl
    try {
      const url = new URL(requestUrl, `http://${LOOPBACK_HOST}`)
      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.length >= 1 && secretsEqual(segments[0] ?? '', accessToken)) {
        segments[0] = '<capability>'
      }
      return `/${segments.join('/')}`
    } catch {
      return '<invalid>'
    }
  }

  function sendError(
    res: ServerResponse,
    status: number,
    message: string,
    details?: Record<string, unknown>
  ): void {
    sendJson(res, status, { error: message, ...details })
  }

  function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    }
    res.end(JSON.stringify(payload))
  }

  return {
    start,
    stop,
    getBaseUrl
  }
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function parseContentLength(req: IncomingMessage): number | null | 'invalid' {
  const value = getHeader(req, 'content-length')
  if (value === undefined) return null
  if (!/^\d+$/.test(value)) return 'invalid'
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 'invalid'
}

function getStoredAssetBytes(store: AssetStore, excludeHash?: string): number {
  return store.list().reduce((total, record) => {
    if (record.hash === excludeHash) return total
    return Number.isFinite(record.size) && record.size > 0 ? total + record.size : total
  }, 0)
}
