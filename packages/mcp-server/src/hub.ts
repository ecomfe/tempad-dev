import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type {
  AssetDescriptor,
  AuthoringRuntimeEvidence,
  BeginDesignParameters,
  EndDesignParameters,
  ResumeDesignParameters,
  DesignTask,
  FigmaSession,
  GetAssetsParametersInput,
  GetAssetsResult,
  StateMessage,
  ToolCallMessage,
  ToolName,
  ToolResultMap,
  UploadAssetParametersInput,
  UploadAssetResult
} from '@tempad-dev/shared'
import type { ZodType } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  DesignTaskSchema,
  GetAssetsResultSchema,
  MCP_APPLY_CANVAS_RUNTIME_BUDGET_BYTES,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_ERROR_CODES,
  measureCallToolResultBytes,
  utf8Bytes,
  type TempadMcpErrorCode
} from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, chmodSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'
import { WebSocketServer } from 'ws'

import type { AssetRecord, ExtensionConnection } from './types'

import { CodexAppFeedback } from './agent-clients/codex-feedback'
import { CodexAppLifecycle } from './agent-clients/codex-lifecycle'
import { ClientHookRequestSchema } from './agent-clients/hooks'
import { ClientEventSchema } from './agent-clients/identity'
import { AgentClients } from './agent-clients/registry'
import { decodeImageDataUrl } from './asset-data-url'
import { createAssetHttpServer } from './asset-http-server'
import { createAssetStore } from './asset-store'
import { buildAssetFilename } from './asset-utils'
import { getMcpServerConfig } from './config'
import { DesignTaskStore } from './design-task-store'
import { DesignTasks, resolveDesignTarget, type DesignTaskRecord } from './design-tasks'
import { ExtensionRegistry } from './extension-registry'
import { attachExtensionSocket } from './extension-socket'
import MCP_INSTRUCTIONS from './instructions.md?raw'
import { register, resolve, reject, cleanupForExtension, cleanupAll } from './request'
import {
  getExtensionRuntimeIssues,
  createHubRuntimeIdentity,
  removeHubRuntimeIdentityIfOwned,
  writeHubRuntimeIdentity,
  type HubRuntimeIdentity
} from './runtime-identity'
import { createExtensionOriginPolicy } from './security'
import {
  HUB_BUSY_EXIT_CODE,
  HUB_LOCK_PATH,
  HUB_LOCK_STALE_MS,
  HUB_LOCK_UPDATE_MS,
  HUB_RUNTIME_IDENTITY_PATH,
  PACKAGE_VERSION,
  log,
  RUNTIME_DIR,
  SOCK_PATH,
  ensureDir,
  getRecordProperty
} from './shared'
import {
  TOOL_DEFS,
  coercePayloadToToolResponse,
  createAssetsToolResponse,
  createDesignTaskToolResponse,
  createInlineBudgetExceededToolResponse,
  createToolErrorResponse,
  createUploadAssetToolResponse
} from './tools'
import { startExtensionWebSocketServer } from './websocket-server'

const SHUTDOWN_TIMEOUT = 2000
const SOCKET_PROBE_TIMEOUT_MS = 300
const {
  wsPortCandidates,
  toolTimeoutMs,
  getCodeTimeoutMs,
  applyCanvasTimeoutMs,
  maxPayloadBytes,
  maxAssetSizeBytes,
  maxExtensionConnections,
  autoActivateGraceMs,
  assetTtlMs,
  allowedExtensionOrigins
} = getMcpServerConfig()
const extensionOriginPolicy = createExtensionOriginPolicy(allowedExtensionOrigins)

log.info({ version: PACKAGE_VERSION }, 'TemPad MCP Hub starting...')

