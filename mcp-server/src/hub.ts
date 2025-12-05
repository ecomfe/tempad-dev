import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { RawData } from 'ws'
import type { ZodType } from 'zod'

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { nanoid } from 'nanoid'
import { existsSync, rmSync, chmodSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { WebSocketServer } from 'ws'

import type {
  AssetDescriptor,
  GetAssetsParametersInput,
  GetAssetsResult,
  GetScreenshotResult,
  ToolResultMap,
  ToolName
} from './tools'
import type { AssetRecord, ExtensionConnection } from './types'

import {
  MCP_ASSET_RESOURCE_NAME,
  MCP_ASSET_URI_PREFIX,
  MCP_ASSET_URI_TEMPLATE
} from '../../mcp/shared/constants'
import { createAssetHttpServer } from './asset-http-server'
import { createAssetStore } from './asset-store'
import { getMcpServerConfig } from './config'
import {
  MessageFromExtensionSchema,
  RegisteredMessage,
  StateMessage,
  ToolCallMessage,
  ToolResultMessage
} from './protocol'
import { register, resolve, reject, cleanupForExtension, cleanupAll } from './request'
import { log, RUNTIME_DIR, SOCK_PATH, ensureDir } from './shared'
import { GetAssetsResultSchema, TOOL_METADATA } from './tools'

const SHUTDOWN_TIMEOUT = 2000
const { wsPortCandidates, toolTimeoutMs, maxPayloadBytes, autoActivateGraceMs } =
  getMcpServerConfig()

const extensions: ExtensionConnection[] = []
let consumerCount = 0
type TimeoutHandle = ReturnType<typeof setTimeout>
let autoActivateTimer: TimeoutHandle | null = null
let selectedWsPort = 0

const mcp = new McpServer({ name: 'tempad-dev-mcp', version: '0.1.0' })
type McpInputSchema = Parameters<typeof mcp.registerTool>[1]['inputSchema']
type McpOutputSchema = Parameters<typeof mcp.registerTool>[1]['outputSchema']
type ToolResponse = CallToolResult
type SchemaOutput<Schema extends ZodType> = Schema['_output']
type ToolMetadataEntry = (typeof TOOL_METADATA)[number]
type ExtensionToolMetadata = Extract<ToolMetadataEntry, { target: 'extension' }>
type HubToolMetadata = Extract<ToolMetadataEntry, { target: 'hub' }>

type ExtensionToolWithFormat<Name extends ExtensionToolMetadata['name']> = Extract<
  ExtensionToolMetadata,
  { name: Name }
> & {
  format: (payload: ToolResultMap[Name]) => ToolResponse
}

type HubToolWithHandler<Name extends HubToolMetadata['name']> = Extract<
  HubToolMetadata,
  { name: Name }
> & {
  handler: (
    args: SchemaOutput<Extract<HubToolMetadata, { name: Name }>['parameters']>
  ) => Promise<ToolResponse>
}

type RegisteredToolDefinition =
  | ExtensionToolWithFormat<'get_code'>
  | ExtensionToolWithFormat<'get_screenshot'>
  | Extract<ExtensionToolMetadata, { name: 'get_token_defs' | 'get_structure' }>
  | HubToolWithHandler<'get_assets'>

type ExtensionToolWithFormatter =
  | ExtensionToolWithFormat<'get_code'>
  | ExtensionToolWithFormat<'get_screenshot'>

function enrichToolDefinition(tool: ToolMetadataEntry): RegisteredToolDefinition {
  if (tool.target === 'extension') {
    switch (tool.name) {
      case 'get_code':
        return { ...tool, format: createCodeToolResponse }
      case 'get_screenshot':
        return { ...tool, format: createScreenshotToolResponse }
      default:
        return tool
    }
  }

  switch (tool.name) {
    case 'get_assets':
      return { ...tool, handler: handleGetAssets }
    default:
      throw new Error('No handler configured for hub tool.')
  }
}

const TOOL_DEFINITIONS: ReadonlyArray<RegisteredToolDefinition> = TOOL_METADATA.map((tool) =>
  enrichToolDefinition(tool)
)

type RegisteredTool = (typeof TOOL_DEFINITIONS)[number]
type ExtensionTool = Extract<RegisteredTool, { target: 'extension' }>
type HubOnlyTool = Extract<RegisteredTool, { target: 'hub' }>

function hasFormatter(tool: RegisteredToolDefinition): tool is ExtensionToolWithFormatter {
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

function registerAssetResources(): void {
  const template = new ResourceTemplate(MCP_ASSET_URI_TEMPLATE, {
    list: async () => ({
      resources: assetStore
        .list()
        .filter((record) => existsSync(record.filePath))
        .map((record) => ({
          uri: buildAssetResourceUri(record.hash),
          name: formatAssetResourceName(record.hash),
          description: `${record.mimeType} (${formatBytes(record.size)})`,
          mimeType: record.mimeType
        }))
    })
  })

  mcp.registerResource(
    MCP_ASSET_RESOURCE_NAME,
    template,
    {
      description: 'Binary assets captured by the TemPad Dev hub.'
    },
    async (_uri, variables) => {
      const hash = typeof variables.hash === 'string' ? variables.hash : ''
      return readAssetResource(hash)
    }
  )
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
  return {
    hash: record.hash,
    url: `${assetHttpServer.getBaseUrl()}/assets/${record.hash}`,
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
    if (tool.exposed === false) continue
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

  const schema = tool.parameters
  mcp.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: schema as unknown as McpInputSchema
    },
    async (args: unknown) => {
      try {
        const parsedArgs = schema.parse(args)
        const activeExt = extensions.find((e) => e.active)
        if (!activeExt) throw new Error('No active TemPad Dev extension available.')

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
  )
}

function registerLocalTool(tool: HubOnlyTool): void {
  const schema = tool.parameters
  const handler = tool.handler

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

  mcp.registerTool(tool.name, registrationOptions, async (args: unknown) => {
    try {
      const parsed = schema.parse(args)
      return await handler(parsed)
    } catch (error) {
      log.error({ tool: tool.name, error }, 'Local tool invocation failed.')
      return createToolErrorResponse(tool.name, error)
    }
  })
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
function coercePayloadToToolResponse(payload: unknown): ToolResponse {
  if (payload && typeof payload === 'object' && Array.isArray((payload as ToolResponse).content)) {
    return payload as ToolResponse
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      }
    ]
  }
}

function createCodeToolResponse(payload: ToolResultMap['get_code']): ToolResponse {
  if (!isCodeResult(payload)) {
    throw new Error('Invalid get_code payload received from extension.')
  }

  const normalized = normalizeCodeResult(payload)
  const summary: string[] = []
  const codeSize = Buffer.byteLength(normalized.code, 'utf8')
  summary.push(`Generated ${normalized.lang.toUpperCase()} snippet (${formatBytes(codeSize)}).`)
  if (normalized.message) {
    summary.push(normalized.message)
  }
  summary.push(
    normalized.assets.length
      ? `Assets attached: ${normalized.assets.length}. Fetch bytes via resources/read using resourceUri or call get_assets.`
      : 'No binary assets were attached to this response.'
  )
  if (normalized.usedTokens?.length) {
    summary.push(`Token references included: ${normalized.usedTokens.length}.`)
  }
  summary.push('Read structuredContent for the full code string and asset metadata.')

  return {
    content: [
      {
        type: 'text' as const,
        text: summary.join('\n')
      }
    ],
    structuredContent: normalized
  }
}

function isCodeResult(payload: unknown): payload is ToolResultMap['get_code'] {
  if (typeof payload !== 'object' || !payload) return false
  const candidate = payload as Partial<ToolResultMap['get_code'] & Record<string, unknown>>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.lang === 'string' &&
    Array.isArray(candidate.assets)
  )
}

function normalizeCodeResult(result: ToolResultMap['get_code']): ToolResultMap['get_code'] {
  const updatedAssets = result.assets.map((asset) => enrichAssetDescriptor(asset))
  const rewrittenCode = rewriteCodeAssetUrls(result.code, updatedAssets)
  return {
    ...result,
    code: rewrittenCode,
    assets: updatedAssets
  }
}

function rewriteCodeAssetUrls(code: string, assets: AssetDescriptor[]): string {
  let updatedCode = code
  for (const asset of assets) {
    // Replace asset:// URIs with the HTTP URL
    const uriPattern = new RegExp(escapeRegExp(asset.resourceUri), 'g')
    updatedCode = updatedCode.replace(uriPattern, asset.url)
  }
  return updatedCode
}

function createToolErrorResponse(toolName: string, error: unknown): ToolResponse {
  const message =
    error instanceof Error
      ? error.message || 'Unknown error occurred.'
      : typeof error === 'string'
        ? error
        : 'Unknown error occurred.'
  return {
    content: [
      {
        type: 'text' as const,
        text: `Tool "${toolName}" failed: ${message}`
      }
    ]
  }
}

function enrichAssetDescriptor(asset: AssetDescriptor): AssetDescriptor {
  const record = assetStore.get(asset.hash)
  if (!record) {
    return asset
  }
  return buildAssetDescriptor(record)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function createScreenshotToolResponse(payload: ToolResultMap['get_screenshot']): ToolResponse {
  if (!isScreenshotResult(payload)) {
    throw new Error('Invalid get_screenshot payload received from extension.')
  }

  const descriptionBlock = {
    type: 'text' as const,
    text: describeScreenshot(payload)
  }

  return {
    content: [
      descriptionBlock,
      {
        type: 'text' as const,
        text: `![Screenshot](${payload.asset.url})`
      },
      createResourceLinkBlock(payload.asset, payload)
    ],
    structuredContent: payload
  }
}

function createResourceLinkBlock(asset: AssetDescriptor, result: GetScreenshotResult) {
  return {
    type: 'resource_link' as const,
    name: 'Screenshot',
    uri: asset.resourceUri,
    mimeType: asset.mimeType,
    description: `Screenshot ${result.width}x${result.height} @${result.scale}x - Download: ${asset.url}`
  }
}

function describeScreenshot(result: GetScreenshotResult): string {
  return `Screenshot ${result.width}x${result.height} @${result.scale}x (${formatBytes(result.bytes)})`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isScreenshotResult(payload: unknown): payload is GetScreenshotResult {
  if (typeof payload !== 'object' || !payload) return false
  const candidate = payload as Partial<GetScreenshotResult & Record<string, unknown>>
  return (
    typeof candidate.asset === 'object' &&
    candidate.asset !== null &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    typeof candidate.scale === 'number' &&
    typeof candidate.bytes === 'number' &&
    typeof candidate.format === 'string'
  )
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
