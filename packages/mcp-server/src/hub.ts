import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  AssetDescriptor,
  GetAssetsParametersInput,
  GetAssetsResult,
  RegisteredMessage,
  StateMessage,
  ToolCallMessage,
  ToolName,
  ToolResultMap,
  ToolResultMessage
} from '@tempad-dev/mcp-shared'
import type { RawData } from 'ws'
import type { ZodType } from 'zod'

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  GetAssetsResultSchema,
  MCP_ASSET_RESOURCE_NAME,
  MCP_ASSET_URI_PREFIX,
  MCP_ASSET_URI_TEMPLATE,
  MessageFromExtensionSchema,
  TEMPAD_MCP_ERROR_CODES,
  type TempadMcpErrorCode
} from '@tempad-dev/mcp-shared'
import { nanoid } from 'nanoid'
import { existsSync, rmSync, chmodSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { WebSocketServer } from 'ws'

import type { AssetRecord, ExtensionConnection } from './types'

import { createAssetHttpServer } from './asset-http-server'
import { createAssetStore } from './asset-store'
import { buildAssetFilename } from './asset-utils'
import { getMcpServerConfig } from './config'
import MCP_INSTRUCTIONS from './instructions.md?raw'
import { register, resolve, reject, cleanupForExtension, cleanupAll } from './request'
import { PACKAGE_VERSION, log, RUNTIME_DIR, SOCK_PATH, ensureDir } from './shared'
import { TOOL_DEFS, coercePayloadToToolResponse, createToolErrorResponse } from './tools'

const SHUTDOWN_TIMEOUT = 2000
const { wsPortCandidates, toolTimeoutMs, maxPayloadBytes, autoActivateGraceMs, assetTtlMs } =
  getMcpServerConfig()

log.info({ version: PACKAGE_VERSION }, 'TemPad MCP Hub starting...')

const extensions: ExtensionConnection[] = []
let consumerCount = 0
type TimeoutHandle = ReturnType<typeof setTimeout>
let autoActivateTimer: TimeoutHandle | null = null
let selectedWsPort = 0

const mcp = new McpServer(
  { name: 'tempad-dev-mcp', version: PACKAGE_VERSION },
  MCP_INSTRUCTIONS ? { instructions: MCP_INSTRUCTIONS } : undefined
)
type McpInputSchema = Parameters<typeof mcp.registerTool>[1]['inputSchema']
type McpOutputSchema = Parameters<typeof mcp.registerTool>[1]['outputSchema']
type ToolResponse = CallToolResult
type SchemaOutput<Schema extends ZodType> = Schema['_output']
type ToolMetadataEntry = (typeof TOOL_DEFS)[number]
type ExtensionToolMetadata = Extract<ToolMetadataEntry, { target: 'extension' }>
type HubToolMetadata = Extract<ToolMetadataEntry, { target: 'hub' }>

type HubToolWithHandler<T extends HubToolMetadata = HubToolMetadata> = T & {
  handler: (args: SchemaOutput<T['parameters']>) => Promise<ToolResponse>
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
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; code?: unknown }
    const message = typeof candidate.message === 'string' ? candidate.message : safeStringify(error)
    const err = new Error(message) as Error & { code?: string }
    if (typeof candidate.code === 'string') err.code = candidate.code
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
const assetHttpServer = createAssetHttpServer(assetStore)
await assetHttpServer.start()
registerAssetResources()
scheduleAssetCleanup()

function registerAssetResources(): void {
  const template = new ResourceTemplate(MCP_ASSET_URI_TEMPLATE, {
    list: async () => ({
      // Intentionally keep resources/list empty: assets are ephemeral, tool-linked blobs.
      // Resource discovery would leak across sessions/design files and add UI noise.
      // Hosts should use resource_link from tool responses to access assets on demand.
      resources: []
    })
  })

  mcp.registerResource(
    MCP_ASSET_RESOURCE_NAME,
    template,
    {
      description:
        'Exported PNG/SVG assets which can serve as screenshots or be referenced in code output.'
    },
    async (_uri, variables) => {
      const hash = typeof variables.hash === 'string' ? variables.hash : ''
      return readAssetResource(hash)
    }
  )
}

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
  log.info(
    { ttlMs: assetTtlMs, intervalMs },
    'Asset TTL cleanup enabled (list remains empty; assets are tool-linked).'
  )
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

async function readAssetResource(hash: string) {
  if (!hash) {
    throw new Error('Missing asset hash in resource URI.')
  }
  const record = assetStore.get(hash)
  if (!record) {
    throw new Error(`Asset ${hash} not found.`)
  }

  if (!existsSync(record.filePath)) {
    assetStore.remove(hash, { removeFile: false })
    throw new Error(`Asset ${hash} file is missing.`)
  }

  const stat = statSync(record.filePath)
  // Base64 encoding increases size by ~33% (4 bytes for every 3 bytes)
  const estimatedSize = Math.ceil(stat.size / 3) * 4
  if (estimatedSize > maxPayloadBytes) {
    throw new Error(
      `Asset ${hash} is too large (${formatBytes(stat.size)}, encoded: ${formatBytes(estimatedSize)}) to read via MCP protocol. Use HTTP download.`
    )
  }

  assetStore.touch(hash)
  const buffer = readFileSync(record.filePath)
  const resourceUri = buildAssetResourceUri(hash)

  if (isTextualMime(record.mimeType)) {
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: record.mimeType,
          text: buffer.toString('utf8')
        }
      ]
    }
  }

  return {
    contents: [
      {
        uri: resourceUri,
        mimeType: record.mimeType,
        blob: buffer.toString('base64')
      }
    ]
  }
}