const extensionRegistry = new ExtensionRegistry(autoActivateGraceMs)
const taskStateDirectory = join(homedir(), '.tempad-dev', 'state')
const designTasks = new DesignTasks({
  createId: randomUUID,
  onChange: publishDesignTask,
  store: new DesignTaskStore(join(taskStateDirectory, 'design-tasks.json'))
})
const agentClients = new AgentClients(
  designTasks,
  new CodexAppFeedback(join(taskStateDirectory, 'codex-feedback')),
  (changed) => new CodexAppLifecycle(changed)
)
let refreshingCapabilities = false
const clientCapabilityTimer = setInterval(() => {
  if (refreshingCapabilities) return
  refreshingCapabilities = true
  void agentClients
    .refreshCapabilities()
    .catch((error) => log.warn({ error }, 'Could not refresh agent capabilities.'))
    .finally(() => {
      refreshingCapabilities = false
    })
}, 10000)
const pendingDesignBindings = new Map<string, Promise<void>>()
const designTaskTimer = setInterval(() => designTasks.sweep(), 1000)
designTaskTimer.unref()
let consumerCount = 0
type TimeoutHandle = ReturnType<typeof setTimeout>
let selectedWsPort = 0
let releaseHubLock: (() => Promise<void>) | null = null
let shuttingDown = false
let wss: WebSocketServer | null = null
let hubRuntimeIdentity: HubRuntimeIdentity | null = null
const consumerSessions = new Set<McpServer>()
type ToolResponse = CallToolResult
type ToolRegistrationOptions = {
  annotations?: ToolAnnotations
  description: string
  inputSchema: ZodType
  outputSchema?: ZodType
}
type SchemaOutput<Schema extends ZodType> = Schema['_output']
type ToolMetadataEntry = (typeof TOOL_DEFS)[number]
type ExtensionToolMetadata = Extract<ToolMetadataEntry, { target: 'extension' }>
type HubToolMetadata = Extract<ToolMetadataEntry, { target: 'hub' }>
type HubToolByName<Name extends HubToolMetadata['name']> = Extract<HubToolMetadata, { name: Name }>

type HubToolWithHandlerFor<T extends HubToolMetadata> = T & {
  handler: (args: SchemaOutput<T['parameters']>, ownerId: string) => Promise<ToolResponse>
}

type HubToolWithHandler = {
  [Name in HubToolMetadata['name']]: HubToolWithHandlerFor<HubToolByName<Name>>
}[HubToolMetadata['name']]

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
    case 'get_design_task':
      return {
        ...tool,
        handler: async (args: { taskId: string }, ownerId: string) =>
          createDesignTaskToolResponse(designTasks.owned(args.taskId, ownerId).task)
      }
    case 'list_design_sessions':
      return {
        ...tool,
        handler: async () => {
          const result = {
            sessions: extensionRegistry.list().flatMap((value) => value.sessions?.sessions ?? [])
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result
          }
        }
      }
    case 'resume_design':
      return { ...tool, handler: handleResumeDesign }
    case 'begin_design':
      return { ...tool, handler: handleBeginDesign }
    case 'end_design':
      return { ...tool, handler: handleEndDesign }
    case 'get_assets':
      return { ...tool, handler: handleGetAssets }
    case 'upload_asset':
      return { ...tool, handler: handleUploadAsset }
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
    localPath: record.filePath,
    mimeType: record.mimeType,
    size: record.size,
    width: record.metadata?.width,
    height: record.metadata?.height,
    ...(record.metadata?.themeable ? { themeable: true } : {})
  }
}

function publishDesignTask({ task }: DesignTaskRecord): void {
  const message = JSON.stringify({ type: 'designTaskState', task })
  for (const extension of extensionRegistry.list()) {
    if (!extension.sessions?.sessions.some((session) => session.fileKey === task.target.fileKey))
      continue
    try {
      extension.ws.send(message)
    } catch (error) {
      log.warn({ error, taskId: task.taskId }, 'Failed to synchronize design task.')
    }
  }
}

function resolveDesignRoute(
  ownerId: string,
  taskId?: string,
  active = true,
  explicitSessionId?: string
): {
  extension: ExtensionConnection
  session: FigmaSession
} {
  return resolveDesignTarget(
    designTasks,
    extensionRegistry.list(),
    extensionRegistry.getActiveId(),
    ownerId,
    taskId,
    active,
    explicitSessionId
  )
}

