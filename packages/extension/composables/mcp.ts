import type {
  ApplyCanvasResult,
  BridgeToPageMessage,
  DesignTask,
  DesignFeedback,
  DesignAction,
  DesignActionResult,
  DesignToolRoute,
  FeedbackDraftRequest,
  FeedbackDraftScope,
  FeedbackDraftSnapshot,
  McpBrowserStatePayload,
  PageToBridgeMessage
} from '@tempad-dev/shared'

import {
  MCP_TOOL_TIMEOUT_MS,
  DesignFeedbackSchema,
  DesignTaskSchema,
  RESUMABLE_DESIGN_TASK_STATUSES,
  TEMPAD_MCP_ERROR_CODES,
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  parseBridgeToPageMessage
} from '@tempad-dev/shared'
import { createSharedComposable, useEventListener, useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import {
  type AssetDownloader,
  type AssetUploadRequest,
  resetAssetCache,
  setAssetDownloader,
  setAssetServerUrl,
  setAssetUploader
} from '@/mcp/assets'
import { getFeedbackDraftScope } from '@/mcp/design-feedback'
import { PageDesignTasks } from '@/mcp/design-task'
import { bytesToBase64 } from '@/mcp/encoding'
import { coerceToolErrorPayload, createCodedError } from '@/mcp/errors'
import { readFigmaSession } from '@/mcp/figma-session'
import { getContainingPage, getNodeById } from '@/mcp/local-resources'
import { MCP_LOCAL_HOST_PERMISSION_ERROR, MCP_PERMISSION_REQUEST_EVENT } from '@/mcp/permissions'
import { runMcpTool } from '@/mcp/runtime'
import { observeCanvasPlacement } from '@/mcp/tools/canvas/feedback'
import { layoutReady, options, runtimeMode } from '@/ui/state'

type PendingRequest<Result> = {
  reject: (error: Error) => void
  resolve: (result: Result) => void
  timer: ReturnType<typeof setTimeout>
}
type AssetUploadResultMessage = Extract<BridgeToPageMessage, { type: 'mcp.assetUploadResult' }>
type AssetDownloadResultMessage = Extract<BridgeToPageMessage, { type: 'mcp.assetDownloadResult' }>
type AssetDownloadPayload = NonNullable<AssetDownloadResultMessage['payload']>

export const useMcp = createSharedComposable(() => {
  const sessionId = crypto.randomUUID()
  const pageMessageBase = {
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  } satisfies Pick<PageToBridgeMessage, 'sessionId' | 'source' | 'version'>

  const status = shallowRef<McpBrowserStatePayload['status']>('disabled')
  const count = shallowRef(0)
  const activeSessionId = shallowRef<string | null>(null)
  const errorMessage = shallowRef<string | null>(null)
  const designTask = shallowRef<DesignTask | null>(null)
  const dismissedTaskIds = new Set<string>()
  const taskStorageKey = 'tempad-dev:design-task'
  const dismissedStorageKey = 'tempad-dev:dismissed-design-tasks'
  const restoredTaskId = shallowRef<string | null>(null)
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(dismissedStorageKey) ?? '[]')
    if (Array.isArray(saved))
      for (const id of saved.filter((id): id is string => typeof id === 'string').slice(-256))
        dismissedTaskIds.add(id)
  } catch {
    // Current-tab controls still work when storage is unavailable.
  }
  const designTaskRestored = computed(
    () => !!designTask.value && designTask.value.taskId === restoredTaskId.value
  )
  const designActionResult = shallowRef<DesignActionResult | null>(null)
  const pendingDesignActions = new Map<
    string,
    PendingRequest<DesignActionResult> & { local: boolean }
  >()
  const pendingFeedbackDrafts = new Map<string, PendingRequest<FeedbackDraftSnapshot>>()
  const sentDesignActions = new Set<string>()
  const designAnchor = shallowRef<SceneNode | null>(null)
  let anchorRevision = 0
  const anchorStorageKey = 'tempad-dev:design-anchor'

  let enabled = false
  let disableRequested = false
  let closingReviewId: string | null = null
  let lastSessionInfo = ''
  const taskGuard = new PageDesignTasks({
    session: () => readFigmaSession(sessionId, taskGuard.busy),
    stoppedStorage: () => window.sessionStorage,
    onChange: () => {
      const previous = designTask.value
      if (taskGuard.task?.target.sessionId === sessionId) restoredTaskId.value = null
      designTask.value =
        taskGuard.task?.reviewClosed && closingReviewId === previous?.taskId
          ? previous
          : taskGuard.task &&
              !taskGuard.task.reviewClosed &&
              !dismissedTaskIds.has(taskGuard.task.taskId)
            ? { ...taskGuard.task }
            : null
      if (
        previous?.taskId !== designTask.value?.taskId ||
        previous?.target.sessionId !== designTask.value?.target.sessionId ||
        !designTask.value
      ) {
        designAnchor.value = null
        anchorRevision++
        void restoreDesignAnchor()
      }
      if (taskGuard.task?.reviewClosed && !closingReviewId) {
        dismissedTaskIds.add(taskGuard.task.taskId)
        try {
          window.sessionStorage.setItem(dismissedStorageKey, JSON.stringify([...dismissedTaskIds]))
          window.sessionStorage.removeItem(taskStorageKey)
          window.sessionStorage.removeItem(anchorStorageKey)
        } catch {
          /* The broker retains the durable Done fence. */
        }
      }
      if (designTask.value && ownsDesignTask(designTask.value)) {
        try {
          window.sessionStorage.setItem(taskStorageKey, JSON.stringify(designTask.value))
        } catch {
          // The live task remains usable without persistence.
        }
      }
      publishSessionInfo()
    }
  })
  const pendingAssetUploads = new Map<string, PendingRequest<void>>()
  const pendingAssetDownloads = new Map<string, PendingRequest<AssetDownloadPayload>>()

  const selfActive = computed(() => activeSessionId.value === sessionId)
  const needsLocalHostPermission = computed(
    () => errorMessage.value === MCP_LOCAL_HOST_PERMISSION_ERROR
  )
  const canEnable = computed(
    () => runtimeMode.value === 'standard' && options.value.mcpOn && layoutReady.value
  )

  function postPageMessage(message: PageToBridgeMessage): void {
    window.postMessage(message, location.origin)
  }

  function sendEnable() {
    disableRequested = false
    enabled = true
    status.value = 'connecting'
    errorMessage.value = null
    const document = readSessionDocument()
    if (document) restoreDesignTask()
    postPageMessage({
      ...pageMessageBase,
      type: 'mcp.enable',
      ...(designTask.value && ownsDesignTask(designTask.value)
        ? { reviewTask: designTask.value }
        : {}),
      ...(document ? { document } : {})
    })
  }

  function stop() {
    if (taskGuard.busy) {
      disableRequested = true
      stopDesignTask()
      taskGuard.connect(null)
      return
    }
    disableRequested = false
    taskGuard.connect(null)
    if (enabled) {
      enabled = false
      postPageMessage({
        ...pageMessageBase,
        type: 'mcp.disable'
      })
    }
    rejectPending(pendingDesignActions, 'Agent disconnected.')
    rejectPending(pendingFeedbackDrafts, 'Disconnected while saving.')
    sentDesignActions.clear()
    rejectPending(pendingAssetUploads, 'MCP disabled before asset upload completed.')
    rejectPending(pendingAssetDownloads, 'MCP disabled before asset download completed.')
    count.value = 0
    activeSessionId.value = null
    setAssetServerUrl(null)
    resetAssetCache()
    status.value = 'disabled'
    errorMessage.value = null
  }

  function handleBridgeMessage(event: MessageEvent<unknown>): void {
    if (event.source !== window || event.origin !== location.origin) return

    const message = parseBridgeToPageMessage(event.data)
    if (!message) return
    if (!enabled) return

    if (message.type === 'mcp.assetUploadResult') {
      handleAssetUploadResult(message)
      return
    }
    if (message.type === 'mcp.assetDownloadResult') {
      handleAssetDownloadResult(message)
      return
    }

    if (message.type === 'mcp.feedbackDraftsResult') {
      if (message.sessionId !== sessionId) return
      const pending = takePending(pendingFeedbackDrafts, message.requestId)
      if (message.error) pending?.reject(new Error(message.error.message))
      else pending?.resolve(message.payload!)
      return
    }

    if (message.type === 'mcp.state') {
      const state = message.payload
      if (state.sessionId !== sessionId) return
      activeSessionId.value = state.activeSessionId
      count.value = state.sessionCount
      errorMessage.value = state.errorMessage
      status.value = state.status

      taskGuard.connect(
        state.status === 'connected' && !disableRequested ? (state.gatewayId ?? null) : null
      )
      setAssetServerUrl(state.assetServerUrl ?? null)
      if (state.status !== 'connected') {
        resetAssetCache()
        // Local controls remain available while the Hub reconnects.
        for (const [requestId, pending] of pendingDesignActions) {
          if (pending.local) continue
          takePending(pendingDesignActions, requestId)?.reject(new Error('Agent disconnected.'))
          sentDesignActions.delete(requestId)
        }
      }
      return
    }

    if (message.type === 'mcp.toolCall') {
      const { name, args } = message.payload
      void processToolCall(message.callId, name, args, message.route)
    }

    if (
      message.type === 'mcp.designActionResult' &&
      sentDesignActions.has(message.result.requestId)
    ) {
      designActionResult.value = message.result
      // Acceptance ends the short transport deadline. Keep listening for a final
      // receipt; native delivery can happen much later than the initial request.
      const pending = takePending(pendingDesignActions, message.result.requestId)
      pending?.resolve(message.result)
      if (message.result.status !== 'accepted') {
        sentDesignActions.delete(message.result.requestId)
      }
    }

    if (
      message.type === 'mcp.designReviewClosed' &&
      message.fileKey === readFigmaSession(sessionId, false)?.fileKey
    )
      taskGuard.closeReview(message.taskId)

    if (message.type === 'mcp.designTaskState') {
      taskGuard.receive(message.task, message.gatewayId)
    }
  }

  useEventListener(window, 'message', handleBridgeMessage)
  useIntervalFn(() => {
    taskGuard.expire()
    publishSessionInfo()
  }, 1000)
  setAssetUploader(uploadAsset)
  setAssetDownloader(downloadAsset)

  watch(
    canEnable,
    (shouldEnable) => {
      if (shouldEnable) {
        sendEnable()
      } else {
        stop()
      }
    },
    { immediate: true }
  )

  function activate() {
    if (!enabled) return
    postPageMessage({
      ...pageMessageBase,
      type: 'mcp.activateSession'
    })
  }

  function requestLocalHostPermission() {
    window.dispatchEvent(new Event(MCP_PERMISSION_REQUEST_EVENT))
    sendEnable()
  }

  async function processToolCall(
    callId: string,
    name: string,
    args: unknown,
    route?: DesignToolRoute
  ) {
    let finish: (() => void) | undefined
    let stopFeedback: (() => void) | undefined
    let result: unknown
    let error: ReturnType<typeof coerceToolErrorPayload> | undefined
    try {
      if (name === '__begin_design') {
        if (window.INITIAL_OPTIONS?.editor_type !== 'design') {
          throw Object.assign(new Error('Design tasks require an editable Figma Design file.'), {
            code: 'CANVAS_UNSUPPORTED_EDITOR'
          })
        }
        result = taskGuard.bind(args, route)
      } else {
        finish = taskGuard.enter(name, args, route)
        if (name === 'set_design_anchor') {
          result = await setDesignAnchor(args, route)
        } else {
          if (name === 'apply_canvas' && route?.taskId) {
            stopFeedback = trackCanvasAnchor(args)
          }
          // Resolve an implicit create page before asynchronous font/asset work;
          // manual page switching must not move the task's output to another page.
          const input =
            args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined
          const page = input?.page as { id?: string; pageKey?: string } | undefined
          const pinnedArgs =
            route?.taskId &&
            name === 'apply_canvas' &&
            input?.mode === 'create' &&
            !page?.id &&
            !page?.pageKey &&
            taskGuard.task
              ? { ...input, page: { ...page, id: taskGuard.task.target.pageId } }
              : args
          result = await runMcpTool(name, pinnedArgs)
          if (name === 'apply_canvas' && route?.taskId && input?.mode === 'create')
            await recordCreatedAnchor(result, route.taskId)
        }
      }
    } catch (caught: unknown) {
      error = coerceToolErrorPayload(caught)
    } finally {
      stopFeedback?.()
      finish?.()
    }
    postPageMessage({
      ...pageMessageBase,
      callId,
      ...(error ? { error } : { payload: result }),
      type: 'mcp.toolResult'
    })
    if (disableRequested) stop()
  }

  function ownsDesignTask(task: DesignTask): boolean {
    return task.target.sessionId === sessionId || task.taskId === restoredTaskId.value
  }

  function restoreDesignTask(): void {
    if (taskGuard.task) return
    try {
      const parsed = DesignTaskSchema.safeParse(
        JSON.parse(window.sessionStorage.getItem(taskStorageKey) ?? 'null')
      )
      if (
        !parsed.success ||
        dismissedTaskIds.has(parsed.data.taskId) ||
        parsed.data.status === 'cancelled' ||
        parsed.data.reviewClosed ||
        parsed.data.target.fileKey !== readFigmaSession(sessionId, false)?.fileKey
      )
        return
      restoredTaskId.value = parsed.data.taskId
      taskGuard.restore(parsed.data)
    } catch {
      // Restore only a valid task saved by this tab; never select a different file.
    }
  }

  function trackCanvasAnchor(args: unknown): () => void {
    const creating = args && typeof args === 'object' && 'mode' in args && args.mode === 'create'
    const previous = designAnchor.value
    const stop = observeCanvasPlacement((node) => {
      if (creating) bindCreatedAnchor(node)
    })
    return () => {
      stop()
      // A rolled-back first create must not prevent the next successful region binding.
      if (!previous && designAnchor.value?.removed) saveDesignAnchor(null)
    }
  }

  function bindCreatedAnchor(node: SceneNode): void {
    if (
      !designAnchor.value &&
      node.type === 'FRAME' &&
      node.parent?.type === 'PAGE' &&
      !node.removed
    )
      saveDesignAnchor(node)
  }

  async function setDesignAnchor(args: unknown, route?: DesignToolRoute) {
    const task = taskGuard.task
    if (!route?.taskId || !task || task.taskId !== route.taskId)
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_INACTIVE,
        'A bound active design task is required.'
      )
    const nodeId = args && typeof args === 'object' && 'nodeId' in args ? args.nodeId : undefined
    const node = typeof nodeId === 'string' ? await getNodeById(nodeId) : null
    if (
      taskGuard.task?.taskId !== task.taskId ||
      taskGuard.task.status !== 'active' ||
      taskGuard.task.epoch !== task.epoch ||
      readFigmaSession(sessionId, taskGuard.busy)?.fileKey !== task.target.fileKey
    )
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_INACTIVE,
        'The design task changed while resolving its anchor.'
      )
    const page = node ? getContainingPage(node) : null
    if (!node || node.removed || node.type !== 'FRAME' || !page)
      throw createCodedError(
        TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
        'Choose an existing Frame as the design region.'
      )
    saveDesignAnchor(node)
    return { nodeId: node.id, pageId: page.id }
  }

  function saveDesignAnchor(node: SceneNode | null): void {
    anchorRevision++
    designAnchor.value = node
    const task = designTask.value
    if (!task || !ownsDesignTask(task)) return
    try {
      if (node)
        window.sessionStorage.setItem(
          anchorStorageKey,
          JSON.stringify({ taskId: task.taskId, fileKey: task.target.fileKey, nodeId: node.id })
        )
      else window.sessionStorage.removeItem(anchorStorageKey)
    } catch {
      // Storage is best effort; current-tab controls must still work.
    }
  }

  async function restoreDesignAnchor(): Promise<void> {
    const task = designTask.value
    if (!task || task.status === 'cancelled') return
    const revision = anchorRevision
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(anchorStorageKey) ?? 'null')
      if (
        saved?.taskId !== task.taskId ||
        saved?.fileKey !== task.target.fileKey ||
        typeof saved?.nodeId !== 'string'
      )
        return
      if (!ownsDesignTask(task)) {
        if (!RESUMABLE_DESIGN_TASK_STATUSES.includes(task.status)) return
        // An existing saved anchor also identifies this tab's task after upgrading.
        restoredTaskId.value = task.taskId
      }
      const node = await getNodeById(saved.nodeId)
      if (
        revision !== anchorRevision ||
        designTask.value?.taskId !== task.taskId ||
        !designTask.value ||
        !ownsDesignTask(designTask.value) ||
        designTask.value?.status === 'cancelled' ||
        readFigmaSession(sessionId, taskGuard.busy)?.fileKey !== task.target.fileKey
      )
        return
      if (node && !node.removed && node.type === 'FRAME' && getContainingPage(node))
        designAnchor.value = node
    } catch {
      // Missing native nodes or unavailable storage leave controls in the panel.
    }
  }

  async function recordCreatedAnchor(result: unknown, taskId: string): Promise<void> {
    const revision = anchorRevision
    try {
      const applied = result as ApplyCanvasResult
      if (
        designTask.value?.taskId !== taskId ||
        designAnchor.value ||
        !applied?.mutationCount ||
        !applied.rootNodeId
      )
        return
      const node = await getNodeById(applied.rootNodeId)
      if (
        revision === anchorRevision &&
        taskId === designTask.value?.taskId &&
        node?.type === 'FRAME' &&
        !node.removed
      )
        bindCreatedAnchor(node)
    } catch {
      // Anchor bookkeeping must not turn a successful native write into a failure.
    }
  }

  function readSessionDocument() {
    const session = readFigmaSession(sessionId, taskGuard.busy)
    if (!session) return undefined
    const { sessionId: _sessionId, ...document } = session
    return document
  }

  function publishSessionInfo() {
    if (!enabled) return
    const document = readSessionDocument()
    if (!document) return
    const serialized = JSON.stringify(document)
    if (serialized === lastSessionInfo) return
    lastSessionInfo = serialized
    postPageMessage({ ...pageMessageBase, type: 'mcp.sessionInfo', document })
  }

  async function closeDesignReview(taskId: string): Promise<void> {
    const task = designTask.value
    if (!task || task.taskId !== taskId) throw new Error('This review has changed.')
    closingReviewId = taskId
    try {
      const result = await sendDesignAction({
        requestId: crypto.randomUUID(),
        taskId,
        epoch: task.epoch ?? 0,
        action: 'done'
      })
      if (result.status === 'failed') throw new Error(result.message)
    } catch (error) {
      closingReviewId = null
      throw error
    }
  }

  function dismissDesignTask(taskId: string) {
    const task = designTask.value
    if (task?.taskId !== taskId || !['completed', 'cancelled'].includes(task.status)) return
    closingReviewId = null
    // Acknowledge the terminal UI binding; keep the execution fence against delayed calls.
    dismissedTaskIds.add(taskId)
    if (dismissedTaskIds.size > 256)
      dismissedTaskIds.delete(dismissedTaskIds.values().next().value!)
    taskGuard.acknowledge(taskId)
    try {
      window.sessionStorage.setItem(dismissedStorageKey, JSON.stringify([...dismissedTaskIds]))
      if (ownsDesignTask(task)) window.sessionStorage.removeItem(taskStorageKey)
    } catch {
      // Acknowledgement still applies to the live page if storage is unavailable.
    }
    saveDesignAnchor(null)
    designTask.value = null
    designActionResult.value = null
  }

  function stopDesignTask() {
    const taskId = designTask.value?.taskId
    if (!taskId) return
    taskGuard.stop(taskId)
    const task = designTask.value!
    void sendDesignAction({
      requestId: crypto.randomUUID(),
      taskId,
      epoch: task.epoch ?? 0,
      action: 'stop'
    }).catch(() => undefined)
  }

  function sendDesignAction(
    action: DesignAction,
    draftScope?: FeedbackDraftScope
  ): Promise<DesignActionResult> {
    if (!enabled || (!['stop', 'done'].includes(action.action) && status.value !== 'connected'))
      return Promise.reject(new Error('The agent connection is unavailable.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingDesignActions.delete(action.requestId)
        const result: DesignActionResult = {
          requestId: action.requestId,
          taskId: action.taskId,
          status: 'failed',
          message: 'Sending timed out.'
        }
        designActionResult.value = result
        reject(new Error(result.message))
      }, 30000)
      pendingDesignActions.set(action.requestId, {
        resolve,
        reject,
        timer,
        local: ['stop', 'done'].includes(action.action)
      })
      sentDesignActions.add(action.requestId)
      if (sentDesignActions.size > 1024)
        sentDesignActions.delete(sentDesignActions.values().next().value!)
      postPageMessage({
        ...pageMessageBase,
        type: 'mcp.designAction',
        action,
        ...(draftScope ? { draftScope } : {})
      })
    })
  }

  async function sendDesignFeedback(input: DesignFeedback): Promise<DesignActionResult> {
    const task = designTask.value
    const session = readFigmaSession(sessionId, taskGuard.busy)
    const feedback = DesignFeedbackSchema.parse(input)
    if (
      !task ||
      !session ||
      session.fileKey !== task.target.fileKey ||
      feedback.fileKey !== session.fileKey
    )
      throw new Error('The design task is no longer available in this file.')
    const scope = getFeedbackDraftScope(task)
    if (!scope) throw new Error('Agent not connected.')
    // The saved drafts already own their element identities. Never read the send-time selection.
    return sendDesignAction(
      {
        requestId: feedback.id,
        taskId: task.taskId,
        epoch: task.epoch ?? 0,
        action: 'feedback',
        feedback
      },
      scope
    )
  }

  function requestFeedbackDrafts(request: FeedbackDraftRequest): Promise<FeedbackDraftSnapshot> {
    const session = readFigmaSession(sessionId, taskGuard.busy)
    if (!enabled || session?.fileKey !== request.scope.fileKey)
      return Promise.reject(new Error('Comments are unavailable in this file.'))
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const timer = setTimeout(() => {
        pendingFeedbackDrafts.delete(requestId)
        reject(new Error('Saving timed out.'))
      }, 8000)
      pendingFeedbackDrafts.set(requestId, { resolve, reject, timer })
      postPageMessage({ ...pageMessageBase, type: 'mcp.feedbackDrafts', requestId, request })
    })
  }

  function uploadAsset(request: AssetUploadRequest): Promise<void> {
    return sendAssetRequest(pendingAssetUploads, 'upload', (requestId) =>
      postPageMessage({
        ...pageMessageBase,
        payload: {
          base64: bytesToBase64(request.bytes),
          hash: request.hash,
          metadata: request.metadata,
          mimeType: request.mimeType
        },
        requestId,
        type: 'mcp.uploadAsset'
      })
    )
  }

  function handleAssetUploadResult(message: AssetUploadResultMessage): void {
    if (message.sessionId !== sessionId) return
    const pending = takePending(pendingAssetUploads, message.requestId)
    if (!pending) return
    if (message.error) {
      pending.reject(new Error(message.error.message))
      return
    }
    pending.resolve()
  }

  function downloadAsset(hash: string): ReturnType<AssetDownloader> {
    return sendAssetRequest(pendingAssetDownloads, 'download', (requestId) =>
      postPageMessage({
        ...pageMessageBase,
        payload: { hash },
        requestId,
        type: 'mcp.downloadAsset'
      })
    )
  }

  function sendAssetRequest<Result>(
    pendingRequests: Map<string, PendingRequest<Result>>,
    action: 'download' | 'upload',
    send: (requestId: string) => void
  ): Promise<Result> {
    if (!enabled) {
      return Promise.reject(new Error('MCP is not connected.'))
    }
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId)
        reject(new Error(`MCP asset ${action} timed out.`))
      }, MCP_TOOL_TIMEOUT_MS)
      pendingRequests.set(requestId, { reject, resolve, timer })
      try {
        send(requestId)
      } catch (error) {
        pendingRequests.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(`Failed to request asset ${action}.`))
      }
    })
  }

  function handleAssetDownloadResult(message: AssetDownloadResultMessage): void {
    if (message.sessionId !== sessionId) return
    const pending = takePending(pendingAssetDownloads, message.requestId)
    if (!pending) return
    if (message.error) {
      pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
      return
    }
    pending.resolve(message.payload!)
  }

  function takePending<Result>(
    requests: Map<string, PendingRequest<Result>>,
    requestId: string
  ): PendingRequest<Result> | undefined {
    const pending = requests.get(requestId)
    if (!pending) return undefined
    requests.delete(requestId)
    clearTimeout(pending.timer)
    return pending
  }

  function rejectPending<Result>(
    requests: Map<string, PendingRequest<Result>>,
    message: string
  ): void {
    for (const pending of requests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    requests.clear()
  }

  return {
    designTask,
    designActionResult,
    sendDesignFeedback,
    requestFeedbackDrafts,
    designAnchor,
    designTaskRestored,
    sessionId,
    stopDesignTask,
    dismissDesignTask,
    closeDesignReview,
    status,
    count,
    selfActive,
    needsLocalHostPermission,
    errorMessage,
    activate,
    requestLocalHostPermission
  }
})