function isTextualMime(mimeType: string): boolean {
  return mimeType === 'image/svg+xml' || mimeType.startsWith('text/')
}

function buildAssetResourceUri(hash: string): string {
  return `${MCP_ASSET_URI_PREFIX}${hash}`
}

function formatAssetResourceName(hash: string): string {
  return `asset:${hash.slice(0, 8)}`
}

function buildAssetDescriptor(record: AssetRecord): AssetDescriptor {
  const filename = buildAssetFilename(record.hash, record.mimeType)
  return {
    hash: record.hash,
    url: `${assetHttpServer.getBaseUrl()}/assets/${filename}`,
    mimeType: record.mimeType,
    size: record.size,
    resourceUri: buildAssetResourceUri(record.hash),
    width: record.metadata?.width,
    height: record.metadata?.height
  }
}

function createAssetResourceLinkBlock(asset: AssetDescriptor) {
  return {
    type: 'resource_link' as const,
    name: formatAssetResourceName(asset.hash),
    uri: asset.resourceUri,
    mimeType: asset.mimeType,
    description: `${describeAsset(asset)} - Download: ${asset.url}`
  }
}

function describeAsset(asset: AssetDescriptor): string {
  return `${asset.mimeType} (${formatBytes(asset.size)})`
}

function registerTools(): void {
  const registered: string[] = []
  for (const tool of TOOL_DEFINITIONS) {
    if ('exposed' in tool && tool.exposed === false) continue
    registerTool(tool)
    registered.push(tool.name)
  }
  log.info({ tools: registered }, 'Registered tools.')
}

registerTools()
function registerTool(tool: RegisteredTool): void {
  if (tool.target === 'extension') {
    registerProxiedTool(tool)
  } else {
    registerLocalTool(tool)
  }
}

function registerProxiedTool<T extends ExtensionTool>(tool: T): void {
  type Name = T['name']
  type Result = ToolResultMap[Name]

  const registerToolFn = mcp.registerTool.bind(mcp) as (
    name: string,
    options: { description: string; inputSchema: ZodType; outputSchema?: ZodType },
    handler: (args: unknown) => Promise<CallToolResult>
  ) => unknown

  const schema = tool.parameters
  const handler = async (args: unknown) => {
    try {
      const parsedArgs = schema.parse(args)
      const activeExt = extensions.find((e) => e.active)
      if (!activeExt) {
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
          'No active TemPad Dev extension available.'
        )
      }

      const { promise, requestId } = register<Result>(activeExt.id, toolTimeoutMs)

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

      const payload = await promise
      return createToolResponse(tool.name, payload)
    } catch (error) {
      log.error({ tool: tool.name, error }, 'Tool invocation failed before reaching extension.')
      return createToolErrorResponse(tool.name, error)
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

function registerLocalTool(tool: HubOnlyTool): void {
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

  const summary: string[] = []
  summary.push(
    payload.assets.length
      ? `Resolved ${payload.assets.length} asset${payload.assets.length === 1 ? '' : 's'}.`
      : 'No assets were resolved for the requested hashes.'
  )
  if (payload.missing.length) {
    summary.push(`Missing: ${payload.missing.join(', ')}`)
  }
  summary.push(
    'Use resources/read with each resourceUri or fetch the fallback URL to download bytes.'
  )

  const content = [
    {
      type: 'text' as const,
      text: summary.join('\n')
    },
    ...payload.assets.map((asset) => createAssetResourceLinkBlock(asset))
  ]

  return {
    content,
    structuredContent: payload
  }
}

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
  }, autoActivateGraceMs)
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
  const activeId = getActiveId()
  const message: StateMessage = {
    type: 'state',
    activeId,
    count: extensions.length,
    port: selectedWsPort,
    assetServerUrl: assetHttpServer.getBaseUrl()
  }
  extensions.forEach((ext) => ext.ws.send(JSON.stringify(message)))
  log.debug({ activeId, count: extensions.length }, 'Broadcasted state.')
}

function rawDataToBuffer(raw: RawData): Buffer {
  if (typeof raw === 'string') return Buffer.from(raw)
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return Buffer.concat(raw)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function shutdown(): void {
  log.info('Hub is shutting down...')
  assetStore.flush()
  assetHttpServer.stop()
  netServer.close(() => log.info('Net server closed.'))
  wss?.close(() => log.info('WebSocket server closed.'))
  cleanupAll()
  const timer = setTimeout(() => {
    log.warn('Shutdown timed out. Forcing exit.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT)
  unrefTimer(timer)
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
  for (const candidate of wsPortCandidates) {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: candidate,
      maxPayload: maxPayloadBytes
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
    { candidates: wsPortCandidates },
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

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      log.warn({ extId: ext.id }, 'Unexpected binary message received.')
      return
    }

    const messageBuffer = rawDataToBuffer(raw)

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
          reject(id, coerceToolError(error))
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
