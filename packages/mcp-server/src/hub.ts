import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  AssetDescriptor,
  GetAssetsParametersInput,
  GetAssetsResult,
  StateMessage,
  ToolCallMessage,
  ToolName,
  ToolResultMap
} from '@tempad-dev/shared'
import type { ZodType } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  GetAssetsResultSchema,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  TEMPAD_MCP_ERROR_CODES,
  measureCallToolResultBytes,
  type TempadMcpErrorCode
} from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, chmodSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import lockfile from 'proper-lockfile'
import { WebSocketServer } from 'ws'

import type { AssetRecord } from './types'

import { createAssetHttpServer } from './asset-http-server'
import { createAssetStore } from './asset-store'
import { buildAssetFilename } from './asset-utils'
import { getMcpServerConfig } from './config'
import { ExtensionRegistry } from './extension-registry'
import { attachExtensionSocket } from './extension-socket'
import MCP_INSTRUCTIONS from './instructions.md?raw'
import { register, resolve, reject, cleanupForExtension, cleanupAll } from './request'
import { createExtensionOriginPolicy } from './security'
import {
  HUB_BUSY_EXIT_CODE,
  HUB_LOCK_PATH,
  HUB_LOCK_STALE_MS,
  HUB_LOCK_UPDATE_MS,
  PACKAGE_VERSION,
  log,
  RUNTIME_DIR,
  SOCK_PATH,
  ensureDir
} from './shared'
import {
  TOOL_DEFS,
  coercePayloadToToolResponse,
  createAssetsToolResponse,
  createInlineBudgetExceededToolResponse,
  createToolErrorResponse
} from './tools'
import { startExtensionWebSocketServer } from './websocket-server'

const SHUTDOWN_TIMEOUT = 2000
const SOCKET_PROBE_TIMEOUT_MS = 300
const {
  wsPortCandidates,
  toolTimeoutMs,
  maxPayloadBytes,
  maxExtensionConnections,
  autoActivateGraceMs,
  assetTtlMs,
  allowedExtensionOrigins
} = getMcpServerConfig()
const extensionOriginPolicy = createExtensionOriginPolicy(allowedExtensionOrigins)

log.info({ version: PACKAGE_VERSION }, 'TemPad MCP Hub starting...')

const extensionRegistry = new ExtensionRegistry(autoActivateGraceMs)
let consumerCount = 0
type TimeoutHandle = ReturnType<typeof setTimeout>
let selectedWsPort = 0
let releaseHubLock: (() => Promise<void>) | null = null
let shuttingDown = false
let wss: WebSocketServer | null = null
const consumerSessions = new Set<McpServer>()
type RegisterToolOptions = Parameters<McpServer['registerTool']>[1]
type McpInputSchema = RegisterToolOptions['inputSchema']
type McpOutputSchema = RegisterToolOptions['outputSchema']
type ToolResponse = CallToolResult
type SchemaOutput<Schema extends ZodType> = Schema['_output']
type ToolMetadataEntry = (typeof TOOL_DEFS)[number]
type ExtensionToolMetadata = Extract<ToolMetadataEntry, { target: 'extension' }>
type HubToolMetadata = Extract<ToolMetadataEntry, { target: 'hub' }>

type HubToolWithHandler<T extends HubToolMetadata = HubToolMetadata> = T & {
  handler: (args: SchemaOutput<T['parameters']>) => Promise<ToolResponse>
}

function getRecordProperty(record: unknown, key: string): unknown {
  if (!record || typeof record !== 'object') {
    return undefined
  }
  return Reflect.get(record, key)
}

type SocketProbeResult = 'live' | 'missing' | { staleCode: string }

function classifySocketProbeError(error: NodeJS.ErrnoException): SocketProbeResult | null {
  if (error.code === 'ENOENT') return 'missing'
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTSOCK') {
    return { staleCode: error.code }
  }
  return null
}

