import type {
  BridgeToPageMessage,
  DesignTaskStateMessage,
  DesignActionResult,
  FeedbackDraftScope,
  DesignTask,
  McpBrowserStatePayload,
  PageToBridgeMessage,
  RuntimeHelloMessage,
  TempadMcpErrorCode,
  ToolCallMessage
} from '@tempad-dev/shared'

import {
  MCP_MAX_ASSET_BYTES,
  TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_ERROR_CODES,
  TEMPAD_MCP_FIGMA_ORIGIN,
  TEMPAD_MCP_SESSION_PORT_NAME,
  parsePageToBridgeMessage
} from '@tempad-dev/shared'

import type { McpBrokerPort } from './sessions'

import { readBoundedResponseBytes } from '../bounded-response'
import { getFeedbackDraftScope } from '../design-feedback'
import { base64ToBytes, bytesToBase64, digestMatchesAssetHash, sha256Hex } from '../encoding'
import { coerceToolErrorPayload, createCodedError } from '../errors'
import {
  MCP_LOCAL_HOST_ORIGIN,
  MCP_LOCAL_HOST_PERMISSION_ERROR,
  MCP_PERMISSION_CHANGE_MESSAGE,
  type McpPermissionMessageType,
  type McpPermissionResponse,
  isMcpPermissionMessage
} from '../permissions'
import { DesignReviews } from './design-reviews'
import { FeedbackDraftStore } from './feedback-drafts'
import { McpHubClient } from './hub-client'
import { createSerialQueue } from './serial'
import { McpSessionRegistry } from './sessions'

type PageEnableMessage = Extract<PageToBridgeMessage, { type: 'mcp.enable' }>
const BADGE_SELECTION_KEY = 'tempad.mcp.badge-selection'
type BadgeSelection = { sessionId: string; tabId: number; documentId: string; fileKey: string }
type AssetUploadMessage = Extract<PageToBridgeMessage, { type: 'mcp.uploadAsset' }>
type AssetDownloadMessage = Extract<PageToBridgeMessage, { type: 'mcp.downloadAsset' }>
type AssetDownloadResultPayload = NonNullable<
  Extract<BridgeToPageMessage, { type: 'mcp.assetDownloadResult' }>['payload']
>

export type McpBrokerHubClient = Pick<
  McpHubClient,
  | 'getSnapshot'
  | 'sendActivate'
  | 'sendToolResult'
  | 'sendSessions'
  | 'sendDesignAction'
  | 'start'
  | 'stop'
>

export class McpServiceWorkerBroker {
  private browserId: string = crypto.randomUUID()
  private readonly identityReady: Promise<void>
  private readonly selectionReady: Promise<void>
  private readonly serializeSelection = createSerialQueue()
  private selection: BadgeSelection | null | undefined
  private selectionRevision = 0
  private tabRevision = 0
  private connectedHubId: string | null = null
  private permissionMissing = false
  private permissionRevision = 0
  private permissionChangeRevision = 0
  private readonly hubClient: McpBrokerHubClient
  private readonly pendingToolCalls = new Map<string, string>()
  private readonly portSessions = new WeakMap<McpBrokerPort, string>()
  private readonly sessions = new McpSessionRegistry()
  private readonly serializeTaskState = createSerialQueue()
  private reviewStore: DesignReviews | undefined
  private readonly restoredReviews = new Map<string, string>()
  private feedbackDraftStore: FeedbackDraftStore | undefined
  private readonly designTasks = new Map<string, DesignTask>()

  constructor(hubClient?: McpBrokerHubClient) {
    this.hubClient =
      hubClient ??
      new McpHubClient(
        {
          onSnapshot: (snapshot) => this.handleHubSnapshot(snapshot),
          onToolCall: (message) => this.routeToolCall(message),
          onDesignTask: (message) => {
            void this.routeDesignTask(message).catch(() => {
              /* Retry on the next session update. */
            })
          },
          onDesignActionResult: (message) => {
            void this.handleDesignActionResult(message.sessionId, message.result)
          }
        },
        undefined,
        extensionRuntimeIdentity()
      )
    this.selectionReady = this.loadSelection()
    this.identityReady = Promise.all([
      hubClient ? undefined : this.initializeBrowserIdentity(),
      this.selectionReady
    ]).then(() => {})
  }