async function handleBeginDesign(
  args: BeginDesignParameters,
  ownerId: string
): Promise<ToolResponse> {
  let record = designTasks.retry(ownerId, args.requestId)
  if (record) {
    if (
      record.task.title !== args.title ||
      (args.sessionId && args.sessionId !== record.task.target.sessionId)
    ) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_INACTIVE,
        'requestId already has another title or Figma target.'
      )
    }
    await pendingDesignBindings.get(record.task.taskId)
    return createDesignTaskToolResponse(record.task)
  }
  const { extension, session } = resolveDesignRoute(ownerId, undefined, true, args.sessionId)
  const issues = getExtensionRuntimeIssues(extension.runtime)
  if (issues.length) {
    throw createCodedError(TEMPAD_MCP_ERROR_CODES.RUNTIME_IDENTITY_MISMATCH, issues.join('; '))
  }
  const { client, capabilities } = await agentClients.describe(ownerId)
  record = designTasks.begin(
    ownerId,
    extension.id,
    session,
    args.title,
    args.requestId,
    client,
    capabilities,
    extension.sessions
      ? { browserId: extension.sessions.browserId, origin: extension.origin }
      : undefined
  )
  const task = record.task
  const binding = bindDesignTask(record, extension, session)
  pendingDesignBindings.set(task.taskId, binding)
  try {
    await binding
    return createDesignTaskToolResponse(task)
  } finally {
    if (pendingDesignBindings.get(task.taskId) === binding)
      pendingDesignBindings.delete(task.taskId)
  }
}

async function bindDesignTask(
  { task, ownerId }: DesignTaskRecord,
  extension: ExtensionConnection,
  session: FigmaSession
): Promise<void> {
  const epoch = task.epoch ?? 0
  const registration = register<DesignTask>(extension.id, toolTimeoutMs)
  try {
    const message: ToolCallMessage = {
      type: 'toolCall',
      id: registration.requestId,
      route: { gatewayId: extension.id, sessionId: session.sessionId, fileKey: session.fileKey },
      payload: { name: '__begin_design', args: task }
    }
    extension.ws.send(JSON.stringify(message))
    const bound = DesignTaskSchema.parse(await registration.promise)
    if (
      bound.taskId !== task.taskId ||
      bound.target.sessionId !== session.sessionId ||
      bound.target.fileKey !== session.fileKey ||
      bound.target.pageId !== task.target.pageId ||
      (bound.epoch ?? 0) !== epoch
    ) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TARGET_CHANGED,
        'The page acknowledged a different design target.'
      )
    }
    designTasks.assertEpoch(task.taskId, ownerId, epoch)
    designTasks.confirm(task.taskId, ownerId)
  } catch (error) {
    reject(registration.requestId, extension.id, coerceToolError(error))
    await registration.promise.catch(() => undefined)
    if ((task.epoch ?? 0) === epoch && task.target.sessionId === session.sessionId)
      designTasks.stop(task.taskId, 'interrupted')
    throw error
  }
}

async function handleResumeDesign(
  args: ResumeDesignParameters,
  ownerId: string
): Promise<ToolResponse> {
  const { extension, session } = resolveDesignRoute(ownerId, args.taskId, false)
  const { client, capabilities } = await agentClients.describe(ownerId)
  designTasks.attachClient(ownerId, client, capabilities)
  const record = designTasks.resume(args.taskId, ownerId, args.epoch, session)
  record.extensionId = extension.id
  if (!record.ready)
    await (pendingDesignBindings.get(args.taskId) ?? bindDesignTask(record, extension, session))
  return createDesignTaskToolResponse(record.task)
}

async function handleEndDesign(args: EndDesignParameters, ownerId: string): Promise<ToolResponse> {
  const record = designTasks.assertEpoch(args.taskId, ownerId, args.taskEpoch)
  if (args.outcome === 'completed' && record.task.operation) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_BUSY,
      'Wait for the running operation before completing the design task.'
    )
  }
  if (args.outcome === 'cancelled') agentClients.cancelFeedback(args.taskId)
  designTasks.snapshotResult(args.taskId, args.summary)
  designTasks.stop(args.taskId, args.outcome)
  return createDesignTaskToolResponse(record.task)
}