function probeHubSocket(): Promise<SocketProbeResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let socket: ReturnType<typeof connect> | null = null

    function finish(callback: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (socket) {
        socket.removeAllListeners()
        socket.destroy()
      }
      callback()
    }

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`Timed out probing Hub socket after ${SOCKET_PROBE_TIMEOUT_MS}ms.`))
      )
    }, SOCKET_PROBE_TIMEOUT_MS)
    function fail(error: NodeJS.ErrnoException): void {
      const result = classifySocketProbeError(error)
      finish(() => (result ? resolve(result) : reject(error)))
    }

    try {
      socket = connect(SOCK_PATH)
      socket.once('connect', () => finish(() => resolve('live')))
      socket.once('error', fail)
    } catch (error) {
      fail(error as NodeJS.ErrnoException)
    }
  })
}

async function acquireHubLock(): Promise<() => Promise<void>> {
  try {
    return await lockfile.lock(HUB_LOCK_PATH, {
      retries: 0,
      stale: HUB_LOCK_STALE_MS,
      update: HUB_LOCK_UPDATE_MS,
      onCompromised: (err) => {
        log.error({ err }, 'Hub lifecycle lock was compromised. Exiting.')
        process.exit(1)
      }
    })
  } catch (error) {
    log.info({ err: error }, 'Another Hub owns the lifecycle lock. Exiting.')
    process.exit(HUB_BUSY_EXIT_CODE)
  }
}

async function releaseHubLockIfNeeded(): Promise<void> {
  if (!releaseHubLock) return
  const release = releaseHubLock
  releaseHubLock = null
  try {
    await release()
  } catch (err) {
    log.warn({ err }, 'Failed to release Hub lifecycle lock.')
  }
}

async function probeSocketPath(): Promise<SocketProbeResult> {
  return process.platform === 'win32' || existsSync(SOCK_PATH) ? await probeHubSocket() : 'missing'
}

async function exitExistingHub(): Promise<never> {
  await releaseHubLockIfNeeded()
  log.info({ sock: SOCK_PATH }, 'Existing Hub is reachable. Exiting.')
  process.exit(HUB_BUSY_EXIT_CODE)
}

async function cleanSocketPath(): Promise<void> {
  const probe = await probeSocketPath()

  if (probe === 'live') {
    return await exitExistingHub()
  }
  if (probe === 'missing' || process.platform === 'win32') {
    return
  }
  log.warn({ sock: SOCK_PATH, code: probe.staleCode }, 'Removing stale socket file.')
  rmSync(SOCK_PATH)
}

type RegisteredToolDefinition = ExtensionToolMetadata | HubToolWithHandler

function enrichToolDefinition(tool: ToolMetadataEntry): RegisteredToolDefinition {
  if (tool.target === 'extension') {
    return tool
  }

  switch (tool.name) {
    case 'get_assets':
      return {
        ...tool,
        handler: handleGetAssets
      } satisfies HubToolWithHandler
    default:
      throw new Error('No handler configured for hub tool.')
  }
}

const TOOL_DEFINITIONS: ReadonlyArray<RegisteredToolDefinition> = TOOL_DEFS.map((tool) =>
  enrichToolDefinition(tool)
)

type RegisteredTool = (typeof TOOL_DEFINITIONS)[number]
type ExtensionTool = Extract<RegisteredTool, { target: 'extension' }>
type HubOnlyTool = Extract<RegisteredTool, { target: 'hub' }>

function createCodedError(code: TempadMcpErrorCode, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string }
  err.code = code
  return err
}

function coerceToolError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  const messageValue = getRecordProperty(error, 'message')
  const codeValue = getRecordProperty(error, 'code')
  if (error && typeof error === 'object') {
    const message = typeof messageValue === 'string' ? messageValue : safeStringify(error)
    const err = new Error(message) as Error & { code?: string }
    if (typeof codeValue === 'string') err.code = codeValue
    return err
  }
  return new Error(String(error))
}

