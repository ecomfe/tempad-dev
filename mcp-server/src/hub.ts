import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { nanoid } from 'nanoid'
import { existsSync, rmSync, chmodSync } from 'node:fs'
import { createServer } from 'node:net'
import { WebSocketServer } from 'ws'

import { register, resolve, reject, cleanupForExtension, cleanupAll } from './request'
import { log, RUNTIME_DIR, SOCK_PATH, ensureDir } from './shared'
import { TOOLS } from './tools'
import {
  MessageFromExtensionSchema,
  RegisteredMessage,
  StateMessage,
  ToolCallMessage,
  ToolResultMessage
} from './protocol'

import type { RawData } from 'ws'
import type { ExtensionConnection } from './types'

function parsePositiveInt(env: string | undefined, fallback: number): number {
  const parsed = env ? Number.parseInt(env, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const WS_PORT_CANDIDATES = [6220, 7431, 8127]
const TOOL_CALL_TIMEOUT = parsePositiveInt(process.env.TEMPAD_MCP_TOOL_TIMEOUT, 15000)
const MAX_PAYLOAD_SIZE = 4 * 1024 * 1024
const SHUTDOWN_TIMEOUT = 2000
const AUTO_ACTIVATE_GRACE_MS = parsePositiveInt(process.env.TEMPAD_MCP_AUTO_ACTIVATE_GRACE, 1500)

const extensions: ExtensionConnection[] = []
let consumerCount = 0
let autoActivateTimer: NodeJS.Timeout | null = null
let selectedWsPort = 0

const mcp = new McpServer({ name: 'tempad-dev-mcp', version: '0.1.0' })

for (const tool of TOOLS) {
  const schema = tool.parameters
  type InputSchema = Parameters<typeof mcp.registerTool>[1]['inputSchema']

  mcp.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: schema as unknown as InputSchema
    },
    async (args: unknown) => {
      const parsedArgs = schema.parse(args)
      const activeExt = extensions.find((e) => e.active)
      if (!activeExt) throw new Error('No active TemPad Dev extension available.')

      const { promise, requestId } = register<unknown>(activeExt.id, TOOL_CALL_TIMEOUT)

      const message: ToolCallMessage = {
        type: 'toolCall',
        id: requestId,
        payload: {
          name: tool.name,
          args: parsedArgs
        }
      }
      activeExt.ws.send(JSON.stringify(message))
      log.info({ tool: tool.name, req: requestId, extId: activeExt.id }, 'Forwarded tool call.')

      const unknownPayload = await promise
      const textContent =
        typeof unknownPayload === 'string'
          ? unknownPayload
          : JSON.stringify(unknownPayload, null, 2)

      return { content: [{ type: 'text' as const, text: textContent }] }
    }
  )
}
log.info({ tools: TOOLS.map((t) => t.name) }, 'Registered tools.')

function getActiveId(): string | null {
  return extensions.find((e) => e.active)?.id ?? null
}

function setActive(targetId: string | null): void {
  extensions.forEach((e) => {
    e.active = targetId !== null && e.id === targetId
  })
}

function clearAutoActivateTimer(): void {
  if (autoActivateTimer) {
    clearTimeout(autoActivateTimer)
    autoActivateTimer = null
  }
}

function scheduleAutoActivate(): void {
  clearAutoActivateTimer()

  if (extensions.length !== 1 || getActiveId()) {
    return
  }

  const target = extensions[0]
  autoActivateTimer = setTimeout(() => {
    autoActivateTimer = null
    if (extensions.length === 1 && !getActiveId()) {
      setActive(target.id)
      log.info({ id: target.id }, 'Auto-activated sole extension after grace period.')
      broadcastState()
    }
  }, AUTO_ACTIVATE_GRACE_MS)
}

function broadcastState(): void {
  const activeId = getActiveId()
  const message: StateMessage = {
    type: 'state',
    activeId,
    count: extensions.length,
    port: selectedWsPort
  }
  extensions.forEach((ext) => ext.ws.send(JSON.stringify(message)))
  log.debug({ activeId, count: extensions.length }, 'Broadcasted state.')
}