function createMcpServer(ownerId: string): McpServer {
  const mcp = new McpServer(
    { name: 'tempad-dev', title: 'TemPad Dev', version: PACKAGE_VERSION },
    MCP_INSTRUCTIONS ? { instructions: MCP_INSTRUCTIONS } : undefined
  )

  mcp.server.setNotificationHandler(ClientEventSchema, (notification) =>
    agentClients.event(ownerId, notification)
  )
  mcp.server.setRequestHandler(ClientHookRequestSchema, (request) =>
    agentClients.clientHook(request.params)
  )

  const registered: string[] = []
  for (const tool of TOOL_DEFINITIONS) {
    if ('exposed' in tool && tool.exposed === false) continue
    registerTool(mcp, tool, ownerId)
    registered.push(tool.name)
  }
  log.info({ tools: registered }, 'Registered tools.')

  return mcp
}

function registerTool(mcp: McpServer, tool: RegisteredTool, ownerId: string): void {
  if (tool.target === 'extension') {
    registerProxiedTool(mcp, tool, ownerId)
  } else {
    registerLocalTool(mcp, tool, ownerId)
  }
}

function registerProxiedTool<T extends ExtensionTool>(
  mcp: McpServer,
  tool: T,
  ownerId: string
): void {
  type Name = T['name']
  type Result = ToolResultMap[Name]

  const registerToolFn = mcp.registerTool.bind(mcp) as (
    name: string,
    options: ToolRegistrationOptions,
    handler: (args: unknown, extra: { _meta?: unknown }) => Promise<CallToolResult>
  ) => unknown

  const schema = tool.parameters
  const connectionId = ownerId
  const handler = async (args: unknown, extra: { _meta?: unknown }) => {
    const ownerId = await agentClients.owner(
      connectionId,
      extra._meta,
      mcp.server.getClientVersion()
    )
    let requestId: string | undefined
    try {
      const { taskId, taskEpoch, ...parsedArgs } = schema.parse(args)
      if (taskId) designTasks.assertEpoch(taskId, ownerId, taskEpoch)
      const { extension: activeExt, session } = resolveDesignRoute(ownerId, taskId)
      const runtimeIssues = getExtensionRuntimeIssues(activeExt.runtime)
      if (runtimeIssues.length) {
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.RUNTIME_IDENTITY_MISMATCH,
          `${runtimeIssues.join('; ')}. Rebuild/reload the extension and start a fresh agent task.`
        )
      }

      const runtime =
        tool.name === 'apply_canvas' ? buildAuthoringRuntimeEvidence(activeExt) : undefined
      if (runtime && utf8Bytes({ runtime }) > MCP_APPLY_CANVAS_RUNTIME_BUDGET_BYTES) {
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.RUNTIME_IDENTITY_MISMATCH,
          'Runtime evidence exceeds the reserved response budget. No canvas write was dispatched.'
        )
      }

      const timeoutMs =
        tool.name === 'get_code'
          ? getCodeTimeoutMs
          : tool.name === 'apply_canvas'
            ? applyCanvasTimeoutMs
            : toolTimeoutMs
      designTasks.checkOperation(ownerId, session, taskId, tool.name === 'apply_canvas')
      const registration = register<Result>(activeExt.id, timeoutMs, {
        waitForDefinitiveResult: tool.name === 'apply_canvas'
      })
      requestId = registration.requestId
      const message: ToolCallMessage = {
        type: 'toolCall',
        id: registration.requestId,
        route: {
          gatewayId: activeExt.id,
          sessionId: session.sessionId,
          fileKey: session.fileKey,
          ...(taskId ? { taskId, epoch: taskEpoch ?? 0 } : {})
        },
        payload: {
          name: tool.name,
          args: parsedArgs
        }
      }
      try {
        designTasks.startOperation(
          requestId,
          ownerId,
          activeExt.id,
          activeExt.sessions!.browserId,
          session,
          taskId,
          tool.name === 'apply_canvas'
        )
        activeExt.ws.send(JSON.stringify(message))
      } catch (error) {
        designTasks.finishOperation(requestId, activeExt.id)
        reject(requestId, activeExt.id, coerceToolError(error))
      }
      log.info(
        { tool: tool.name, req: registration.requestId, extId: activeExt.id },
        'Forwarded tool call.'
      )

      const payload = await registration.promise
      if (taskId && ['get_structure', 'get_code'].includes(tool.name)) {
        designTasks.acknowledgeRead(taskId, ownerId, taskEpoch)
      }
      if (taskId && tool.name === 'apply_canvas') {
        const rootNodeId = getRecordProperty(payload, 'rootNodeId')
        if (typeof rootNodeId === 'string')
          designTasks.captureResult(
            taskId,
            rootNodeId,
            getRecordProperty(payload, 'rootRemoved') === true
          )
        const page = getRecordProperty(payload, 'page')
        if (getRecordProperty(page, 'active') === true) {
          const pageId = getRecordProperty(page, 'id')
          if (typeof pageId === 'string') designTasks.updatePage(taskId, pageId)
        }
      }
      return createToolResponse(tool.name, payload, runtime)
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
      annotations: tool.annotations,
      description: tool.description,
      inputSchema: schema
    },
    handler
  )
}