function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function hasFormatter(tool: RegisteredToolDefinition): tool is ExtensionTool & {
  format: (payload: unknown) => ToolResponse
} {
  return tool.target === 'extension' && 'format' in tool
}

type ToolDefinitionByName = {
  [T in RegisteredToolDefinition as T['name']]: T
}

const TOOL_BY_NAME: ToolDefinitionByName = Object.fromEntries(
  TOOL_DEFINITIONS.map((tool) => [tool.name, tool] as const)
) as ToolDefinitionByName

function getToolDefinition<Name extends ToolName>(name: Name): ToolDefinitionByName[Name] {
  return TOOL_BY_NAME[name]
}

const assetStore = createAssetStore()
const assetHttpServer = createAssetHttpServer(assetStore, {
  authorizeExtensionOrigin: (origin) =>
    extensionRegistry.getActive()?.origin === origin.toLowerCase()
})

function scheduleAssetCleanup(): void {
  if (assetTtlMs <= 0) {
    log.info('Asset TTL cleanup disabled (TEMPAD_MCP_ASSET_TTL_MS=0).')
    return
  }
  pruneExpiredAssets(assetTtlMs)
  const intervalMs = Math.min(assetTtlMs, 24 * 60 * 60 * 1000)
  const timer = setInterval(() => {
    pruneExpiredAssets(assetTtlMs)
  }, intervalMs)
  unrefTimer(timer)
  log.info({ ttlMs: assetTtlMs, intervalMs }, 'Asset TTL cleanup enabled.')
}

function pruneExpiredAssets(ttlMs: number): void {
  const now = Date.now()
  let removed = 0
  let checked = 0
  for (const record of assetStore.list()) {
    checked += 1
    const lastAccess = Number.isFinite(record.lastAccess) ? record.lastAccess : record.uploadedAt
    if (!lastAccess) continue
    if (now - lastAccess > ttlMs) {
      assetStore.remove(record.hash)
      removed += 1
    }
  }
  log.info({ checked, removed, ttlMs }, 'Asset TTL sweep completed.')
}

function buildAssetDescriptor(record: AssetRecord): AssetDescriptor {
  const filename = buildAssetFilename(record.hash, record.mimeType)
  return {
    hash: record.hash,
    url: `${assetHttpServer.getBaseUrl()}/assets/${filename}`,
    mimeType: record.mimeType,
    size: record.size,
    width: record.metadata?.width,
    height: record.metadata?.height,
    ...(record.metadata?.themeable ? { themeable: true } : {})
  }
}

function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: 'tempad-dev', title: 'TemPad Dev', version: PACKAGE_VERSION },
    MCP_INSTRUCTIONS ? { instructions: MCP_INSTRUCTIONS } : undefined
  )

  const registered: string[] = []
  for (const tool of TOOL_DEFINITIONS) {
    if ('exposed' in tool && tool.exposed === false) continue
    registerTool(mcp, tool)
    registered.push(tool.name)
  }
  log.info({ tools: registered }, 'Registered tools.')

  return mcp
}

function registerTool(mcp: McpServer, tool: RegisteredTool): void {
  if (tool.target === 'extension') {
    registerProxiedTool(mcp, tool)
  } else {
    registerLocalTool(mcp, tool)
  }
}