  start(): void {
    browser.permissions?.onAdded?.addListener((permissions) => {
      if (!permissions.origins?.includes(MCP_LOCAL_HOST_ORIGIN)) return
      void this.restorePermission().catch(() => {
        // A tab may navigate or close before the permission notification arrives.
      })
    })
    browser.permissions?.onRemoved?.addListener((permissions) => {
      if (!permissions.origins?.includes(MCP_LOCAL_HOST_ORIGIN)) return
      this.permissionRevision++
      this.permissionChangeRevision++
      this.permissionMissing = true
      this.hubClient.stop()
      this.broadcastState()
    })
    browser.tabs?.onRemoved?.addListener((tabId) => {
      this.forgetSelection((selection) => selection.tabId === tabId)
      void this.refreshOpenTabs()
    })
    browser.runtime.onConnect.addListener((port) => this.handlePort(port))
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isMcpPermissionMessage(message)) return
      // Chromium discards a promise returned from onMessage; only a literal `true`
      // keeps the channel open until sendResponse runs.
      void this.handlePermissionMessage(message.type).then(sendResponse)
      return true
    })
  }

  handlePort(port: McpBrokerPort): void {
    if (port.name !== TEMPAD_MCP_SESSION_PORT_NAME) return
    if (!this.isAllowedSender(port)) {
      port.disconnect()
      return
    }

    port.onMessage.addListener((raw) => this.handlePortMessage(port, raw))
    port.onDisconnect.addListener(() => this.handlePortDisconnect(port))
  }

  private isAllowedSender(port: McpBrokerPort): boolean {
    const senderUrl = port.sender?.url ?? port.sender?.tab?.url
    if (!senderUrl) return false
    try {
      return new URL(senderUrl).origin === TEMPAD_MCP_FIGMA_ORIGIN
    } catch {
      return false
    }
  }

  private handlePortMessage(port: McpBrokerPort, raw: unknown): void {
    const message = parsePageToBridgeMessage(raw)
    if (!message) return

    switch (message.type) {
      case 'mcp.enable':
        this.enableSession(port, message)
        break
      case 'mcp.disable':
        this.disableSession(port, message.sessionId)
        break
      case 'mcp.activateSession':
        this.activateSession(port, message.sessionId)
        break
      case 'mcp.sessionInfo': {
        if (this.portSessions.get(port) !== message.sessionId) return
        const session = this.sessions.get(message.sessionId)
        if (session) session.document = this.sessionDocument(port, message.document)
        this.restoreSelection()
        this.broadcastState()
        break
      }
      case 'mcp.designAction':
        void this.forwardDesignAction(port, message)
        break
      case 'mcp.feedbackDrafts':
        void this.handleFeedbackDrafts(port, message)
        break
      case 'mcp.toolResult':
        this.forwardToolResult(port, message)
        break
      case 'mcp.uploadAsset':
        void this.uploadAsset(port, message)
        break
      case 'mcp.downloadAsset':
        void this.downloadAsset(port, message)
        break
    }
  }

  private reviews(): DesignReviews {
    return (this.reviewStore ??= new DesignReviews(browser.storage.local))
  }

  private drafts(): FeedbackDraftStore {
    return (this.feedbackDraftStore ??= new FeedbackDraftStore(browser.storage.local))
  }

  private assertFeedbackScope(sessionId: string, scope: FeedbackDraftScope): void {
    const task = this.designTasks.get(scope.fileKey)
    if (
      this.sessions.get(sessionId)?.document?.fileKey !== scope.fileKey ||
      task?.taskId !== scope.taskId ||
      task.reviewClosed ||
      this.reviews().get(scope.fileKey)?.reviewClosed ||
      task?.target.sessionId !== sessionId ||
      task.client?.kind !== scope.clientKind ||
      task.client.sessionId !== scope.conversationId
    ) {
      throw new Error('Comments are unavailable for this task.')
    }
  }

  private async handleFeedbackDrafts(
    port: McpBrokerPort,
    message: Extract<PageToBridgeMessage, { type: 'mcp.feedbackDrafts' }>
  ): Promise<void> {
    if (this.portSessions.get(port) !== message.sessionId) return
    const reply = {
      source: TEMPAD_MCP_BROWSER_SOURCE,
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
      type: 'mcp.feedbackDraftsResult',
      requestId: message.requestId,
      sessionId: message.sessionId
    } as const
    let result: BridgeToPageMessage
    try {
      // Drafts belong to the saved task/file/conversation, not a live page or agent connection.
      if (this.sessions.get(message.sessionId)?.document?.fileKey !== message.request.scope.fileKey)
        throw new Error('Comments are unavailable in this file.')
      const review = this.reviews().get(message.request.scope.fileKey)
      if (
        !['load', 'clear'].includes(message.request.operation) &&
        review?.taskId === message.request.scope.taskId &&
        review.reviewClosed
      )
        throw new Error('This design review is closed.')
      result = { ...reply, payload: await this.drafts().request(message.request) }
    } catch (error) {
      result = {
        ...reply,
        error: { message: error instanceof Error ? error.message : 'Comments unavailable.' }
      }
    }
    try {
      port.postMessage(result)
    } catch {
      /* The local write still survives a closed tab. */
    }
  }

  private async forwardDesignAction(
    port: McpBrokerPort,
    message: Extract<PageToBridgeMessage, { type: 'mcp.designAction' }>
  ): Promise<void> {
    if (this.portSessions.get(port) !== message.sessionId) return
    try {
      await this.reviews()
        .ready()
        .catch((error) => {
          if (message.action.action !== 'stop') throw error
        })
      if (message.action.action === 'done') {
        const fileKey = this.sessions.get(message.sessionId)?.document?.fileKey
        const task = fileKey
          ? (this.designTasks.get(fileKey) ?? this.reviews().get(fileKey))
          : undefined
        if (!task || task.taskId !== message.action.taskId)
          throw new Error('This design review is unavailable.')
        if (!['completed', 'cancelled'].includes(task.status))
          throw new Error('Stop this task before closing its review.')
        const scope = getFeedbackDraftScope(task)
        const closed = await this.reviews().close(
          task,
          scope ? (values) => this.drafts().closeReview(scope, values) : undefined
        )
        this.designTasks.set(closed.target.fileKey, closed)
        // Sessions synchronize durable Done first on every reconnect. A local receipt
        // allows dismissal while the Hub is offline, without losing the closure.
        this.publishSessions()
        await this.handleDesignActionResult(message.sessionId, {
          requestId: message.action.requestId,
          taskId: task.taskId,
          status: 'delivered',
          message: 'Design review closed.'
        })
        this.broadcastReviewClosed(closed, message.sessionId)
        return
      }
      if (message.action.action === 'stop') {
        const fileKey = this.sessions.get(message.sessionId)?.document?.fileKey
        const task = fileKey
          ? (this.designTasks.get(fileKey) ?? this.reviews().get(fileKey))
          : undefined
        if (task?.taskId === message.action.taskId) {
          const stopped = { ...task, status: 'cancelled' as const, operation: null }
          this.designTasks.set(task.target.fileKey, stopped)
          await this.reviews()
            .save(stopped)
            .catch(() => {})
        }
        try {
          if (this.hubClient.getSnapshot().status === 'connected') {
            this.hubClient.sendDesignAction({
              type: 'designAction',
              sessionId: message.sessionId,
              action: message.action
            })
            return
          }
        } catch {
          // The page has already stopped the task even if host delivery fails.
        } finally {
          // Stop must reach the Hub before a cancelled snapshot makes it an already-ended no-op.
          if (task?.taskId === message.action.taskId) this.publishSessions()
        }
        await this.handleDesignActionResult(message.sessionId, {
          requestId: message.action.requestId,
          taskId: message.action.taskId,
          status: 'delivered',
          message: 'Design task stopped. Agent interruption is unavailable.'
        })
        return
      }
      if (message.action.feedback) {
        if (!message.draftScope || message.draftScope.taskId !== message.action.taskId)
          throw new Error('Comments are unavailable for this task.')
        this.assertFeedbackScope(message.sessionId, message.draftScope)
        await this.drafts().recordSubmission(message.draftScope, message.action.feedback)
      }
      this.hubClient.sendDesignAction({
        type: 'designAction',
        sessionId: message.sessionId,
        action: message.action
      })
    } catch (error) {
      await this.handleDesignActionResult(message.sessionId, {
        requestId: message.action.requestId,
        taskId: message.action.taskId,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Feedback could not be sent.'
      })
    }
  }

  private async handleDesignActionResult(
    sessionId: string,
    result: DesignActionResult
  ): Promise<void> {
    if (result.status !== 'accepted') {
      try {
        await this.drafts().settle(result.requestId, result.status)
      } catch {
        result = {
          ...result,
          status: 'failed',
          message: 'Could not update saved comments.'
        }
      }
    }
    try {
      this.sessions.get(sessionId)?.port.postMessage({
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        type: 'mcp.designActionResult',
        result
      } satisfies BridgeToPageMessage)
    } catch {
      /* The original page may be closed; persisted receipts still settle its drafts. */
    }
  }

  private async restorePermission(): Promise<void> {
    const { granted } = await this.handlePermissionMessage('mcp.permissions.contains')
    if (!granted) return
    // Initially denied pages have no registered port. Wake only Figma content scripts;
    // each enabled script rechecks permission before opening its own port.
    const tabs = await browser.tabs.query({ url: `${TEMPAD_MCP_FIGMA_ORIGIN}/*` })
    await Promise.allSettled(
      tabs.flatMap((tab) =>
        tab.id === undefined
          ? []
          : [browser.tabs.sendMessage(tab.id, MCP_PERMISSION_CHANGE_MESSAGE)]
      )
    )
  }

  private async handlePermissionMessage(
    type: McpPermissionMessageType
  ): Promise<McpPermissionResponse> {
    // The sender's user activation only survives the synchronous part of the
    // listener, so request() cannot wait on a contains() check first. Re-requesting
    // an already granted origin is a no-op.
    const method = type === 'mcp.permissions.request' ? 'request' : 'contains'
    const revision = ++this.permissionRevision
    const changeRevision =
      method === 'request' ? ++this.permissionChangeRevision : this.permissionChangeRevision
    let granted = false
    try {
      granted = await browser.permissions[method]({ origins: [MCP_LOCAL_HOST_ORIGIN] })
    } catch {
      // A failed check cannot authorize loopback access.
    }
    // Background checks cannot supersede an open user prompt. A newer prompt or
    // revocation can; accepting a prompt also invalidates checks made while it was open.
    if (
      method === 'request'
        ? changeRevision !== this.permissionChangeRevision
        : revision !== this.permissionRevision
    )
      return { granted: !this.permissionMissing }
    const acceptedRevision = method === 'request' ? ++this.permissionRevision : revision
    const wasMissing = this.permissionMissing
    this.permissionMissing = !granted
    if (granted)
      void this.identityReady.then(() => {
        if (acceptedRevision === this.permissionRevision && this.sessions.size > 0)
          this.hubClient.start()
      })
    else this.hubClient.stop()
    if (wasMissing !== this.permissionMissing) this.broadcastState()
    return { granted }
  }

  private enableSession(port: McpBrokerPort, message: PageEnableMessage): void {
    const existingSessionId = this.portSessions.get(port)
    if (existingSessionId && existingSessionId !== message.sessionId) {
      this.unregisterSession(
        existingSessionId,
        'Figma session was replaced before providing a result.'
      )
    }
    const existingSession = this.sessions.get(message.sessionId)
    if (existingSession && existingSession.port !== port) {
      if (
        existingSession.port.sender?.tab?.id !== port.sender?.tab?.id ||
        existingSession.port.sender?.documentId !== port.sender?.documentId
      )
        return
      this.portSessions.delete(existingSession.port)
    }

    if (message.reviewTask && message.reviewTask.target.fileKey === message.document?.fileKey) {
      const saved = message.reviewTask
      void this.reviews()
        .restore(saved)
        .finally(() => {
          if (this.portSessions.get(port) !== message.sessionId) return
          this.restoredReviews.set(message.sessionId, saved.taskId)
          this.publishSessions()
          const review = this.reviews().get(saved.target.fileKey)
          if (review?.reviewClosed) this.broadcastReviewClosed(review)
        })
        .catch(() => {
          /* Keep the saved page and drafts available if storage is unavailable. */
        })
    }
    this.tabRevision++
    this.portSessions.set(port, message.sessionId)
    this.sessions.register({
      port,
      sessionId: message.sessionId,
      document: this.sessionDocument(port, message.document)
    })
    this.restoreSelection()
    this.startHubWhenReady()
    this.broadcastState()
  }

  private startHubWhenReady(): void {
    void this.identityReady.then(() => {
      if (this.sessions.size > 0) return this.handlePermissionMessage('mcp.permissions.contains')
    })
  }

  private disableSession(port: McpBrokerPort, sessionId: string, explicit = true): void {
    const mappedSessionId = this.portSessions.get(port)
    if (mappedSessionId !== sessionId) return
    if (explicit) this.forgetSelection((selection) => selection.sessionId === sessionId)
    this.unregisterSession(sessionId, 'Figma session disconnected before providing a result.')
    this.stopHubIfIdle()
    this.broadcastState()
  }

  private activateSession(port: McpBrokerPort, sessionId: string): void {
    if (this.portSessions.get(port) !== sessionId) return
    if (!this.sessions.activate(sessionId)) return
    const session = this.sessions.get(sessionId)!
    const { tab, documentId } = port.sender ?? {}
    this.setSelection(
      tab?.id !== undefined && documentId && session.document?.fileKey
        ? { sessionId, tabId: tab.id, documentId, fileKey: session.document.fileKey }
        : null
    )
    const { activeId, registeredId } = this.hubClient.getSnapshot()
    if (registeredId && activeId !== registeredId) {
      this.hubClient.sendActivate()
    }
    this.broadcastState()
  }

  private forwardToolResult(
    port: McpBrokerPort,
    message: Extract<PageToBridgeMessage, { type: 'mcp.toolResult' }>
  ): void {
    if (this.portSessions.get(port) !== message.sessionId) return
    const pendingSessionId = this.pendingToolCalls.get(message.callId)
    if (pendingSessionId !== message.sessionId) {
      return
    }
    this.pendingToolCalls.delete(message.callId)
    this.hubClient.sendToolResult(
      message.error !== undefined
        ? { error: message.error, id: message.callId, type: 'toolResult' }
        : { id: message.callId, payload: message.payload, type: 'toolResult' }
    )
  }

  private async uploadAsset(port: McpBrokerPort, message: AssetUploadMessage): Promise<void> {
    if (this.portSessions.get(port) !== message.sessionId) return

    const { assetServerUrl } = this.hubClient.getSnapshot()
    if (!assetServerUrl) {
      this.sendAssetUploadResult(port, message, {
        code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
        message: 'Asset server URL is not configured.'
      })
      return
    }

    try {
      await uploadAssetToServer(assetServerUrl, message.payload)
      this.sendAssetUploadResult(port, message)
    } catch (error) {
      this.sendAssetUploadResult(port, message, {
        message: error instanceof Error ? error.message : 'Failed to upload asset.'
      })
    }
  }

  private async downloadAsset(port: McpBrokerPort, message: AssetDownloadMessage): Promise<void> {
    if (this.portSessions.get(port) !== message.sessionId) return
    const { assetServerUrl } = this.hubClient.getSnapshot()
    if (!assetServerUrl) {
      this.sendAssetDownloadResult(port, message, undefined, {
        code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
        message: 'Asset server URL is not configured.'
      })
      return
    }
    try {
      const payload = await downloadAssetFromServer(assetServerUrl, message.payload.hash)
      this.sendAssetDownloadResult(port, message, payload)
    } catch (error) {
      const payload = coerceToolErrorPayload(error)
      this.sendAssetDownloadResult(port, message, undefined, {
        code: payload.code ?? TEMPAD_MCP_ERROR_CODES.ASSET_BRIDGE_UNAVAILABLE,
        message: payload.message
      })
    }
  }

  private handlePortDisconnect(port: McpBrokerPort): void {
    const sessionId = this.portSessions.get(port)
    if (!sessionId) return
    this.disableSession(port, sessionId, false)
  }

  private handleHubSnapshot(snapshot: ReturnType<McpBrokerHubClient['getSnapshot']>): void {
    if (snapshot.registeredId !== this.connectedHubId) {
      this.pendingToolCalls.clear()
      if (snapshot.status === 'connected') void this.refreshOpenTabs()
    }
    if (snapshot.registeredId && snapshot.registeredId !== this.connectedHubId) {
      this.designTasks.clear()
    }
    this.connectedHubId = snapshot.registeredId
    this.broadcastState()
  }

  private routeToolCall(message: ToolCallMessage): void {
    const activeSession = message.route
      ? this.sessions.get(message.route.sessionId)
      : this.sessions.getActive()
    if (
      message.route &&
      (message.route.gatewayId !== this.connectedHubId ||
        activeSession?.document?.fileKey !== message.route.fileKey)
    ) {
      this.sendToolError(
        message.id,
        TEMPAD_MCP_ERROR_CODES.DESIGN_TARGET_CHANGED,
        'The requested Figma runtime is no longer connected. No other tab was selected.'
      )
      return
    }
    if (!activeSession) {
      this.sendToolError(
        message.id,
        TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
        'No active TemPad Dev Figma session available.'
      )
      return
    }

    const bridgeMessage: BridgeToPageMessage = {
      callId: message.id,
      ...(message.route ? { route: message.route } : {}),
      payload: message.payload,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.toolCall',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    }

    try {
      activeSession.port.postMessage(bridgeMessage)
      this.pendingToolCalls.set(message.id, activeSession.sessionId)
    } catch {
      this.unregisterSession(
        activeSession.sessionId,
        'Figma session disconnected before receiving a tool call.'
      )
      this.sendToolError(
        message.id,
        TEMPAD_MCP_ERROR_CODES.EXTENSION_DELIVERY_FAILED,
        'Figma session disconnected before receiving a tool call.'
      )
      this.stopHubIfIdle()
      this.broadcastState()
    }
  }

  private unregisterSession(sessionId: string, message: string): void {
    this.tabRevision++
    const session = this.sessions.get(sessionId)
    if (session) {
      this.portSessions.delete(session.port)
    }
    this.sessions.unregister(sessionId)
    this.restoreSelection()
    this.restoredReviews.delete(sessionId)
    this.rejectPendingForSession(sessionId, message)
    this.publishSessions()
    void this.refreshOpenTabs()
  }

  private rejectPendingForSession(sessionId: string, message: string): void {
    for (const [callId, pendingSessionId] of this.pendingToolCalls) {
      if (pendingSessionId !== sessionId) continue
      this.pendingToolCalls.delete(callId)
      this.sendToolError(callId, TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED, message)
    }
  }

  private sendToolError(callId: string, code: TempadMcpErrorCode, message: string): void {
    this.hubClient.sendToolResult({
      error: {
        code,
        message
      },
      id: callId,
      type: 'toolResult'
    })
  }

  private sendAssetUploadResult(
    port: McpBrokerPort,
    request: AssetUploadMessage,
    error?: { code?: TempadMcpErrorCode; message: string }
  ): void {
    const message: BridgeToPageMessage = {
      ...(error ? { error } : {}),
      requestId: request.requestId,
      sessionId: request.sessionId,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetUploadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    }
    try {
      port.postMessage(message)
    } catch {
      this.unregisterSession(
        request.sessionId,
        'Figma session disconnected before receiving asset upload result.'
      )
      this.stopHubIfIdle()
      this.broadcastState()
    }
  }

  private sendAssetDownloadResult(
    port: McpBrokerPort,
    request: AssetDownloadMessage,
    payload?: AssetDownloadResultPayload,
    error?: { code?: TempadMcpErrorCode; message: string }
  ): void {
    const message: BridgeToPageMessage = {
      ...(error ? { error } : { payload: payload! }),
      requestId: request.requestId,
      sessionId: request.sessionId,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetDownloadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    }
    try {
      port.postMessage(message)
    } catch {
      this.unregisterSession(
        request.sessionId,
        'Figma session disconnected before receiving asset download result.'
      )
      this.stopHubIfIdle()
      this.broadcastState()
    }
  }

  private stopHubIfIdle(): void {
    if (this.sessions.size > 0) return
    this.pendingToolCalls.clear()
    this.hubClient.stop()
  }

  private broadcastState(): void {
    const snapshot = this.hubClient.getSnapshot()
    const brokerIsActive =
      snapshot.registeredId !== null && snapshot.activeId === snapshot.registeredId
    const selectedTabUnavailable =
      this.selection != null && !this.sessions.get(this.selection.sessionId)
    const commonState = {
      activeSessionId: brokerIsActive ? this.sessions.getActiveId() : null,
      gatewayId: snapshot.registeredId,
      assetServerUrl: snapshot.assetServerUrl,
      errorMessage: this.permissionMissing
        ? MCP_LOCAL_HOST_PERMISSION_ERROR
        : (snapshot.errorMessage ??
          (selectedTabUnavailable ? 'The selected Figma tab is unavailable.' : null)),
      sessionCount: this.sessions.size,
      status: this.permissionMissing
        ? 'connecting'
        : snapshot.status === 'idle'
          ? 'disabled'
          : snapshot.status
    } satisfies Omit<McpBrowserStatePayload, 'sessionId'>

    this.publishSessions()

    let removedSession = false
    for (const session of this.sessions.list()) {
      const message: BridgeToPageMessage = {
        payload: {
          ...commonState,
          activeSessionId:
            commonState.activeSessionId === session.sessionId ? session.sessionId : null,
          sessionId: session.sessionId
        },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        type: 'mcp.state',
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      }
      try {
        session.port.postMessage(message)
      } catch {
        this.unregisterSession(
          session.sessionId,
          'Figma session disconnected before receiving MCP state.'
        )
        removedSession = true
      }
    }
    if (removedSession) {
      this.stopHubIfIdle()
      if (this.sessions.size > 0) {
        this.broadcastState()
      }
    }
  }

  private sessionDocument(port: McpBrokerPort, document: PageEnableMessage['document']) {
    if (!document) return undefined
    return {
      ...document,
      tabId: port.sender?.tab?.id,
      documentId: port.sender?.documentId
    }
  }

  private publishSessions(openTabIds?: number[]): void {
    if (this.hubClient.getSnapshot().status !== 'connected') return
    this.hubClient.sendSessions({
      type: 'sessions',
      browserId: this.browserId,
      ...(openTabIds ? { openTabIds } : {}),
      activeSessionId: this.sessions.getActiveId(),
      reviews: this.sessions.list().flatMap((session) => {
        const task = session.document && this.reviews().get(session.document.fileKey)
        return task &&
          (task.reviewClosed ||
            task.status === 'cancelled' ||
            task.target.sessionId === session.sessionId ||
            this.restoredReviews.get(session.sessionId) === task.taskId)
          ? [{ sessionId: session.sessionId, task }]
          : []
      }),
      sessions: this.sessions
        .list()
        .flatMap((session) =>
          session.document ? [{ sessionId: session.sessionId, ...session.document }] : []
        )
    })
  }

  private setSelection(selection: BadgeSelection | null): void {
    this.selection = selection
    this.selectionRevision++
    void this.serializeSelection(async () => {
      await browser.storage.session?.set({ [BADGE_SELECTION_KEY]: selection })
    }).catch(() => {
      // A storage failure must not undo the user's choice in this worker.
    })
  }

  private forgetSelection(matches: (selection: BadgeSelection) => boolean): void {
    if (this.selection && matches(this.selection)) {
      this.setSelection(null)
      this.sessions.resetActive()
      this.broadcastState()
      return
    }
    const revision = this.selectionRevision
    void this.selectionReady.then(() => {
      if (revision === this.selectionRevision && this.selection && matches(this.selection)) {
        this.setSelection(null)
        this.sessions.resetActive()
        this.broadcastState()
      }
    })
  }

  private restoreSelection(): void {
    const selected = this.selection
    if (selected === null) return
    // No other tab may become the implicit route while a saved choice is pending.
    this.sessions.resetActive(false)
    if (!selected) return
    const session = this.sessions.get(selected.sessionId)
    if (!session) {
      if (this.sessions.list().some((value) => value.port.sender?.tab?.id === selected.tabId)) {
        this.setSelection(null)
        this.sessions.resetActive()
      }
      return
    }
    const { tab, documentId } = session.port.sender ?? {}
    if (tab?.id === selected.tabId && documentId === selected.documentId) {
      // Registration may precede page identity; missing evidence is not a new file.
      if (!session.document?.fileKey) return
      if (session.document.fileKey === selected.fileKey) {
        this.sessions.activate(session.sessionId)
        return
      }
    }
    this.setSelection(null)
    this.sessions.resetActive()
  }

  private async loadSelection(): Promise<void> {
    const revision = this.selectionRevision
    try {
      const stored = await browser.storage.session?.get(BADGE_SELECTION_KEY)
      const value = stored?.[BADGE_SELECTION_KEY] as Partial<BadgeSelection> | null
      if (revision !== this.selectionRevision || !value || typeof value !== 'object') return
      if (
        typeof value.sessionId !== 'string' ||
        !value.sessionId ||
        !Number.isInteger(value.tabId) ||
        typeof value.documentId !== 'string' ||
        !value.documentId ||
        typeof value.fileKey !== 'string' ||
        !value.fileKey
      )
        return
      this.selection = value as BadgeSelection
    } catch {
      // Session storage is optional for current-worker routing.
    } finally {
      const activeSessionId = this.sessions.getActiveId()
      if (this.selection === undefined) {
        this.selection = null
        this.sessions.resetActive()
      }
      this.restoreSelection()
      if (activeSessionId !== this.sessions.getActiveId()) this.broadcastState()
    }
  }

  private async initializeBrowserIdentity(): Promise<void> {
    const key = 'tempadDevMcpBrowserId'
    try {
      const stored = await browser.storage.local.get(key)
      const value = stored[key]
      if (typeof value === 'string' && value.length > 0) this.browserId = value
      else await browser.storage.local.set({ [key]: this.browserId })
      await this.reviews().ready()
    } catch {
      // The current connection can still work; recovery will require live session evidence.
    }
  }

  private async refreshOpenTabs(): Promise<void> {
    if (typeof browser === 'undefined' || !browser.tabs?.query) return
    await this.selectionReady
    const revision = this.tabRevision
    try {
      const tabs = await browser.tabs.query({})
      // A tab registering during this query invalidates absence as destruction evidence.
      if (revision !== this.tabRevision) return
      const ids = tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]))
      this.forgetSelection((selection) => !ids.includes(selection.tabId))
      this.publishSessions(ids)
    } catch {
      // Missing inventory is not evidence that an executing tab has closed.
    }
  }

  private broadcastReviewClosed(task: DesignTask, excludeSessionId?: string): void {
    for (const session of this.sessions.list()) {
      if (
        session.sessionId === excludeSessionId ||
        session.document?.fileKey !== task.target.fileKey
      )
        continue
      try {
        session.port.postMessage({
          source: TEMPAD_MCP_BROWSER_SOURCE,
          version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
          type: 'mcp.designReviewClosed',
          taskId: task.taskId,
          fileKey: task.target.fileKey
        } satisfies BridgeToPageMessage)
      } catch {
        /* A restored page will see the same durable closure. */
      }
    }
  }

  private routeDesignTask(message: DesignTaskStateMessage): Promise<void> {
    const gatewayId = this.connectedHubId
    return this.serializeTaskState(() => this.synchronizeDesignTask(message, gatewayId))
  }

  private async synchronizeDesignTask(
    message: DesignTaskStateMessage,
    gatewayId: string | null
  ): Promise<void> {
    if (!gatewayId || gatewayId !== this.connectedHubId) return
    const fileKey = message.task.target.fileKey
    const previous = this.designTasks.get(fileKey)
    if (previous && message.task.revision < previous.revision) return
    const task = await this.reviews()
      .save(message.task)
      .catch(() => message.task)
    if (gatewayId !== this.connectedHubId) return
    this.designTasks.set(fileKey, task)
    for (const session of this.sessions.list()) {
      if (session.document?.fileKey !== fileKey) continue
      const state: BridgeToPageMessage = {
        type: 'mcp.designTaskState',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        gatewayId: this.connectedHubId,
        task
      }
      try {
        session.port.postMessage(state)
      } catch {
        this.unregisterSession(
          session.sessionId,
          'Figma session disconnected during task synchronization.'
        )
      }
    }
  }
}