function registerLocalTool(mcp: McpServer, tool: HubOnlyTool, ownerId: string): void {
  const schema = tool.parameters
  const handler = tool.handler as (args: unknown, ownerId: string) => Promise<CallToolResult>

  const registerToolFn = mcp.registerTool.bind(mcp) as (
    name: string,
    options: ToolRegistrationOptions,
    handler: (args: unknown, extra: { _meta?: unknown }) => Promise<CallToolResult>
  ) => unknown

  const registrationOptions: ToolRegistrationOptions = {
    annotations: tool.annotations,
    description: tool.description,
    inputSchema: schema
  }

  if (tool.outputSchema) {
    registrationOptions.outputSchema = tool.outputSchema
  }

  const connectionId = ownerId
  const registerHandler = async (args: unknown, extra: { _meta?: unknown }) => {
    const ownerId = await agentClients.owner(
      connectionId,
      extra._meta,
      mcp.server.getClientVersion()
    )
    try {
      const parsed = schema.parse(args)
      const taskId = getRecordProperty(parsed, 'taskId')
      if (
        !['end_design', 'resume_design', 'get_design_task'].includes(tool.name) &&
        typeof taskId === 'string'
      ) {
        designTasks.assertEpoch(
          taskId,
          ownerId,
          getRecordProperty(parsed, 'taskEpoch') as number | undefined
        )
        designTasks.touch(taskId, ownerId)
      }
      return await handler(parsed, ownerId)
    } catch (error) {
      log.error({ tool: tool.name, error }, 'Local tool invocation failed.')
      return createToolErrorResponse(tool.name, error)
    }
  }

  registerToolFn(tool.name, registrationOptions, registerHandler)
}

