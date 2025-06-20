import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { nanoid } from 'nanoid'
import { existsSync, rmSync, chmodSync } from 'node:fs'
import { createServer } from 'node:net'
import { WebSocketServer, type RawData } from 'ws'
import { z } from 'zod'

import { register, resolve, reject, cleanupForExtension, cleanupAll } from './request'
import { log, RUNTIME_DIR, SOCK_PATH, ensureDir } from './shared'
import {
  MessageFromExtensionSchema,
  type ExtensionConnection,
  type ToolCallMessage,
  type RegisteredMessage,
  type ActiveChangedMessage
} from './types'

const WS_PORT = 6220
const ALLOWED_EXTENSION_IDS = ['abcd1234efgh5678', 'dev-extension-id-for-testing']
const TOOL_CALL_TIMEOUT = 15000
const MAX_PAYLOAD_SIZE = 4 * 1024 * 1024
const SHUTDOWN_TIMEOUT = 2000

const TOOLS = [
  {
    name: 'get_price',
    description: 'Returns the latest price of a stock.',
    parameters: z.object({ symbol: z.string().length(4, 'Stock symbol must be 4 characters.') })
  },
  {
    name: 'weather',
    description: 'Returns the current weather for a city.',
    parameters: z.object({ city: z.string().min(1, 'City name cannot be empty.') })
  }
] as const

const extensions: ExtensionConnection[] = []
let consumerCount = 0

const mcp = new McpServer({ name: 'tempad-dev-mcp', version: '0.1.0', capabilities: { tools: {} } })

for (const tool of TOOLS) {
  mcp.registerTool(tool.name, tool.parameters, async (args: any) => {
    const activeExt = extensions.find((e) => e.active)
    if (!activeExt) throw new Error('No active TemPad extension available.')

    const { promise, requestId } = register<unknown>(activeExt.id, TOOL_CALL_TIMEOUT)

    const message: ToolCallMessage = { type: 'toolCall', req: requestId, name: tool.name, args }
    activeExt.ws.send(JSON.stringify(message))
    log.info({ tool: tool.name, req: requestId, extId: activeExt.id }, 'Forwarded tool call.')

    const unknownPayload = await promise
    const textContent =
      typeof unknownPayload === 'string' ? unknownPayload : JSON.stringify(unknownPayload, null, 2)

    return { content: [{ type: 'text', text: textContent }] }
  })
}
log.info({ tools: TOOLS.map((t) => t.name) }, 'Registered tools.')

function broadcastActiveState(): void {
  const activeId = extensions.find((e) => e.active)?.id ?? null
  const message: ActiveChangedMessage = { type: 'activeChanged', activeId }
  extensions.forEach((ext) => ext.ws.send(JSON.stringify(message)))
  log.debug({ activeId }, 'Broadcasted active state change.')
}

function shutdown(): void {
  log.info('Hub is shutting down...')
  netServer.close(() => log.info('Net server closed.'))
  wss.close(() => log.info('WebSocket server closed.'))
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
  mcp.connect(new StdioServerTransport(sock))
  sock.on('close', () => {
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

const wss = new WebSocketServer({
  port: WS_PORT,
  maxPayload: MAX_PAYLOAD_SIZE,
  verifyClient: (info, cb) => {
    const origin = info.origin || ''
    if (!origin) {
      log.warn('Rejected WebSocket connection with empty origin.')
      cb(false, 403, 'Forbidden')
      return
    }
    const match = origin.match(/^chrome-extension:\/\/([^/]+)/)
    const extensionId = match ? match[1] : ''
    if (ALLOWED_EXTENSION_IDS.includes(extensionId)) {
      cb(true)
    } else {
      log.warn({ origin, extensionId }, 'Rejected untrusted WebSocket connection.')
      cb(false, 403, 'Forbidden')
    }
  }
})

wss.on('connection', (ws) => {
  const ext: ExtensionConnection = { id: nanoid(), ws, active: false }
  extensions.push(ext)
  log.info({ id: ext.id }, `Extension connected. Total: ${extensions.length}`)

  const message: RegisteredMessage = { type: 'registered', id: ext.id }
  ws.send(JSON.stringify(message))
  broadcastActiveState()

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
        extensions.forEach((e) => (e.active = e.id === ext.id))
        log.info({ id: ext.id }, 'Extension activated.')
        broadcastActiveState()
        break
      }
      case 'toolResult': {
        const { req, ok, payload } = msg
        if (ok) {
          resolve(req, payload)
        } else {
          reject(req, new Error(String(payload ?? 'Error from extension.')))
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
      broadcastActiveState()
    }
  })
})

log.info({ port: WS_PORT }, 'WebSocket server ready.')

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
