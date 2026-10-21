import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type {
  AssetDescriptor,
  AuthoringRuntimeEvidence,
  BeginDesignParameters,
  EndDesignParameters,
  ResumeDesignParameters,
  ManageDesignTaskParameters,
  DesignTask,
  FigmaSession,
  GetCodeResult,
  GetScreenshotResult,
  StateMessage,
  ToolCallMessage,
  ToolName,
  ToolResultMap,
  UploadAssetParametersInput,
  UploadAssetResult
} from '@tempad-dev/shared'
import type { ZodType } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  deserializeMessage,
  STDIO_DEFAULT_MAX_BUFFER_SIZE
} from '@modelcontextprotocol/sdk/shared/stdio.js'
import {
  CanvasPageSnapshotSchema,
  DesignTaskSchema,
  MCP_APPLY_CANVAS_RUNTIME_BUDGET_BYTES,
  MCP_NODE_READ_BATCH_WORK_BUDGET_MS,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_ERROR_CODES,
  measureCallToolResultBytes,
  utf8Bytes,
  type TempadMcpErrorCode
} from '@tempad-dev/shared'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, chmodSync, mkdirSync, realpathSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'
import { WebSocketServer } from 'ws'

import type { ExtensionConnection } from './types'

import { CodexAppFeedback } from './agent-clients/codex-feedback'
import { CodexAppLifecycle } from './agent-clients/codex-lifecycle'
import { ClientHookRequestSchema } from './agent-clients/hooks'
import { ClientEventSchema } from './agent-clients/identity'
import { AgentClients } from './agent-clients/registry'
import { decodeImageDataUrl } from './asset-data-url'
import { createAssetHttpServer } from './asset-http-server'
import { createAssetStore } from './asset-store'
import { buildAssetFilename } from './asset-utils'
import { ClientBindingSubscribeSchema, ClientBindingUpdateSchema } from './client-binding'
import { getMcpServerConfig } from './config'
import { ConsumerTransport } from './consumer-transport'
import { DesignTaskStore } from './design-task-store'
import { DesignTasks, resolveDesignTarget, type DesignTaskRecord } from './design-tasks'
import { ExtensionRegistry } from './extension-registry'
import { attachExtensionSocket } from './extension-socket'
import MCP_INSTRUCTIONS from './instructions.md?raw'
import { extensionUpgradeRequired, legacyToolPayload } from './legacy-extension'
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
  ASSET_DIR,
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
  assertTrustedSocket,
  resolveStateDir,
  getRecordProperty
} from './shared'
import { TerminalReceipts } from './terminal-receipts'
import {
  TOOL_DEFS,
  coercePayloadToToolResponse,
  createDesignTaskToolResponse,
  createInlineBudgetExceededToolResponse,
  createToolErrorResponse,
  createUploadAssetToolResponse
} from './tools'
import { assertVersionedToolSupport, versionedReadNotice } from './versioned-extension'
import { startExtensionWebSocketServer } from './websocket-server'

function hasCanvasReadEvidence(tool: ToolName, payload: unknown): boolean {
  if (tool === 'get_structure') {
    const roots = getRecordProperty(payload, 'roots')
    const page = getRecordProperty(payload, 'page')
    return (
      (Array.isArray(roots) &&
        roots.some((root) => typeof getRecordProperty(root, 'id') === 'string')) ||
      CanvasPageSnapshotSchema.safeParse(page).success
    )
  }
  if (tool !== 'get_code') return false
  if (typeof getRecordProperty(payload, 'code') === 'string') return true
  const results = getRecordProperty(payload, 'results')
  return (
    Array.isArray(results) &&
    results.some(
      (entry) => typeof getRecordProperty(getRecordProperty(entry, 'result'), 'code') === 'string'
    )
  )
}

