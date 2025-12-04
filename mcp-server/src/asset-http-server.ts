import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { URL } from 'node:url'

import type { AssetStore } from './asset-store'

import { ASSET_DIR, log } from './shared'

const LOOPBACK_HOST = '127.0.0.1'

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

    // Check if file actually exists on disk
    if (!existsSync(record.filePath)) {
      store.remove(hash, { removeFile: false })
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    res.writeHead(200, {
      'Content-Type': record.mime,
      'Content-Length': record.size.toString(),
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
    const mimeType = req.headers['content-type'] || 'application/octet-stream'
    const filePath = join(ASSET_DIR, hash)

    // If asset already exists and file is present, skip write
    if (store.has(hash) && existsSync(filePath)) {
      store.touch(hash)
      res.writeHead(200)
      res.end('OK')
      return
    }

    const writeStream = createWriteStream(filePath)
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
    })

    req.pipe(writeStream)

    writeStream.on('error', (error) => {
      log.error({ error, hash }, 'Failed to write uploaded asset.')
      res.writeHead(500)
      res.end('Internal Server Error')
    })

    writeStream.on('finish', () => {
      store.upsert({
        hash,
        filePath,
        mime: mimeType,
        size
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
