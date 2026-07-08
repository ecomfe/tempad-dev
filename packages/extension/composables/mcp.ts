import type { BridgeToPageMessage, PageToBridgeMessage } from '@tempad-dev/shared'

import {
  MCP_TOOL_TIMEOUT_MS,
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  parseBridgeToPageMessage
} from '@tempad-dev/shared'
import { createSharedComposable, useEventListener } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import {
  type AssetUploadRequest,
  resetUploadedAssets,
  setAssetServerUrl,
  setAssetUploader
} from '@/mcp/assets'
import { coerceToolErrorPayload } from '@/mcp/errors'
import { runMcpTool } from '@/mcp/runtime'
import { layoutReady, options, runtimeMode } from '@/ui/state'

export type McpStatus = 'disabled' | 'connecting' | 'connected' | 'error'
type PendingAssetUpload = {
  reject: (error: Error) => void
  resolve: () => void
  timer: ReturnType<typeof setTimeout>
}
type AssetUploadResultMessage = Extract<BridgeToPageMessage, { type: 'mcp.assetUploadResult' }>

export const useMcp = createSharedComposable(() => {
  const sessionId = crypto.randomUUID()
  const pageMessageBase = {
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  } satisfies Pick<PageToBridgeMessage, 'sessionId' | 'source' | 'version'>

  const status = shallowRef<McpStatus>('disabled')
  const count = shallowRef(0)
  const activeId = shallowRef<string | null>(null)
  const errorMessage = shallowRef<string | null>(null)

  let enabledWithBridge = false
  const pendingAssetUploads = new Map<string, PendingAssetUpload>()

  const selfActive = computed(() => activeId.value === sessionId)
  const canEnable = computed(
    () => runtimeMode.value === 'standard' && options.value.mcpOn && layoutReady.value
  )

  function postPageMessage(message: PageToBridgeMessage): void {
    window.postMessage(message, location.origin)
  }

  function resetState() {
    count.value = 0
    activeId.value = null
  }

  function sendEnable() {
    enabledWithBridge = true
    status.value = 'connecting'
    errorMessage.value = null
    postPageMessage({
      ...pageMessageBase,
      type: 'mcp.enable'
    })
  }

  function sendDisable() {
    if (!enabledWithBridge) return
    enabledWithBridge = false
    postPageMessage({
      ...pageMessageBase,
      type: 'mcp.disable'
    })
  }

  function start() {
    sendEnable()
  }

  function stop() {
    sendDisable()
    rejectPendingAssetUploads('MCP disabled before asset upload completed.')
    resetState()
    setAssetServerUrl(null)
    resetUploadedAssets()
    status.value = 'disabled'
    errorMessage.value = null
  }

  async function handleBridgeMessage(event: MessageEvent<unknown>) {
    if (event.source !== window || event.origin !== location.origin) return

    const message = parseBridgeToPageMessage(event.data)
    if (!message) return
    if (!enabledWithBridge) return

    if (message.type === 'mcp.assetUploadResult') {
      handleAssetUploadResult(message)
      return
    }

    if (message.type === 'mcp.state') {
      const state = message.payload
      if (state.sessionId !== sessionId) return
      activeId.value = state.activeSessionId
      count.value = state.sessionCount
      errorMessage.value = state.errorMessage
      status.value = state.status
      setAssetServerUrl(state.assetServerUrl ?? null)
      if (state.status !== 'connected') {
        resetUploadedAssets()
      }
      return
    }

    if (message.type === 'mcp.toolCall') {
      const { name, args } = message.payload
      await processToolCall(message.callId, name, args)
    }
  }

  useEventListener(window, 'message', (event: MessageEvent<unknown>) => handleBridgeMessage(event))
  setAssetUploader(uploadAssetThroughBridge)

  watch(
    canEnable,
    (enabled) => {
      if (enabled) {
        start()
      } else {
        stop()
      }
    },
    { immediate: true }
  )

  function activate() {
    if (!enabledWithBridge) return
    postPageMessage({
      ...pageMessageBase,
      type: 'mcp.activateSession'
    })
  }

  async function processToolCall(req: string, name: string, rawArgs: unknown) {
    try {
      const result = await runMcpTool(name, rawArgs)
      postPageMessage({
        ...pageMessageBase,
        callId: req,
        payload: result,
        type: 'mcp.toolResult'
      })
    } catch (error: unknown) {
      postPageMessage({
        ...pageMessageBase,
        callId: req,
        error: coerceToolErrorPayload(error),
        type: 'mcp.toolResult'
      })
    }
  }

  function uploadAssetThroughBridge(request: AssetUploadRequest): Promise<void> {
    if (!enabledWithBridge) {
      return Promise.reject(new Error('MCP is not connected.'))
    }

    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAssetUploads.delete(requestId)
        reject(new Error('MCP asset upload timed out.'))
      }, MCP_TOOL_TIMEOUT_MS)
      pendingAssetUploads.set(requestId, { reject, resolve, timer })
      try {
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
      } catch (error) {
        pendingAssetUploads.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error('Failed to request asset upload.'))
      }
    })
  }

  function handleAssetUploadResult(message: AssetUploadResultMessage): void {
    if (message.sessionId !== sessionId) return
    const pending = pendingAssetUploads.get(message.requestId)
    if (!pending) return
    pendingAssetUploads.delete(message.requestId)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(new Error(message.error.message))
      return
    }
    pending.resolve()
  }

  function rejectPendingAssetUploads(message: string): void {
    for (const pending of pendingAssetUploads.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    pendingAssetUploads.clear()
  }

  return {
    status,
    count,
    selfActive,
    errorMessage,
    activate
  }
})

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
