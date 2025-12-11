import { MCP_HASH_PATTERN } from '@tempad-dev/mcp-shared'
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
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Asset-Width, X-Asset-Height')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (!req.url) {
      res.writeHead(400)
      res.end('Missing URL')
      return
    }

    const url = new URL(req.url, getBaseUrl())
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2 || segments[0] !== 'assets') {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const hash = segments[1]

    if (req.method === 'POST') {
      handleUpload(req, res, hash)
      return
    }

    if (req.method === 'GET') {
      handleDownload(req, res, hash)
      return
    }

    res.writeHead(405)
    res.end('Method Not Allowed')
  }

  function handleDownload(req: IncomingMessage, res: ServerResponse, hash: string): void {
    const record = store.get(hash)
    if (!record) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    let stat
    try {
      stat = statSync(record.filePath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        store.remove(hash, { removeFile: false })
        res.writeHead(404)
        res.end('Not Found')
      } else {
        log.error({ error, hash }, 'Failed to stat asset file.')
        res.writeHead(500)
        res.end('Internal Server Error')
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
        res.writeHead(500)
      }
      res.end('Internal Server Error')
    })
    stream.on('open', () => {
      store.touch(hash)
    })
    stream.pipe(res)
  }

  function handleUpload(req: IncomingMessage, res: ServerResponse, hash: string): void {
    if (!MCP_HASH_PATTERN.test(hash)) {
      res.writeHead(400)
      res.end('Invalid Hash Format')
      return
    }

    const mimeType = req.headers['content-type'] || 'application/octet-stream'
    const filePath = join(ASSET_DIR, hash)

    const width = parseInt(req.headers['x-asset-width'] as string, 10)
    const height = parseInt(req.headers['x-asset-height'] as string, 10)
    const metadata =
      !isNaN(width) && !isNaN(height) && width > 0 && height > 0 ? { width, height } : undefined

    // If asset already exists and file is present, skip write
    if (store.has(hash) && existsSync(filePath)) {
      // Drain request to ensure connection is clean
      req.resume()

      const existing = store.get(hash)!
      let changed = false
      if (metadata) {
        existing.metadata = metadata
        changed = true
      }
      if (existing.mimeType !== mimeType) {
        existing.mimeType = mimeType
        changed = true
      }
      if (changed) {
        store.upsert(existing)
      }
      store.touch(hash)
      res.writeHead(200)
      res.end('OK')
      return
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
          res.writeHead(413)
          res.end('Payload Too Large')
        } else if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          log.warn({ hash }, 'Upload request closed prematurely.')
        } else {
          log.error({ error: err, hash }, 'Upload pipeline failed.')
          if (!res.headersSent) {
            res.writeHead(500)
            res.end('Internal Server Error')
          }
        }
        return
      }

      const computedHash = hasher.digest('hex')
      if (computedHash !== hash) {
        cleanup()
        res.writeHead(400)
        res.end('Hash Mismatch')
        return
      }

      try {
        renameSync(tmpPath, filePath)
      } catch (error) {
        log.error({ error, hash }, 'Failed to rename temp file to asset.')
        cleanup()
        res.writeHead(500)
        res.end('Internal Server Error')
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
      res.writeHead(201)
      res.end('Created')
    })
  }

  return {
    start,
    stop,
    getBaseUrl
  }
}