export async function startHub(): Promise<void> {
  const SHUTDOWN_TIMEOUT = 2000
  const SOCKET_PROBE_TIMEOUT_MS = 300
  const EXACT_SESSION_READ_TOOLS = new Set<ToolName>([
    'get_code',
    'get_structure',
    'get_screenshot',
    'get_design_system'
  ])
  const {
    wsPortCandidates,
    toolTimeoutMs,
    getCodeTimeoutMs,
    getDesignSystemTimeoutMs,
    pageStructureTimeoutMs,
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
  const taskStateDirectory = resolveStateDir()
  const terminalReceipts = new TerminalReceipts()
  const designTasks = new DesignTasks({
    createId: randomUUID,
    onChange: publishDesignTask,
    onReviewStop: ({ task }) => {
      void agentClients
        .action({
          requestId: randomUUID(),
          taskId: task.taskId,
          epoch: task.epoch ?? 0,
          action: 'stop'
        })
        .catch((error) =>
          log.warn(
            { error, taskId: task.taskId },
            'Offline Stop host interruption could not be confirmed.'
          )
        )
    },
    onPersistenceError: (error) =>
      log.error(
        { error },
        'Could not persist design task state; writes are fenced until storage recovers.'
      ),
    store: new DesignTaskStore(join(taskStateDirectory, 'design-tasks.json'))
  })
  const agentClients = new AgentClients(
    designTasks,
    new CodexAppFeedback(join(taskStateDirectory, 'codex-feedback')),
    (changed) => new CodexAppLifecycle(changed)
  )
  let refreshingCapabilities = false
  let storesOwned = false
  const storeReleases: Array<() => Promise<void>> = []
  const clientCapabilityTimer = setInterval(() => {
    if (!storesOwned || shuttingDown || refreshingCapabilities) return
    refreshingCapabilities = true
    void agentClients
      .refreshCapabilities()
      .catch((error) => log.warn({ error }, 'Could not refresh agent capabilities.'))
      .finally(() => {
        refreshingCapabilities = false
      })
  }, 10000)
  const pendingDesignBindings = new Map<string, Promise<void>>()
  const designTaskTimer = setInterval(() => {
    if (storesOwned && !shuttingDown) designTasks.sweep()
  }, 1000)
  designTaskTimer.unref()
  let consumerCount = 0
  type TimeoutHandle = ReturnType<typeof setTimeout>
  let selectedWsPort = 0
  let releaseHubLock: (() => Promise<void>) | null = null
  let shuttingDown = false
  let wss: WebSocketServer | null = null
  let hubRuntimeIdentity: HubRuntimeIdentity | null = null
  const consumerSessions = new Set<McpServer>()
  const incomingSockets = new Set<Socket>()
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
  type HubToolByName<Name extends HubToolMetadata['name']> = Extract<
    HubToolMetadata,
    { name: Name }
  >

  type HubToolWithHandlerFor<T extends HubToolMetadata> = T & {
    handler: (
      args: SchemaOutput<T['parameters']>,
      ownerId: string,
      signal: AbortSignal
    ) => Promise<ToolResponse>
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
        assertTrustedSocket(SOCK_PATH)
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

  async function releasePartialStoreLocks(): Promise<void> {
    storesOwned = false
    for (const release of storeReleases.splice(0).reverse()) {
      try {
        await release()
      } catch (error) {
        log.warn({ error }, 'Could not release Hub store writer lock.')
      }
    }
  }

  async function acquireStoreLocks(): Promise<void> {
    // Existing storage may be 0755. Lock its canonical directory without
    // changing permissions or requiring the private runtime-directory policy.
    const directories = [taskStateDirectory, ASSET_DIR].map((directory) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      return realpathSync(directory)
    })
    try {
      for (const directory of [...new Set(directories)].sort()) {
        storeReleases.push(
          await lockfile.lock(directory, {
            lockfilePath: join(directory, '.tempad-hub-writer.lock'),
            retries: 0,
            stale: HUB_LOCK_STALE_MS,
            update: HUB_LOCK_UPDATE_MS,
            onCompromised: (error) => {
              log.error({ error }, 'Hub store writer lock was compromised. Exiting.')
              process.exit(1)
            }
          })
        )
      }
    } catch (error) {
      await releasePartialStoreLocks()
      throw error
    }
    storesOwned = true
    // Abort cannot cancel in-flight filesystem writes. Keep ownership through
    // shutdown; proper-lockfile synchronously releases it only on process exit.
  }

  async function probeSocketPath(): Promise<SocketProbeResult> {
    return process.platform === 'win32' || existsSync(SOCK_PATH)
      ? await probeHubSocket()
      : 'missing'
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
            if (!result.sessions.length && extensionRegistry.list().some((value) => value.legacy)) {
              throw extensionUpgradeRequired()
            }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent: result
            }
          }
        }
      case 'manage_design_task':
        return { ...tool, handler: handleManageDesignTask }
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

  function getToolDefinition<Name extends RegisteredTool['name']>(
    name: Name
  ): ToolDefinitionByName[Name] {
    return TOOL_BY_NAME[name]
  }

  let assetStore: ReturnType<typeof createAssetStore>
  let assetHttpServer: ReturnType<typeof createAssetHttpServer>
  let assetCleanupTimer: ReturnType<typeof setInterval> | undefined

  function scheduleAssetCleanup(): void {
    if (assetTtlMs <= 0) {
      log.info('Asset TTL cleanup disabled (TEMPAD_MCP_ASSET_TTL_MS=0).')
      return
    }
    pruneExpiredAssets(assetTtlMs)
    const intervalMs = Math.min(assetTtlMs, 24 * 60 * 60 * 1000)
    assetCleanupTimer = setInterval(() => {
      pruneExpiredAssets(assetTtlMs)
    }, intervalMs)
    unrefTimer(assetCleanupTimer)
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

  function publishDesignTask({ task, extensionId }: DesignTaskRecord): void {
    const message = JSON.stringify({ type: 'designTaskState', task })
    for (const extension of extensionRegistry.list()) {
      if (extension.id !== extensionId) continue
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

  async function handleManageDesignTask(
    args: ManageDesignTaskParameters,
    ownerId: string,
    signal: AbortSignal
  ): Promise<ToolResponse> {
    // The shared schema validates required and forbidden fields for each action.
    switch (args.action) {
      case 'begin':
        return handleBeginDesign(
          {
            title: args.title!,
            requestId: args.requestId!,
            sessionId: args.sessionId,
            recoveryGeneration: args.recoveryGeneration
          },
          ownerId,
          signal
        )
      case 'resume':
        return handleResumeDesign({ taskId: args.taskId!, epoch: args.epoch! }, ownerId, signal)
      case 'complete':
      case 'cancel':
        return handleEndDesign(
          {
            taskId: args.taskId!,
            taskEpoch: args.epoch!,
            outcome: args.action === 'complete' ? 'completed' : 'cancelled',
            summary: args.summary
          },
          ownerId
        )
    }
  }

  async function handleBeginDesign(
    args: BeginDesignParameters,
    ownerId: string,
    signal: AbortSignal
  ): Promise<ToolResponse> {
    let record = designTasks.retry(ownerId, args.requestId, args.recoveryGeneration)
    if (record) {
      if (
        record.task.title !== args.title ||
        (args.sessionId && args.sessionId !== record.task.target.sessionId)
      ) {
        throw createCodedError(
          TEMPAD_MCP_ERROR_CODES.REQUEST_ID_CONFLICT,
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
    signal.throwIfAborted()
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
        : undefined,
      args.recoveryGeneration
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
    ownerId: string,
    signal: AbortSignal
  ): Promise<ToolResponse> {
    const { extension, session } = resolveDesignRoute(ownerId, args.taskId, false)
    const { client, capabilities } = await agentClients.describe(ownerId)
    signal.throwIfAborted()
    designTasks.attachClient(ownerId, client, capabilities)
    const record = designTasks.resume(args.taskId, ownerId, args.epoch, session)
    record.extensionId = extension.id
    if (!record.ready)
      await (pendingDesignBindings.get(args.taskId) ?? bindDesignTask(record, extension, session))
    return createDesignTaskToolResponse(record.task)
  }

  async function handleEndDesign(
    args: EndDesignParameters,
    ownerId: string
  ): Promise<ToolResponse> {
    const record = designTasks.assertEpoch(args.taskId, ownerId, args.taskEpoch)
    if (args.outcome === 'completed' && record.task.operation) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_BUSY,
        'Wait for the running operation before completing the design task.'
      )
    }
    if (args.outcome === 'cancelled') void agentClients.cancelFeedback(args.taskId).catch(() => {})
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
    mcp.server.setNotificationHandler(ClientBindingSubscribeSchema, (notification) => {
      agentClients.subscribeBinding(
        ownerId,
        (binding) => {
          void mcp.server
            .notification({
              method: ClientBindingUpdateSchema.shape.method.value,
              params: binding
            })
            .catch((error) => log.warn({ error }, 'Could not update CLI conversation binding.'))
        },
        notification.params?.sessionId
      )
    })
    mcp.server.setRequestHandler(ClientHookRequestSchema, (request) =>
      agentClients.clientHook(request.params)
    )

    const registered: string[] = []
    for (const tool of TOOL_DEFINITIONS) {
      registerTool(mcp, tool, ownerId)
      registered.push(tool.name)
    }
    log.debug({ tools: registered }, 'Registered tools.')

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
      handler: (
        args: unknown,
        extra: { _meta?: unknown; signal: AbortSignal }
      ) => Promise<CallToolResult>
    ) => unknown

    const schema = tool.parameters
    const connectionId = ownerId
    const isCanvasWrite = tool.name === 'apply_canvas'
    const handler = async (args: unknown, extra: { _meta?: unknown; signal: AbortSignal }) => {
      let requestId: string | undefined
      let readTarget: { fileKey: string; taskId?: string } | undefined
      try {
        extra.signal.throwIfAborted()
        const ownerId = await agentClients.owner(
          connectionId,
          extra._meta,
          mcp.server.getClientVersion()
        )
        extra.signal.throwIfAborted()
        const parsed = schema.parse(args)
        const { taskId, taskEpoch, ...parsedArgs } = parsed
        const readSessionId = EXACT_SESSION_READ_TOOLS.has(tool.name)
          ? getRecordProperty(parsedArgs, 'sessionId')
          : undefined
        const explicitSessionId = typeof readSessionId === 'string' ? readSessionId : undefined
        if (explicitSessionId) delete (parsedArgs as Record<string, unknown>).sessionId
        if (taskId) designTasks.assertEpoch(taskId, ownerId, taskEpoch)
        let timeoutMs = toolTimeoutMs
        if (tool.name === 'get_code') {
          timeoutMs = getCodeTimeoutMs
        } else if (
          tool.name === 'get_design_system' &&
          getRecordProperty(parsedArgs, 'scope') !== 'fonts' &&
          getRecordProperty(parsedArgs, 'scope') !== 'pages' &&
          !getRecordProperty(parsedArgs, 'catalogId')
        ) {
          timeoutMs = getDesignSystemTimeoutMs
        } else if (
          tool.name === 'get_structure' &&
          (getRecordProperty(parsedArgs, 'pageId') || getRecordProperty(parsedArgs, 'pageKey'))
        ) {
          timeoutMs = pageStructureTimeoutMs
        } else if (isCanvasWrite) {
          timeoutMs = applyCanvasTimeoutMs
        }
        if (
          (tool.name === 'get_code' || tool.name === 'get_screenshot') &&
          !getRecordProperty(parsedArgs, 'nodeId')
        ) {
          timeoutMs += MCP_NODE_READ_BATCH_WORK_BUDGET_MS
        }
        // Task-bound calls must always resolve their original target. Legacy reads are
        // available only when that unversioned connection is explicitly the active route.
        const legacy = !taskId && !explicitSessionId ? extensionRegistry.getActive() : undefined
        if (legacy?.legacy) {
          const payload = legacyToolPayload(tool.name, parsed)
          const registration = register<Result>(legacy.id, timeoutMs, { signal: extra.signal })
          requestId = registration.requestId
          try {
            legacy.ws.send(JSON.stringify({ type: 'toolCall', id: requestId, payload }))
          } catch (error) {
            reject(requestId, legacy.id, coerceToolError(error))
          }
          return createToolResponse(tool.name, await registration.promise)
        }
        const { extension: activeExt, session } = resolveDesignRoute(
          ownerId,
          taskId,
          true,
          explicitSessionId
        )
        readTarget = { fileKey: session.fileKey, taskId }
        const runtimeIssues = getExtensionRuntimeIssues(activeExt.runtime)
        if (runtimeIssues.length) {
          throw createCodedError(
            TEMPAD_MCP_ERROR_CODES.RUNTIME_IDENTITY_MISMATCH,
            `${runtimeIssues.join('; ')}. Rebuild/reload the extension and start a fresh agent task.`
          )
        }

        const runtime = isCanvasWrite ? buildAuthoringRuntimeEvidence(activeExt) : undefined
        const protocolVersion = activeExt.runtime!.protocolVersion
        assertVersionedToolSupport(protocolVersion, tool.name, parsedArgs)
        if (runtime && utf8Bytes({ runtime }) > MCP_APPLY_CANVAS_RUNTIME_BUDGET_BYTES) {
          throw createCodedError(
            TEMPAD_MCP_ERROR_CODES.RUNTIME_IDENTITY_MISMATCH,
            'Runtime evidence exceeds the reserved response budget. No canvas write was dispatched.'
          )
        }

        designTasks.checkOperation(ownerId, session, taskId, isCanvasWrite)
        const registration = register<Result>(activeExt.id, timeoutMs, {
          waitForDefinitiveResult: isCanvasWrite,
          signal: extra.signal
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
        let dispatched = false
        let readGeneration: number | undefined
        try {
          message.terminalReceipt = terminalReceipts.reserve(
            requestId,
            activeExt,
            session,
            taskId,
            isCanvasWrite,
            taskEpoch
          )
          designTasks.startOperation(
            requestId,
            ownerId,
            activeExt.id,
            activeExt.sessions!.browserId,
            session,
            taskId,
            isCanvasWrite
          )
          // Save before dispatch: even a crash or a subsequent disk failure must
          // leave the original file fenced until its state is read.
          if (isCanvasWrite) readGeneration = designTasks.requireFileRead(session.fileKey, true)
          activeExt.ws.send(JSON.stringify(message))
          dispatched = true
        } catch (error) {
          terminalReceipts.settle(requestId, activeExt.id)
          designTasks.finishOperation(requestId, activeExt.id)
          reject(requestId, activeExt.id, coerceToolError(error))
        }
        log.info(
          { tool: tool.name, req: registration.requestId, extId: activeExt.id },
          'Forwarded tool call.'
        )

        // Consumer cancellation and transport failures end only this wait. The
        // operation remains fenced until its definitive result or document loss.
        const payload = await registration.promise.catch((error: unknown) => {
          const code = getRecordProperty(error, 'code')
          // Only these outcomes prove that an older or newer peer did not write.
          // Other codes (including legacy validation failures) can arrive after
          // mutation; an absent/unknown code is not evidence of a safe failure.
          const safeFailure =
            code === TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED ||
            code === TEMPAD_MCP_ERROR_CODES.EXTENSION_DELIVERY_FAILED
          const unknownOutcome =
            dispatched &&
            (designTasks.isOperationPending(registration.requestId) ||
              getRecordProperty(error, 'name') === 'AbortError' ||
              !safeFailure)
          if (readGeneration !== undefined && !unknownOutcome)
            designTasks.acknowledgeFileRead(session.fileKey, readGeneration)
          throw error
        })
        if (taskId && isCanvasWrite) {
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
        const readEvidence = hasCanvasReadEvidence(tool.name, payload)
        const response = createToolResponse(tool.name, payload, {
          runtime,
          notice: versionedReadNotice(protocolVersion, tool.name)
        })
        if (!response.isError && readGeneration !== undefined)
          designTasks.acknowledgeFileRead(session.fileKey, readGeneration)
        if (!response.isError && readEvidence) {
          if (taskId) designTasks.acknowledgeRead(taskId, ownerId, taskEpoch)
          designTasks.acknowledgeFileRead(session.fileKey)
        }
        return withCanvasReadNotice(tool.name, response, readTarget)
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
        return withCanvasReadNotice(
          tool.name,
          createToolErrorResponse(tool.name, normalized),
          readTarget
        )
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

  function withCanvasReadNotice(
    tool: ToolName,
    response: CallToolResult,
    target?: { fileKey: string; taskId?: string }
  ): CallToolResult {
    const notice =
      target &&
      (tool === 'apply_canvas' || tool === 'get_structure' || tool === 'get_code') &&
      (designTasks.needsFileRead(target.fileKey) ||
        (target.taskId && designTasks.find(target.taskId)?.task.needsRead))
        ? 'Canvas writes still require readback. Read a surviving node with get_structure or get_code, or an exact page with get_structure. For a resumed task, include its taskId and current taskEpoch. Empty selections and failed node reads do not clear this requirement.'
        : undefined
    const prependNotice = (result: CallToolResult): CallToolResult =>
      notice ? { ...result, content: [{ type: 'text', text: notice }, ...result.content] } : result
    const result = prependNotice(response)
    const bytes = measureCallToolResultBytes(result)
    return bytes <= MCP_TOOL_INLINE_BUDGET_BYTES
      ? result
      : prependNotice(createInlineBudgetExceededToolResponse(tool, bytes))
  }

  function registerLocalTool(mcp: McpServer, tool: HubOnlyTool, ownerId: string): void {
    const schema = tool.parameters
    const handler = tool.handler as (
      args: unknown,
      ownerId: string,
      signal: AbortSignal
    ) => Promise<CallToolResult>

    const registerToolFn = mcp.registerTool.bind(mcp) as (
      name: string,
      options: ToolRegistrationOptions,
      handler: (
        args: unknown,
        extra: { _meta?: unknown; signal: AbortSignal }
      ) => Promise<CallToolResult>
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
    const registerHandler = async (
      args: unknown,
      extra: { _meta?: unknown; signal: AbortSignal }
    ) => {
      try {
        extra.signal.throwIfAborted()
        const ownerId = await agentClients.owner(
          connectionId,
          extra._meta,
          mcp.server.getClientVersion()
        )
        extra.signal.throwIfAborted()
        const parsed = schema.parse(args)
        const taskId = getRecordProperty(parsed, 'taskId')
        if (
          !['manage_design_task', 'get_design_task'].includes(tool.name) &&
          typeof taskId === 'string'
        ) {
          designTasks.assertEpoch(
            taskId,
            ownerId,
            getRecordProperty(parsed, 'taskEpoch') as number | undefined
          )
          designTasks.touch(taskId, ownerId)
        }
        // Task binding may already have reached Figma. Cancel only the consumer's
        // wait; the handler still observes its definitive result and settles state.
        return await waitForLocalResult(handler(parsed, ownerId, extra.signal), extra.signal)
      } catch (error) {
        log.error({ tool: tool.name, error }, 'Local tool invocation failed.')
        return createToolErrorResponse(tool.name, error)
      }
    }

    registerToolFn(tool.name, registrationOptions, registerHandler)
  }

  function waitForLocalResult(
    result: Promise<CallToolResult>,
    signal: AbortSignal
  ): Promise<CallToolResult> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      void result.then(
        (value) => {
          signal.removeEventListener('abort', abort)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        }
      )
    })
  }

  function createToolResponse<Name extends RegisteredTool['name']>(
    toolName: Name,
    payload: ToolResultMap[Name],
    {
      runtime,
      includeLocalAssetPaths = true,
      notice
    }: {
      runtime?: AuthoringRuntimeEvidence
      includeLocalAssetPaths?: boolean
      notice?: string
    } = {}
  ): ToolResponse {
    const enrichedPayload = (() => {
      if (includeLocalAssetPaths && (toolName === 'get_code' || toolName === 'get_screenshot')) {
        const read = payload as ToolResultMap['get_code' | 'get_screenshot']
        if ('results' in read) {
          return {
            ...read,
            results: read.results.map((entry) =>
              entry.result ? { ...entry, result: addReadLocalAssetPaths(entry.result) } : entry
            )
          }
        }
        return addReadLocalAssetPaths(read)
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
        rawResult = {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(enrichedPayload, null, 2) ?? 'undefined' }]
        }
      }
    } else {
      rawResult = coercePayloadToToolResponse(enrichedPayload)
    }

    if (notice) {
      rawResult = {
        ...rawResult,
        content: [{ type: 'text', text: notice }, ...rawResult.content]
      }
    }
    const resultBytes = measureCallToolResultBytes(rawResult)
    if (resultBytes > MCP_TOOL_INLINE_BUDGET_BYTES) {
      if (includeLocalAssetPaths && (toolName === 'get_code' || toolName === 'get_screenshot')) {
        return createToolResponse(toolName, payload, {
          runtime,
          notice,
          includeLocalAssetPaths: false
        })
      }
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

  function addReadLocalAssetPaths(result: GetCodeResult | GetScreenshotResult) {
    if ('asset' in result) return { ...result, asset: addLocalAssetPath(result.asset) }
    return result.assets ? { ...result, assets: result.assets.map(addLocalAssetPath) } : result
  }

  function addLocalAssetPath(asset: AssetDescriptor): AssetDescriptor {
    const record = assetStore.get(asset.hash)
    return record && existsSync(record.filePath) ? { ...asset, localPath: record.filePath } : asset
  }

  async function handleUploadAsset(
    { dataUrl }: UploadAssetParametersInput,
    _ownerId: string,
    signal: AbortSignal
  ): Promise<ToolResponse> {
    const decoded = decodeImageDataUrl(dataUrl, maxAssetSizeBytes)
    const filename = buildAssetFilename(decoded.hash, decoded.mimeType)
    const response = await fetch(`${assetHttpServer.getBaseUrl()}/assets/${filename}`, {
      signal,
      method: 'POST',
      headers: {
        'Content-Length': String(decoded.bytes.length),
        'Content-Type': decoded.mimeType
      },
      body: new Uint8Array(decoded.bytes)
    })

    try {
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500)
        throw new Error(`Hub asset import failed (${response.status}): ${detail}`)
      }
      signal.throwIfAborted()
      const payload: UploadAssetResult = {
        assetHash: decoded.hash,
        mimeType: decoded.mimeType,
        size: decoded.bytes.length
      }
      return createUploadAssetToolResponse(payload)
    } finally {
      await response.body?.cancel().catch(() => {
        // Fetch abort or response.text() may already have closed/consumed the body.
      })
    }
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
    for (const extension of extensionRegistry.list()) {
      const message: StateMessage = {
        type: 'state',
        activeId,
        assetServerUrl: assetHttpServer.getBaseUrl(extension.legacy)
      }
      extension.ws.send(JSON.stringify(message))
    }
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
    try {
      writeHubRuntimeIdentity(HUB_RUNTIME_IDENTITY_PATH, hubRuntimeIdentity)
    } catch (error) {
      log.warn({ error }, 'Could not update Hub runtime identity.')
    }
  }

  function removeRuntimeIdentity(): void {
    try {
      removeHubRuntimeIdentityIfOwned(HUB_RUNTIME_IDENTITY_PATH, process.pid)
    } catch (error) {
      log.warn({ error }, 'Could not remove Hub runtime identity.')
    }
  }

  function flushShutdownAssets(): void {
    try {
      assetStore.flush()
    } catch (error) {
      log.warn({ error }, 'Could not flush assets during shutdown.')
    }
  }

  function shutdown(): void {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(designTaskTimer)
    clearInterval(clientCapabilityTimer)
    clearInterval(assetCleanupTimer)
    agentClients.close()
    log.info('Hub is shutting down...')
    consumerSessions.forEach((session) => {
      session.close().catch((err) => {
        log.warn({ err }, 'Failed to close MCP session during shutdown.')
      })
    })
    consumerSessions.clear()
    for (const socket of incomingSockets) socket.destroy()
    flushShutdownAssets()
    // Accepted uploads may finish after this first flush. Reflush before normal
    // exit, while store writer locks are still held, even if another listener
    // revives the event loop and Node emits beforeExit again.
    process.on('beforeExit', flushShutdownAssets)
    extensionRegistry.dispose()
    assetHttpServer.stop()
    netServer.close(() => log.info('Net server closed.'))
    wss?.close(() => log.info('WebSocket server closed.'))
    cleanupAll()
    removeRuntimeIdentity()
    void releaseHubLockIfNeeded()
    const timer = setTimeout(() => {
      log.warn('Shutdown timed out. Forcing exit.')
      flushShutdownAssets()
      process.exit(1)
    }, SHUTDOWN_TIMEOUT)
    unrefTimer(timer)
  }

  function attachConsumer(sock: Socket): void {
    const ownerId = randomUUID()
    const mcp = createMcpServer(ownerId)
    consumerSessions.add(mcp)
    consumerCount++
    log.info(`Consumer connected. Total: ${consumerCount}`)
    const transport = new ConsumerTransport(sock, sock)
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
    const closeConsumer = async () => {
      agentClients.disconnect(ownerId)
      await transport
        .close()
        .catch((closeErr) => log.warn({ err: closeErr }, 'Transport close failed.'))
      await mcp
        .close()
        .catch((closeErr) => log.warn({ err: closeErr }, 'MCP session close failed.'))
      consumerSessions.delete(mcp)
      consumerCount--
      log.info(`Consumer disconnected. Remaining: ${consumerCount}`)
      if (consumerCount === 0) {
        log.info('Last consumer disconnected. Shutting down.')
        shutdown()
      }
    }
    sock.on('close', () => {
      closeConsumer().catch((err) => log.warn({ err }, 'Consumer cleanup failed.'))
    })
  }

  const netServer = createServer((sock) => {
    // Installed lifecycle hooks issue one request without initializing MCP. Keep
    // these short connections out of tool registration and consumer ownership.
    incomingSockets.add(sock)
    let buffer = Buffer.alloc(0)
    const timeout = setTimeout(() => sock.destroy(), 5000)
    unrefTimer(timeout)
    const onError = (error: Error) => {
      log.debug({ error }, 'Rejected incoming Hub connection.')
      sock.destroy()
    }
    sock.on('error', onError)
    sock.once('close', () => {
      clearTimeout(timeout)
      incomingSockets.delete(sock)
    })
    const onData = (chunk: Buffer) => {
      try {
        if (buffer.length + chunk.length > STDIO_DEFAULT_MAX_BUFFER_SIZE)
          throw new Error('Incoming Hub frame exceeded the MCP buffer limit.')
        buffer = Buffer.concat([buffer, chunk])
        const newline = buffer.indexOf('\n')
        if (newline === -1) return
        const message = deserializeMessage(
          buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '')
        )
        sock.pause()
        sock.off('data', onData)
        if ('method' in message && message.method === 'tempad/client-hook') {
          if (!('id' in message)) throw new Error('Lifecycle hooks require a request ID.')
          const request = ClientHookRequestSchema.safeParse(message)
          const reply = request.success
            ? { result: agentClients.clientHook(request.data.params) }
            : { error: { code: -32602, message: 'Invalid lifecycle hook parameters.' } }
          sock.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply }) + '\n')
          return
        }
        clearTimeout(timeout)
        incomingSockets.delete(sock)
        sock.off('error', onError)
        sock.unshift(buffer)
        buffer = Buffer.alloc(0)
        attachConsumer(sock)
        sock.resume()
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    }
    sock.on('data', onData)
  })

  async function initializeHubRuntime(): Promise<void> {
    ensureDir(RUNTIME_DIR)
    if ((await probeSocketPath()) === 'live') {
      await exitExistingHub()
    }
    releaseHubLock = await acquireHubLock()
    await acquireStoreLocks()
    assetStore = createAssetStore()
    assetHttpServer = createAssetHttpServer(assetStore, {
      authorizeExtensionOrigin: (origin) =>
        extensionRegistry.getActive()?.origin === origin.toLowerCase()
    })
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
      if (process.platform === 'win32') {
        netServer.listen(SOCK_PATH)
        return
      }
      // Unix bind creates the inode synchronously, before the listening event.
      // It must already be private when another process first checks the path.
      const previousMask = process.umask(0o177)
      try {
        netServer.listen(SOCK_PATH)
      } finally {
        process.umask(previousMask)
      }
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
    process.stderr.write(
      `Unable to start TemPad Hub: ${error instanceof Error ? error.message : String(error)}\n`
    )
    clearInterval(designTaskTimer)
    clearInterval(clientCapabilityTimer)
    clearInterval(assetCleanupTimer)
    agentClients.close()
    assetHttpServer?.stop()
    removeRuntimeIdentity()
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
      terminalReceiptGeneration: terminalReceipts.generation,
      onToolCompletion: (message, extension) => {
        const { accepted, recovered } = terminalReceipts.accept(message, extension)
        if (recovered) {
          if (recovered.write) {
            designTasks.requireFileRead(recovered.session.fileKey)
            if (recovered.taskId) {
              const record = designTasks.find(recovered.taskId)
              if (record && record.task.epoch === (recovered.epoch ?? 0))
                record.task.needsRead = true
            }
          }
          designTasks.finishOperation(message.id, recovered.extensionId)
          reject(
            message.id,
            recovered.extensionId,
            createCodedError(
              TEMPAD_MCP_ERROR_CODES.EXTENSION_RESULT_LOST,
              'The Figma call finished, but its result was lost. Read the original target to inspect its current state before further work. Do not replay the write.'
            )
          )
        }
        return accepted
      },
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
        log.info(
          { id: extensionId },
          `Extension disconnected. Remaining: ${extensionRegistry.size}`
        )
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
        terminalReceipts.reconcile(extension)
        const snapshot = extension.sessions!
        for (const review of snapshot.reviews ?? []) {
          const session = snapshot.sessions.find((value) => value.sessionId === review.sessionId)
          if (!session) continue
          const restoredFence = designTasks.restoreReview(review.task, extension, session)
          const record = designTasks.find(review.task.taskId)
          if (
            (restoredFence || record?.extensionId === extension.id) &&
            record &&
            (record.task.reviewClosed || record.task.status === 'cancelled')
          )
            void agentClients.cancelFeedback(review.task.taskId).catch(() => {})
        }
        designTasks.reconcileSessions(snapshot.browserId, snapshot.sessions, snapshot.openTabIds)
        for (const record of designTasks.list()) {
          if (
            designTasks.current(record.task.target.fileKey) === record &&
            record.extensionId === extension.id &&
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
            .catch((error) =>
              log.warn({ error, taskId }, 'Failed to restore a refreshed Figma tab.')
            )
            .finally(() => {
              if (pendingDesignBindings.get(taskId) === binding)
                pendingDesignBindings.delete(taskId)
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
          record?.extensionId !== extension.id ||
          (record.browser && record.browser.origin !== extension.origin) ||
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
        // DELIVERY_FAILED is definitive; DISCONNECTED may follow an accepted page write.
        const definitive = error.code !== TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED
        terminalReceipts.settle(requestId, extensionId, definitive)
        designTasks.finishOperation(requestId, extensionId, definitive)
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
        terminalReceipts.settle(requestId, extensionId)
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
}
