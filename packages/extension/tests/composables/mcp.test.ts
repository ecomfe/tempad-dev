import type { BridgeToPageMessage, PageToBridgeMessage } from '@tempad-dev/shared'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_ERROR_CODES
} from '@tempad-dev/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MCP_LOCAL_HOST_PERMISSION_ERROR, MCP_PERMISSION_REQUEST_EVENT } from '@/mcp/permissions'

const mocks = vi.hoisted(() => {
  const options = {
    value: {
      mcpOn: true
    }
  }
  const runtimeMode = { value: 'standard' }
  const layoutReady = { value: true }
  const listeners: Array<(event: MessageEvent<unknown>) => void> = []
  const window = {
    dispatchEvent: vi.fn(),
    postMessage: vi.fn()
  }

  return {
    layoutReady,
    listeners,
    options,
    resetAssetCache: vi.fn(),
    runtimeMode,
    setAssetDownloader: vi.fn(),
    setAssetServerUrl: vi.fn(),
    setAssetUploader: vi.fn(),
    window
  }
})

vi.mock('vue', () => ({
  computed: (getter: () => unknown) => ({
    get value() {
      return getter()
    }
  }),
  shallowRef: (value: unknown) => ({ value }),
  watch: (
    source: { value: unknown },
    callback: (value: unknown) => void,
    options?: { immediate?: boolean }
  ) => {
    if (options?.immediate) {
      callback(source.value)
    }
    return vi.fn()
  }
}))

vi.mock('@vueuse/core', () => ({
  createSharedComposable: <T extends (...args: never[]) => unknown>(composable: T) => composable,
  useEventListener: (
    _target: Window,
    type: string,
    listener: (event: MessageEvent<unknown>) => void
  ) => {
    expect(type).toBe('message')
    mocks.listeners.push(listener)
    return vi.fn()
  }
}))

vi.mock('@/mcp/assets', () => ({
  resetAssetCache: mocks.resetAssetCache,
  setAssetDownloader: mocks.setAssetDownloader,
  setAssetServerUrl: mocks.setAssetServerUrl,
  setAssetUploader: mocks.setAssetUploader
}))

vi.mock('@/mcp/errors', () => ({
  coerceToolErrorPayload: vi.fn()
}))

vi.mock('@/mcp/runtime', () => ({
  runMcpTool: vi.fn()
}))

vi.mock('@/ui/state', () => ({
  layoutReady: mocks.layoutReady,
  options: mocks.options,
  runtimeMode: mocks.runtimeMode
}))

import { useMcp } from '@/composables/mcp'

const ORIGIN = 'https://www.figma.com'

function getPostedMessage(type: PageToBridgeMessage['type']): PageToBridgeMessage {
  const message = mocks.window.postMessage.mock.calls
    .map(([payload]) => payload as PageToBridgeMessage)
    .find((payload) => payload.type === type)
  if (!message) {
    throw new Error(`Expected ${type} message`)
  }
  return message
}