function createToolResponse<Name extends ToolName>(
  toolName: Name,
  payload: ToolResultMap[Name],
  runtime?: AuthoringRuntimeEvidence
): ToolResponse {
  const enrichedPayload = (() => {
    if (toolName === 'get_screenshot') {
      const screenshot = payload as ToolResultMap['get_screenshot']
      return { ...screenshot, asset: addLocalAssetPath(screenshot.asset) }
    }
    if (toolName === 'get_code') {
      const code = payload as ToolResultMap['get_code']
      return code.assets
        ? { ...code, assets: code.assets.map((asset) => addLocalAssetPath(asset)) }
        : code
    }
    if (toolName === 'apply_canvas' && runtime) {
      const apply = payload as ToolResultMap['apply_canvas']
      return { ...apply, runtime }
    }
    return payload
  })() as ToolResultMap[Name]

  let rawResult: ToolResponse
  const definition = getToolDefinition(toolName)
  if (definition && hasFormatter(definition)) {
    try {
      const formatter = definition.format as (input: ToolResultMap[Name]) => ToolResponse
      rawResult = formatter(enrichedPayload)
    } catch (error) {
      log.warn({ tool: toolName, error }, 'Failed to format tool result; returning raw payload.')
      rawResult = coercePayloadToToolResponse(enrichedPayload)
    }
  } else {
    rawResult = coercePayloadToToolResponse(enrichedPayload)
  }

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

function buildAuthoringRuntimeEvidence(extension: ExtensionConnection): AuthoringRuntimeEvidence {
  const runtime = extension.runtime
  const issues = getExtensionRuntimeIssues(runtime)
  if (!hubRuntimeIdentity) issues.unshift('Hub runtime identity is unavailable')
  return {
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
    locked: false,
    valid: issues.length === 0,
    issues,
    hub: {
      packageVersion: hubRuntimeIdentity?.packageVersion ?? PACKAGE_VERSION,
      runtimeFingerprint: hubRuntimeIdentity?.runtimeFingerprint ?? '0'.repeat(64),
      startedAt: hubRuntimeIdentity?.startedAt ?? new Date(0).toISOString()
    },
    extension: {
      version: runtime?.version ?? '<missing>',
      runtimeFingerprint: runtime?.fingerprint ?? '0'.repeat(64),
      connectedAt: extension.connectedAt
    }
  }
}

function addLocalAssetPath(asset: AssetDescriptor): AssetDescriptor {
  const record = assetStore.get(asset.hash)
  return record && existsSync(record.filePath) ? { ...asset, localPath: record.filePath } : asset
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

async function handleUploadAsset({ dataUrl }: UploadAssetParametersInput): Promise<ToolResponse> {
  const decoded = decodeImageDataUrl(dataUrl, maxAssetSizeBytes)
  const filename = buildAssetFilename(decoded.hash, decoded.mimeType)
  const response = await fetch(`${assetHttpServer.getBaseUrl()}/assets/${filename}`, {
    method: 'POST',
    headers: {
      'Content-Length': String(decoded.bytes.length),
      'Content-Type': decoded.mimeType
    },
    body: new Uint8Array(decoded.bytes)
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`Hub asset import failed (${response.status}): ${detail}`)
  }

  const payload: UploadAssetResult = {
    assetHash: decoded.hash,
    mimeType: decoded.mimeType,
    size: decoded.bytes.length
  }
  return createUploadAssetToolResponse(payload)
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
  publishHubRuntimeIdentity()
  const activeId = extensionRegistry.getActiveId()
  const message: StateMessage = {
    type: 'state',
    activeId,
    assetServerUrl: assetHttpServer.getBaseUrl()
  }
  extensionRegistry.list().forEach((ext) => ext.ws.send(JSON.stringify(message)))
  log.debug({ activeId, count: extensionRegistry.size }, 'Broadcasted state.')
}

function publishHubRuntimeIdentity(): void {
  if (!hubRuntimeIdentity) return
  const activeExtension = extensionRegistry.getActive()
  hubRuntimeIdentity = {
    ...hubRuntimeIdentity,
    activeExtension: activeExtension
      ? {
          id: activeExtension.id,
          connectedAt: activeExtension.connectedAt,
          version: activeExtension.runtime?.version ?? null,
          fingerprint: activeExtension.runtime?.fingerprint ?? null
        }
      : null
  }
  writeHubRuntimeIdentity(HUB_RUNTIME_IDENTITY_PATH, hubRuntimeIdentity)
}

function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(designTaskTimer)
  clearInterval(clientCapabilityTimer)
  agentClients.close()
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
  removeHubRuntimeIdentityIfOwned(HUB_RUNTIME_IDENTITY_PATH, process.pid)
  void releaseHubLockIfNeeded()
  const timer = setTimeout(() => {
    log.warn('Shutdown timed out. Forcing exit.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT)
  unrefTimer(timer)
}

const netServer = createServer((sock) => {
  const ownerId = randomUUID()
  const mcp = createMcpServer(ownerId)
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
    agentClients.disconnect(ownerId)
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
  designTasks.restore()
  await cleanSocketPath()
  hubRuntimeIdentity = createHubRuntimeIdentity(fileURLToPath(import.meta.url), PACKAGE_VERSION)
  writeHubRuntimeIdentity(HUB_RUNTIME_IDENTITY_PATH, hubRuntimeIdentity)
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
  removeHubRuntimeIdentityIfOwned(HUB_RUNTIME_IDENTITY_PATH, process.pid)
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
      designTasks.disconnectExtension(extensionId)
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
    onRuntimeHello: (extension) => {
      publishHubRuntimeIdentity()
      log.info(
        {
          extId: extension.id,
          extensionVersion: extension.runtime?.version,
          extensionRuntimeFingerprint: extension.runtime?.fingerprint
        },
        'Extension runtime identity received.'
      )
    },
    onSessions: (extension) => {
      const snapshot = extension.sessions!
      for (const review of snapshot.reviews ?? []) {
        const session = snapshot.sessions.find((value) => value.sessionId === review.sessionId)
        if (!session) continue
        designTasks.restoreReview(review.task, extension, session)
        if (review.task.reviewClosed || review.task.status === 'cancelled')
          agentClients.cancelFeedback(review.task.taskId)
      }
      designTasks.reconcileSessions(snapshot.browserId, snapshot.sessions, snapshot.openTabIds)
      for (const record of designTasks.list()) {
        if (
          designTasks.current(record.task.target.fileKey) === record &&
          snapshot.sessions.some((session) => session.fileKey === record.task.target.fileKey)
        ) {
          extension.ws.send(JSON.stringify({ type: 'designTaskState', task: record.task }))
        }
        if (
          record.extensionId === extension.id &&
          !snapshot.sessions.some((session) => session.sessionId === record.task.target.sessionId)
        ) {
          designTasks.stop(record.task.taskId, 'interrupted')
        }
      }
      for (const { record, extension: target, session } of designTasks.recoverSessions(
        extensionRegistry.list()
      )) {
        const taskId = record.task.taskId
        const binding = bindDesignTask(record, target, session)
        pendingDesignBindings.set(taskId, binding)
        void binding
          .catch((error) => log.warn({ error, taskId }, 'Failed to restore a refreshed Figma tab.'))
          .finally(() => {
            if (pendingDesignBindings.get(taskId) === binding) pendingDesignBindings.delete(taskId)
          })
      }
    },
    onDesignAction: (extension, sessionId, action) => {
      const session = extension.sessions?.sessions.find((value) => value.sessionId === sessionId)
      const record = designTasks.find(action.taskId)
      const reply = (result: import('@tempad-dev/shared').DesignActionResult) => {
        try {
          extension.ws.send(JSON.stringify({ type: 'designActionResult', sessionId, result }))
        } catch {
          /* The client may have disconnected. */
        }
      }
      if (
        !session ||
        record?.task.target.fileKey !== session.fileKey ||
        (['feedback', 'steer'].includes(action.action) &&
          record.task.target.sessionId !== sessionId)
      ) {
        reply({
          requestId: action.requestId,
          taskId: action.taskId,
          status: 'failed',
          message: 'This action belongs to another Figma file.'
        })
        return
      }
      const accepted = () =>
        reply({
          requestId: action.requestId,
          taskId: action.taskId,
          status: 'accepted',
          message: action.action === 'stop' ? 'Stopping design task…' : 'Sending feedback…'
        })
      void agentClients
        .action(action, accepted)
        .then(reply)
        .catch((error) =>
          reply({
            requestId: action.requestId,
            taskId: action.taskId,
            status: 'failed',
            message: String(error).slice(0, 500)
          })
        )
    },
    onSocketError: (extensionId, error) => {
      log.warn({ err: error, extId: extensionId }, 'Extension WebSocket error.')
    },
    onStateChange: broadcastState,
    onToolError: (requestId, extensionId, error) => {
      if (error.code === TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED) {
        designTasks.uncertain(requestId, extensionId)
      } else designTasks.finishOperation(requestId, extensionId)
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
      designTasks.finishOperation(requestId, extensionId)
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