function extensionRuntimeIdentity(): RuntimeHelloMessage | null {
  const manifest = browser.runtime.getManifest()
  const runtimeFingerprint = __TEMPAD_RUNTIME_FINGERPRINT__
  if (typeof runtimeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(runtimeFingerprint)) {
    return null
  }
  return {
    type: 'runtimeHello',
    protocolVersion: TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION,
    extensionVersion: manifest.version,
    extensionRuntimeFingerprint: runtimeFingerprint
  }
}

async function uploadAssetToServer(
  assetServerUrl: string,
  payload: AssetUploadMessage['payload']
): Promise<void> {
  const response = await fetch(`${assetServerUrl}/assets/${payload.hash}`, {
    body: new Blob([base64ToBytes(payload.base64)], { type: payload.mimeType }),
    headers: buildAssetUploadHeaders(payload),
    method: 'POST'
  })

  try {
    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status} ${response.statusText}`)
    }
  } finally {
    if (response.body) await response.body.cancel().catch(() => {})
  }
}

async function downloadAssetFromServer(
  assetServerUrl: string,
  hash: string
): Promise<AssetDownloadResultPayload> {
  const response = await fetch(`${assetServerUrl}/assets/${hash}`, { method: 'GET' })
  try {
    if (response.status === 404) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
        `Asset "${hash}" was not found in the local store.`
      )
    }
    if (!response.ok) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.ASSET_BRIDGE_UNAVAILABLE,
        `Asset download failed with status ${response.status} ${response.statusText}.`
      )
    }
    const tooLarge = () =>
      createCodedError(
        TEMPAD_MCP_ERROR_CODES.ASSET_TOO_LARGE,
        `Asset "${hash}" exceeds the ${MCP_MAX_ASSET_BYTES}-byte bridge limit.`
      )
    const bytes = await readBoundedResponseBytes(response, MCP_MAX_ASSET_BYTES, tooLarge)
    const actual = await sha256Hex(bytes)
    if (!digestMatchesAssetHash(actual, hash)) {
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.ASSET_HASH_MISMATCH,
        `Asset "${hash}" did not match its SHA-256 digest.`
      )
    }
    return {
      base64: bytesToBase64(bytes),
      mimeType:
        response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ||
        'application/octet-stream',
      size: bytes.byteLength
    }
  } finally {
    if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {})
  }
}

function buildAssetUploadHeaders(payload: AssetUploadMessage['payload']): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': payload.mimeType
  }
  if (payload.metadata?.width) headers['X-Asset-Width'] = String(payload.metadata.width)
  if (payload.metadata?.height) headers['X-Asset-Height'] = String(payload.metadata.height)
  if (payload.metadata?.themeable) headers['X-Asset-Themeable'] = 'true'
  return headers
}
