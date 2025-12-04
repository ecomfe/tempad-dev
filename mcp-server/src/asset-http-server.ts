import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

import type { AssetStore } from './asset-store'

import { log } from './shared'

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
    const record = store.get(hash)
    if (!record) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    res.writeHead(200, {
      'Content-Type': record.mime,
      'Content-Length': record.size.toString(),
      'Cache-Control': 'no-store'
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

  return {
    start,
    stop,
    getBaseUrl
  }
}
