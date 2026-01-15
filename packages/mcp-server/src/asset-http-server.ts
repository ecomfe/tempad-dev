import { MCP_HASH_HEX_LENGTH, MCP_HASH_PATTERN } from '@tempad-dev/mcp-shared'
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
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pipeline, Transform } from 'node:stream'
import { URL } from 'node:url'

import type { AssetStore } from './asset-store'

import { buildAssetFilename, getHashFromAssetFilename, normalizeMimeType } from './asset-utils'
import { getMcpServerConfig } from './config'
import { ASSET_DIR, log } from './shared'

const LOOPBACK_HOST = '127.0.0.1'
const { maxAssetSizeBytes } = getMcpServerConfig()

export interface AssetHttpServer {
  start(): Promise<void>
  stop(): void
  getBaseUrl(): string
}

export function createAssetHttpServer(store: AssetStore): AssetHttpServer {
  const server = createServer(handleRequest)
  let port: number | null = null

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
    return `http://${LOOPBACK_HOST}:${port}`
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const startedAt = Date.now()
    res.on('finish', () => {
      log.info(
        {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          durationMs: Date.now() - startedAt
        },
        'HTTP asset request completed.'
      )
    })

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Asset-Width, X-Asset-Height')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (!req.url) {
      sendError(res, 400, 'Missing URL')
      return
    }

    const url = new URL(req.url, getBaseUrl())
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2 || segments[0] !== 'assets') {
      sendError(res, 404, 'Not Found')
      return
    }

    const filename = segments[1]
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

    res.writeHead(200, {
      'Content-Type': record.mimeType,
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable'
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
    if (!MCP_HASH_PATTERN.test(hash)) {
      sendError(res, 400, 'Invalid Hash Format')
      return
    }

    const contentTypeHeader = req.headers['content-type']
    const mimeType = normalizeMimeType(
      Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    )
    const filename = buildAssetFilename(hash, mimeType)
    const filePath = join(ASSET_DIR, filename)

    const width = parseInt(req.headers['x-asset-width'] as string, 10)
    const height = parseInt(req.headers['x-asset-height'] as string, 10)
    const metadata =
      !isNaN(width) && !isNaN(height) && width > 0 && height > 0 ? { width, height } : undefined

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

        if (metadata) existing.metadata = metadata
        if (existing.mimeType !== mimeType) existing.mimeType = mimeType
        existing.lastAccess = Date.now()
        store.upsert(existing)
        sendOk(res, 200, 'Asset Already Exists')
        return
      }
    }

    const tmpPath = `${filePath}.tmp.${nanoid()}`
    const writeStream = createWriteStream(tmpPath)
    const hasher = createHash('sha256')
    let size = 0

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
        metadata
      })
      log.info({ hash, size }, 'Stored uploaded asset via HTTP.')
      sendOk(res, 201, 'Created', { hash, size })
    })
  }

  function sendError(
    res: ServerResponse,
    status: number,
    message: string,
    details?: Record<string, unknown>
  ): void {
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    }
    res.end(
      JSON.stringify({
        error: message,
        ...details
      })
    )
  }

  function sendOk(
    res: ServerResponse,
    status: number,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    }
    res.end(
      JSON.stringify({
        message,
        ...data
      })
    )
  }

  return {
    start,
    stop,
    getBaseUrl
  }
}
