import type {
  BridgeToPageMessage,
  McpBrowserStatePayload,
  PageToBridgeMessage
} from '@tempad-dev/shared'

import {
  MCP_TOOL_TIMEOUT_MS,
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  parseBridgeToPageMessage
} from '@tempad-dev/shared'
import { createSharedComposable, useEventListener } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import {
  type AssetDownloader,
  type AssetUploadRequest,
  resetAssetCache,
  setAssetDownloader,
  setAssetServerUrl,
  setAssetUploader
} from '@/mcp/assets'
import { bytesToBase64 } from '@/mcp/encoding'
import { coerceToolErrorPayload } from '@/mcp/errors'
import { MCP_LOCAL_HOST_PERMISSION_ERROR, MCP_PERMISSION_REQUEST_EVENT } from '@/mcp/permissions'
import { runMcpTool } from '@/mcp/runtime'
import { layoutReady, options, runtimeMode } from '@/ui/state'

type PendingAssetRequest<Result> = {
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

  let enabled = false
  const pendingAssetUploads = new Map<string, PendingAssetRequest<void>>()
  const pendingAssetDownloads = new Map<string, PendingAssetRequest<AssetDownloadPayload>>()

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
    enabled = true
    status.value = 'connecting'
    errorMessage.value = null
    postPageMessage({
      ...pageMessageBase,
      type: 'mcp.enable'
    })
  }

  function stop() {
    if (enabled) {
      enabled = false
      postPageMessage({
        ...pageMessageBase,
        type: 'mcp.disable'
      })
    }
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

    if (message.type === 'mcp.state') {
      const state = message.payload
      if (state.sessionId !== sessionId) return
      activeSessionId.value = state.activeSessionId
      count.value = state.sessionCount
      errorMessage.value = state.errorMessage
      status.value = state.status
      setAssetServerUrl(state.assetServerUrl ?? null)
      if (state.status !== 'connected') {
        resetAssetCache()
      }
      return
    }

    if (message.type === 'mcp.toolCall') {
      const { name, args } = message.payload
      void processToolCall(message.callId, name, args)
    }
  }

  useEventListener(window, 'message', handleBridgeMessage)
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

  async function processToolCall(callId: string, name: string, args: unknown) {
    try {
      const result = await runMcpTool(name, args)
      postPageMessage({
        ...pageMessageBase,
        callId,
        payload: result,
        type: 'mcp.toolResult'
      })
    } catch (error: unknown) {
      postPageMessage({
        ...pageMessageBase,
        callId,
        error: coerceToolErrorPayload(error),
        type: 'mcp.toolResult'
      })
    }
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
    pendingRequests: Map<string, PendingAssetRequest<Result>>,
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
    requests: Map<string, PendingAssetRequest<Result>>,
    requestId: string
  ): PendingAssetRequest<Result> | undefined {
    const pending = requests.get(requestId)
    if (!pending) return undefined
    requests.delete(requestId)
    clearTimeout(pending.timer)
    return pending
  }

  function rejectPending<Result>(
    requests: Map<string, PendingAssetRequest<Result>>,
    message: string
  ): void {
    for (const pending of requests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    requests.clear()
  }

  return {
    status,
    count,
    selfActive,
    needsLocalHostPermission,
    errorMessage,
    activate,
    requestLocalHostPermission
  }
})