function registerProxiedTool<T extends ExtensionTool>(mcp: McpServer, tool: T): void {
  type Name = T['name']
  type Result = ToolResultMap[Name]

  const registerToolFn = mcp.registerTool.bind(mcp) as (
    name: string,
    options: { description: string; inputSchema: ZodType; outputSchema?: ZodType },
    handler: (args: unknown) => Promise<CallToolResult>
  ) => unknown

  const schema = tool.parameters
  const handler = async (args: unknown) => {
    let requestId: string | undefined
    try {
      const parsedArgs = schema.parse(args)
      const activeExt = extensionRegistry.getActive()
      if (!activeExt) {
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
          'No active TemPad Dev extension available.'
        )
      }

      const registration = register<Result>(activeExt.id, toolTimeoutMs)
      requestId = registration.requestId

      const message: ToolCallMessage = {
        type: 'toolCall',
        id: registration.requestId,
        payload: {
          name: tool.name,
          args: parsedArgs
        }
      }
      activeExt.ws.send(JSON.stringify(message))
      log.info(
        { tool: tool.name, req: registration.requestId, extId: activeExt.id },
        'Forwarded tool call.'
      )

      const payload = await registration.promise
      return createToolResponse(tool.name, payload)
    } catch (error) {
      const normalized = coerceToolError(error)
      log.error(
        {
          tool: tool.name,
          req: requestId,
          code: getRecordProperty(normalized, 'code'),
          message: normalized.message
        },
        'Tool invocation failed.'
      )
      return createToolErrorResponse(tool.name, normalized)
    }
  }

  registerToolFn(
    tool.name,
    {
      description: tool.description,
      inputSchema: schema as unknown as McpInputSchema
    },
    handler
  )
}

function registerLocalTool(mcp: McpServer, tool: HubOnlyTool): void {
  const schema = tool.parameters
  const handler = tool.handler

  const registerToolFn = mcp.registerTool.bind(mcp) as (
    name: string,
    options: { description: string; inputSchema: ZodType; outputSchema?: ZodType },
    handler: (args: unknown) => Promise<CallToolResult>
  ) => unknown

  const registrationOptions: {
    description: string
    inputSchema: McpInputSchema
    outputSchema?: McpOutputSchema
  } = {
    description: tool.description,
    inputSchema: schema as unknown as McpInputSchema
  }

  if (tool.outputSchema) {
    registrationOptions.outputSchema = tool.outputSchema as unknown as McpOutputSchema
  }

  const registerHandler = async (args: unknown) => {
    try {
      const parsed = schema.parse(args)
      return await handler(parsed)
    } catch (error) {
      log.error({ tool: tool.name, error }, 'Local tool invocation failed.')
      return createToolErrorResponse(tool.name, error)
    }
  }

  registerToolFn(tool.name, registrationOptions, registerHandler)
}

function createToolResponse<Name extends ToolName>(
  toolName: Name,
  payload: ToolResultMap[Name]
): ToolResponse {
  const rawResult = (() => {
    const definition = getToolDefinition(toolName)
    if (definition && hasFormatter(definition)) {
      try {
        const formatter = definition.format as (input: ToolResultMap[Name]) => ToolResponse
        return formatter(payload)
      } catch (error) {
        log.warn({ tool: toolName, error }, 'Failed to format tool result; returning raw payload.')
        return coercePayloadToToolResponse(payload)
      }
    }

    return coercePayloadToToolResponse(payload)
  })()

  const resultBytes = measureCallToolResultBytes(rawResult)
  if (resultBytes > MCP_TOOL_INLINE_BUDGET_BYTES) {
    log.warn(
      { tool: toolName, resultBytes, inlineBudgetBytes: MCP_TOOL_INLINE_BUDGET_BYTES },
      'Tool result exceeded inline budget; returning compact error response.'
    )
    return createInlineBudgetExceededToolResponse(toolName, resultBytes)
  }

  return rawResult
}

async function handleGetAssets({ hashes }: GetAssetsParametersInput): Promise<ToolResponse> {
  if (hashes.length > 100) {
    throw new Error('Too many hashes requested. Limit is 100.')
  }
  const unique = Array.from(new Set(hashes))
  const records = assetStore.getMany(unique).filter((record) => {
    if (existsSync(record.filePath)) return true
    assetStore.remove(record.hash, { removeFile: false })
    return false
  })
  const found = new Set(records.map((record) => record.hash))
  const payload: GetAssetsResult = GetAssetsResultSchema.parse({
    assets: records.map((record) => buildAssetDescriptor(record)),
    missing: unique.filter((hash) => !found.has(hash))
  })

  return createAssetsToolResponse(payload)
}