function shutdown(): void {
  log.info('Hub is shutting down...')
  netServer.close(() => log.info('Net server closed.'))
  wss?.close(() => log.info('WebSocket server closed.'))
  cleanupAll()
  const timer = setTimeout(() => {
    log.warn('Shutdown timed out. Forcing exit.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT)
  timer.unref()
}

try {
  ensureDir(RUNTIME_DIR)
  if (process.platform !== 'win32' && existsSync(SOCK_PATH)) {
    log.warn({ sock: SOCK_PATH }, 'Removing stale socket file.')
    rmSync(SOCK_PATH)
  }
} catch (error: unknown) {
  log.error({ err: error }, 'Failed to initialize runtime environment.')
  process.exit(1)
}

const netServer = createServer((sock) => {
  consumerCount++
  log.info(`Consumer connected. Total: ${consumerCount}`)
  const transport = new StdioServerTransport(sock, sock)
  mcp.connect(transport).catch((err) => {
    log.error({ err }, 'Failed to attach MCP transport.')
    transport.close().catch((closeErr) => log.warn({ err: closeErr }, 'Transport close failed.'))
    sock.destroy()
  })
  sock.on('error', (err) => {
    log.warn({ err }, 'Consumer socket error.')
    transport.close().catch((closeErr) => log.warn({ err: closeErr }, 'Transport close failed.'))
  })
  sock.on('close', async () => {
    await transport.close()
    consumerCount--
    log.info(`Consumer disconnected. Remaining: ${consumerCount}`)
    if (consumerCount === 0) {
      log.info('Last consumer disconnected. Shutting down.')
      shutdown()
    }
  })
})
netServer.on('error', (err) => {
  log.error({ err }, 'Net server error.')
  process.exit(1)
})
netServer.listen(SOCK_PATH, () => {
  try {
    if (process.platform !== 'win32') chmodSync(SOCK_PATH, 0o600)
  } catch (err) {
    log.error({ err }, 'Failed to set socket permissions. Shutting down.')
    process.exit(1)
  }
  log.info({ sock: SOCK_PATH }, 'Hub socket ready.')
})

async function startWebSocketServer(): Promise<{ wss: WebSocketServer; port: number }> {
  for (const candidate of WS_PORT_CANDIDATES) {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: candidate,
      maxPayload: MAX_PAYLOAD_SIZE
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off('listening', onListening)
          reject(err)
        }
        const onListening = () => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
      })
      return { wss: server, port: candidate }
    } catch (err) {
      server.close()
      const errno = err as NodeJS.ErrnoException
      if (errno.code === 'EADDRINUSE') {
        log.warn({ port: candidate }, 'WebSocket port in use, trying next candidate.')
        continue
      }
      log.error({ err: errno, port: candidate }, 'Failed to start WebSocket server.')
      process.exit(1)
    }
  }

  log.error(
    { candidates: WS_PORT_CANDIDATES },
    'Unable to start WebSocket server on any candidate port.'
  )
  process.exit(1)
}

const { wss, port } = await startWebSocketServer()
selectedWsPort = port

// Add an error handler to prevent crashes from port conflicts, etc.
wss.on('error', (err) => {
  log.error({ err }, 'WebSocket server critical error. Exiting.')
  process.exit(1)
})

wss.on('connection', (ws) => {
  const ext: ExtensionConnection = { id: nanoid(), ws, active: false }
  extensions.push(ext)
  log.info({ id: ext.id }, `Extension connected. Total: ${extensions.length}`)

  const message: RegisteredMessage = { type: 'registered', id: ext.id }
  ws.send(JSON.stringify(message))
  broadcastState()
  scheduleAutoActivate()

  ws.on('message', (raw: RawData) => {
    let messageBuffer: Buffer
    if (Buffer.isBuffer(raw)) {
      messageBuffer = raw
    } else if (raw instanceof ArrayBuffer) {
      messageBuffer = Buffer.from(raw)
    } else {
      messageBuffer = Buffer.concat(raw)
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(messageBuffer.toString('utf-8'))
    } catch (e: unknown) {
      log.warn({ err: e, extId: ext.id }, 'Failed to parse message.')
      return
    }

    const parseResult = MessageFromExtensionSchema.safeParse(parsedJson)
    if (!parseResult.success) {
      log.warn({ error: parseResult.error.flatten(), extId: ext.id }, 'Invalid message shape.')
      return
    }
    const msg = parseResult.data

    switch (msg.type) {
      case 'activate': {
        setActive(ext.id)
        log.info({ id: ext.id }, 'Extension activated.')
        broadcastState()
        scheduleAutoActivate()
        break
      }
      case 'toolResult': {
        const { id, payload, error } = msg as ToolResultMessage
        if (error) {
          reject(id, error instanceof Error ? error : new Error(String(error)))
        } else {
          resolve(id, payload)
        }
        break
      }
    }
  })

  ws.on('close', () => {
    const index = extensions.findIndex((e) => e.id === ext.id)
    if (index > -1) extensions.splice(index, 1)

    log.info({ id: ext.id }, `Extension disconnected. Remaining: ${extensions.length}`)
    cleanupForExtension(ext.id)

    if (ext.active) {
      log.warn({ id: ext.id }, 'Active extension disconnected.')
      setActive(null)
    }

    broadcastState()
    scheduleAutoActivate()
  })
})

log.info({ port: selectedWsPort }, 'WebSocket server ready.')

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