function bridgeState(
  sessionId: string,
  status: 'connected' | 'connecting',
  errorMessage: string | null
): BridgeToPageMessage {
  return {
    payload: {
      activeSessionId: status === 'connected' ? sessionId : null,
      assetServerUrl: null,
      errorMessage,
      sessionCount: status === 'connected' ? 1 : 0,
      sessionId,
      status
    },
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.state',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function receive(message: BridgeToPageMessage): void {
  const listener = mocks.listeners[0]
  if (!listener) {
    throw new Error('Expected MCP message listener')
  }
  listener({
    data: message,
    origin: ORIGIN,
    source: mocks.window
  } as unknown as MessageEvent<unknown>)
}

describe('composables/mcp', () => {
  beforeEach(() => {
    mocks.options.value.mcpOn = true
    mocks.runtimeMode.value = 'standard'
    mocks.layoutReady.value = true
    mocks.listeners.length = 0
    mocks.window.dispatchEvent.mockReset()
    mocks.window.postMessage.mockReset()
    mocks.resetAssetCache.mockReset()
    mocks.setAssetDownloader.mockReset()
    mocks.setAssetServerUrl.mockReset()
    mocks.setAssetUploader.mockReset()
    vi.stubGlobal('window', mocks.window)
    vi.stubGlobal('location', { origin: ORIGIN })
  })

  it('keeps MCP enabled while retrying local-host permission', () => {
    const mcp = useMcp()
    const sessionId = getPostedMessage('mcp.enable').sessionId

    receive(bridgeState(sessionId, 'connecting', MCP_LOCAL_HOST_PERMISSION_ERROR))

    expect(mcp.needsLocalHostPermission.value).toBe(true)
    expect(mocks.options.value.mcpOn).toBe(true)
    expect(
      mocks.window.postMessage.mock.calls.some(
        ([payload]) => (payload as PageToBridgeMessage).type === 'mcp.disable'
      )
    ).toBe(false)

    mocks.window.postMessage.mockClear()
    mcp.requestLocalHostPermission()

    expect(mocks.window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: MCP_PERMISSION_REQUEST_EVENT })
    )
    expect(getPostedMessage('mcp.enable')).toMatchObject({ sessionId, type: 'mcp.enable' })
  })

  it('keeps a previously enabled MCP setting when permission is already granted', () => {
    const mcp = useMcp()
    const sessionId = getPostedMessage('mcp.enable').sessionId

    receive(bridgeState(sessionId, 'connected', null))

    expect(mcp.needsLocalHostPermission.value).toBe(false)
    expect(mocks.options.value.mcpOn).toBe(true)
    expect(
      mocks.window.postMessage.mock.calls.some(
        ([payload]) => (payload as PageToBridgeMessage).type === 'mcp.disable'
      )
    ).toBe(false)
  })

  it('routes asset downloads through the active browser session', async () => {
    useMcp()
    const sessionId = getPostedMessage('mcp.enable').sessionId
    const download = mocks.setAssetDownloader.mock.calls[0]?.[0] as
      | ((hash: string) => Promise<{ base64: string; mimeType: string; size: number }>)
      | undefined
    expect(download).toBeTypeOf('function')

    const pending = download!('a'.repeat(64))
    const request = getPostedMessage('mcp.downloadAsset') as Extract<
      PageToBridgeMessage,
      { type: 'mcp.downloadAsset' }
    >
    receive({
      payload: { base64: 'AQID', mimeType: 'image/png', size: 3 },
      requestId: request.requestId,
      sessionId,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetDownloadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })

    await expect(pending).resolves.toEqual({
      base64: 'AQID',
      mimeType: 'image/png',
      size: 3
    })

    mocks.window.postMessage.mockClear()
    const failed = download!('b'.repeat(64))
    const failedRequest = getPostedMessage('mcp.downloadAsset') as Extract<
      PageToBridgeMessage,
      { type: 'mcp.downloadAsset' }
    >
    receive({
      error: {
        code: TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
        message: 'Asset not found.'
      },
      requestId: failedRequest.requestId,
      sessionId,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetDownloadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })

    await expect(failed).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
      message: 'Asset not found.'
    })
  })

  it('routes asset uploads through the same request lifecycle', async () => {
    useMcp()
    const sessionId = getPostedMessage('mcp.enable').sessionId
    const upload = mocks.setAssetUploader.mock.calls[0]?.[0] as
      | ((request: {
          bytes: Uint8Array
          hash: string
          metadata?: { width?: number }
          mimeType: string
        }) => Promise<void>)
      | undefined
    expect(upload).toBeTypeOf('function')

    const pending = upload!({
      bytes: new Uint8Array([1, 2, 3]),
      hash: 'c'.repeat(64),
      metadata: { width: 12 },
      mimeType: 'image/png'
    })
    const request = getPostedMessage('mcp.uploadAsset') as Extract<
      PageToBridgeMessage,
      { type: 'mcp.uploadAsset' }
    >
    expect(request.payload).toEqual({
      base64: 'AQID',
      hash: 'c'.repeat(64),
      metadata: { width: 12 },
      mimeType: 'image/png'
    })
    receive({
      requestId: request.requestId,
      sessionId,
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetUploadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })

    await expect(pending).resolves.toBeUndefined()
  })
})