function unrefTimer(timer: TimeoutHandle): void {
  if (typeof timer === 'object' && timer !== null) {
    const handle = timer as NodeJS.Timeout
    if (typeof handle.unref === 'function') {
      handle.unref()
    }
  }
}

function broadcastState(): void {
  const activeId = extensionRegistry.getActiveId()
  const message: StateMessage = {
    type: 'state',
    activeId,
    assetServerUrl: assetHttpServer.getBaseUrl()
  }
  extensionRegistry.list().forEach((ext) => ext.ws.send(JSON.stringify(message)))
  log.debug({ activeId, count: extensionRegistry.size }, 'Broadcasted state.')
}

function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  log.info('Hub is shutting down...')
  consumerSessions.forEach((session) => {
    session.close().catch((err) => {
      log.warn({ err }, 'Failed to close MCP session during shutdown.')
    })
  })
  consumerSessions.clear()
  assetStore.flush()
  extensionRegistry.dispose()
  assetHttpServer.stop()
  netServer.close(() => log.info('Net server closed.'))
  wss?.close(() => log.info('WebSocket server closed.'))
  cleanupAll()
  void releaseHubLockIfNeeded()
  const timer = setTimeout(() => {
    log.warn('Shutdown timed out. Forcing exit.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT)
  unrefTimer(timer)
}

const netServer = createServer((sock) => {
  const mcp = createMcpServer()
  consumerSessions.add(mcp)
  consumerCount++
  log.info(`Consumer connected. Total: ${consumerCount}`)
  const transport = new StdioServerTransport(sock, sock)
  mcp.connect(transport).catch((err) => {
    log.error({ err }, 'Failed to attach MCP transport.')
    consumerSessions.delete(mcp)
    mcp.close().catch((closeErr) => log.warn({ err: closeErr }, 'MCP session close failed.'))
    transport.close().catch((closeErr) => log.warn({ err: closeErr }, 'Transport close failed.'))
    sock.destroy()
  })
  sock.on('error', (err) => {
    log.warn({ err }, 'Consumer socket error.')
    transport.close().catch((closeErr) => log.warn({ err: closeErr }, 'Transport close failed.'))
  })
  sock.on('close', async () => {
    await transport
      .close()
      .catch((closeErr) => log.warn({ err: closeErr }, 'Transport close failed.'))
    await mcp.close().catch((closeErr) => log.warn({ err: closeErr }, 'MCP session close failed.'))
    consumerSessions.delete(mcp)
    consumerCount--
    log.info(`Consumer disconnected. Remaining: ${consumerCount}`)
    if (consumerCount === 0) {
      log.info('Last consumer disconnected. Shutting down.')
      shutdown()
    }
  })
})

async function initializeHubRuntime(): Promise<void> {
  ensureDir(RUNTIME_DIR)
  if ((await probeSocketPath()) === 'live') {
    await exitExistingHub()
  }
  releaseHubLock = await acquireHubLock()
  await cleanSocketPath()
  await assetHttpServer.start()
  scheduleAssetCleanup()
}

function listenConsumerSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      netServer.off('error', onError)
      netServer.off('listening', onListening)
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const onListening = () => {
      cleanup()
      try {
        if (process.platform !== 'win32') chmodSync(SOCK_PATH, 0o600)
      } catch (err) {
        netServer.close()
        reject(err)
        return
      }
      log.info({ sock: SOCK_PATH }, 'Hub socket ready.')
      resolve()
    }
    netServer.once('error', onError)
    netServer.once('listening', onListening)
    netServer.listen(SOCK_PATH)
  })
}

async function startWebSocketServer(): Promise<{ server: WebSocketServer; port: number }> {
  return startExtensionWebSocketServer({
    maxConnections: maxExtensionConnections,
    maxPayloadBytes,
    originPolicy: extensionOriginPolicy,
    portCandidates: wsPortCandidates,
    onPortInUse: (port) => {
      log.warn({ port }, 'WebSocket port in use, trying next candidate.')
    },
    onConnectionLimit: (limit) => {
      log.warn({ limit }, 'Rejected WebSocket handshake at the extension connection limit.')
    },
    onRejectedHandshake: (origin, path) => {
      log.warn(
        { origin: origin || '<missing>', path: path || '<missing>' },
        'Rejected unauthorized WebSocket handshake.'
      )
    }
  })
}

async function startHubRuntime(): Promise<WebSocketServer> {
  await initializeHubRuntime()
  await listenConsumerSocket()
  netServer.on('error', (err) => {
    log.error({ err }, 'Net server error.')
    process.exit(1)
  })
  const startedWebSocket = await startWebSocketServer()
  wss = startedWebSocket.server
  selectedWsPort = startedWebSocket.port
  return startedWebSocket.server
}

async function abortStartup(error: unknown): Promise<never> {
  log.error({ err: error }, 'Failed to initialize Hub runtime.')
  assetHttpServer.stop()
  await releaseHubLockIfNeeded()
  process.exit(1)
}

const activeWss = await startHubRuntime().catch(abortStartup)

// Add an error handler to prevent crashes from port conflicts, etc.
activeWss.on('error', (err) => {
  log.error({ err }, 'WebSocket server critical error. Exiting.')
  process.exit(1)
})

activeWss.on('connection', (ws, request) => {
  attachExtensionSocket(ws, {
    createId: randomUUID,
    origin: request.headers.origin ?? '',
    registry: extensionRegistry,
    onActivationRejected: (extensionId, activeExtensionId) => {
      log.warn(
        { activeId: activeExtensionId, id: extensionId },
        'Rejected activation from a different extension Origin.'
      )
    },
    onActivated: (extensionId) => {
      log.info({ id: extensionId }, 'Extension activated.')
    },
    onAutoActivated: (extensionId) => {
      log.info({ id: extensionId }, 'Auto-activated sole extension after grace period.')
    },
    onConnected: (extensionId) => {
      log.info({ id: extensionId }, `Extension connected. Total: ${extensionRegistry.size}`)
    },
    onDisconnected: (extensionId, wasActive) => {
      log.info({ id: extensionId }, `Extension disconnected. Remaining: ${extensionRegistry.size}`)
      cleanupForExtension(extensionId)
      if (wasActive) log.warn({ id: extensionId }, 'Active extension disconnected.')
    },
    onProtocolWarning: (warning) => {
      if (warning.kind === 'binary') {
        log.warn({ extId: warning.extensionId }, 'Unexpected binary message received.')
      } else if (warning.kind === 'json') {
        log.warn({ err: warning.error, extId: warning.extensionId }, 'Failed to parse message.')
      } else {
        log.warn({ error: warning.error, extId: warning.extensionId }, 'Invalid message shape.')
      }
    },
    onSocketError: (extensionId, error) => {
      log.warn({ err: error, extId: extensionId }, 'Extension WebSocket error.')
    },
    onStateChange: broadcastState,
    onToolError: (requestId, extensionId, error) => {
      const normalized = coerceToolError(error)
      log.warn(
        {
          toolReq: requestId,
          extId: extensionId,
          code: getRecordProperty(normalized, 'code'),
          message: normalized.message
        },
        'Received tool error from extension.'
      )
      reject(requestId, extensionId, normalized)
    },
    onToolResult: (requestId, extensionId, payload) => {
      resolve(requestId, extensionId, payload)
    }
  })
})

log.info(
  { port: selectedWsPort, extensionOriginPolicy: extensionOriginPolicy.mode },
  'WebSocket server ready.'
)

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
