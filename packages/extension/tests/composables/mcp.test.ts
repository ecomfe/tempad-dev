import type { BridgeToPageMessage, DesignTask, PageToBridgeMessage } from '@tempad-dev/shared'

import {
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_ERROR_CODES
} from '@tempad-dev/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MCP_LOCAL_HOST_PERMISSION_ERROR, MCP_PERMISSION_REQUEST_EVENT } from '@/mcp/permissions'
import { reportCanvasPlacement } from '@/mcp/tools/canvas/feedback'

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
    watchCallbacks: [] as Array<() => void>,
    runMcpTool: vi.fn(),
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
    mocks.watchCallbacks.push(() => callback(source.value))
    if (options?.immediate) {
      callback(source.value)
    }
    return vi.fn()
  }
}))

vi.mock('@vueuse/core', () => ({
  useIntervalFn: vi.fn(),
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
  createCodedError: (code: string, message: string) => Object.assign(new Error(message), { code }),
  coerceToolErrorPayload: (error: Error & { code?: string }) => ({
    message: error.message,
    code: error.code
  })
}))

vi.mock('@/mcp/runtime', () => ({
  runMcpTool: mocks.runMcpTool
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
    mocks.watchCallbacks.length = 0
    mocks.runMcpTool.mockReset()
    Reflect.deleteProperty(mocks.window, 'figma')
    Reflect.deleteProperty(mocks.window, 'INITIAL_OPTIONS')
    Reflect.deleteProperty(mocks.window, 'sessionStorage')
    mocks.window.dispatchEvent.mockReset()
    mocks.window.postMessage.mockReset()
    mocks.resetAssetCache.mockReset()
    mocks.setAssetDownloader.mockReset()
    mocks.setAssetServerUrl.mockReset()
    mocks.setAssetUploader.mockReset()
    vi.stubGlobal('window', mocks.window)
    vi.stubGlobal('location', { origin: ORIGIN })
  })

  it('applies another tab’s durable Done while offline and ignores later task state', () => {
    Object.assign(mocks.window, {
      figma: { fileKey: 'file-a', root: { name: 'Design' }, currentPage: { id: 'page-a' } },
      INITIAL_OPTIONS: { editor_type: 'design' }
    })
    const mcp = useMcp()
    const connected = bridgeState(mcp.sessionId, 'connected', null)
    if (connected.type === 'mcp.state') connected.payload.gatewayId = 'gateway-a'
    receive(connected)
    const task = {
      taskId: 'task-a',
      title: 'Design',
      status: 'completed' as const,
      operation: null,
      target: { sessionId: mcp.sessionId, fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      expiresAt: 1000,
      revision: 1
    }
    const publish = (revision: number) =>
      receive({
        type: 'mcp.designTaskState',
        gatewayId: 'gateway-a',
        task: { ...task, revision },
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    publish(1)
    receive(bridgeState(mcp.sessionId, 'connecting', null))
    const close = (fileKey: string) =>
      receive({
        type: 'mcp.designReviewClosed',
        taskId: task.taskId,
        fileKey,
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    close('other-file')
    expect(mcp.designTask.value?.taskId).toBe(task.taskId)
    close('file-a')
    expect(mcp.designTask.value).toBeNull()
    receive(connected)
    publish(3)
    expect(mcp.designTask.value).toBeNull()
  })

  it('dismisses only terminal bindings without reviving late state or clearing the execution fence', () => {
    Object.assign(mocks.window, {
      figma: { fileKey: 'file-a', root: { name: 'Design' }, currentPage: { id: 'page-a' } },
      INITIAL_OPTIONS: { editor_type: 'design' }
    })
    const mcp = useMcp()
    const state = bridgeState(mcp.sessionId, 'connected', null)
    if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
    receive(state)
    const task = {
      taskId: 'task-a',
      title: 'Settings',
      status: 'active' as const,
      operation: null,
      target: { sessionId: mcp.sessionId, fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      expiresAt: Date.now() + 300000,
      revision: 1
    }
    const update = (
      value: typeof task | (Omit<typeof task, 'status'> & { status: 'completed' | 'cancelled' })
    ) =>
      receive({
        type: 'mcp.designTaskState',
        gatewayId: 'gateway-a',
        task: value,
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
      })
    update(task)
    mcp.dismissDesignTask('task-a')
    expect(mcp.designTask.value?.status).toBe('active')
    update({ ...task, status: 'cancelled', revision: 2 })
    mcp.dismissDesignTask('wrong-task')
    expect(mcp.designTask.value?.status).toBe('cancelled')
    mcp.dismissDesignTask('task-a')
    expect(mcp.designTask.value).toBeNull()
    update({ ...task, status: 'cancelled', revision: 3 })
    expect(mcp.designTask.value).toBeNull()
    receive({
      type: 'mcp.toolCall',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
      callId: 'stale-write',
      route: {
        gatewayId: 'gateway-a',
        sessionId: mcp.sessionId,
        fileKey: 'file-a',
        taskId: 'task-a'
      },
      payload: { name: 'apply_canvas', args: { mode: 'create' } }
    })
    expect(mocks.runMcpTool).not.toHaveBeenCalled()
    expect(getPostedMessage('mcp.toolResult')).toMatchObject({
      callId: 'stale-write',
      error: { code: TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_INACTIVE }
    })
    update({ ...task, taskId: 'task-b', revision: 4 })
    mcp.dismissDesignTask('task-a')
    expect(mcp.designTask.value?.taskId).toBe('task-b')
    update({ ...task, taskId: 'task-b', status: 'completed', revision: 5 })
    mcp.dismissDesignTask('task-b')
    expect(mcp.designTask.value).toBeNull()
  })

  it.each(['active', 'paused', 'expired', 'interrupted', 'completed'] as const)(
    'keeps the tab-owned %s task across refresh until Stop or Done',
    async (status) => {
      const data = new Map<string, string>()
      const storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value)
        },
        removeItem: (key: string) => {
          data.delete(key)
        }
      }
      const node = {
        id: 'frame-a',
        type: 'FRAME',
        removed: false,
        parent: { id: 'page-a', type: 'PAGE' }
      }
      const api = {
        fileKey: 'file-a',
        root: { name: 'Design' },
        currentPage: { id: 'page-a' },
        getNodeByIdAsync: vi.fn(async () => node)
      }
      Object.assign(mocks.window, { figma: api, sessionStorage: storage })
      vi.stubGlobal('figma', api)
      const first = useMcp()
      const connect = (mcp: ReturnType<typeof useMcp>) => {
        const state = bridgeState(mcp.sessionId, 'connected', null)
        if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
        receive(state)
      }
      const publish = (task: DesignTask) =>
        receive({
          type: 'mcp.designTaskState',
          task,
          gatewayId: 'gateway-a',
          source: TEMPAD_MCP_BROWSER_SOURCE,
          version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
        })
      const task: DesignTask = {
        taskId: 'task-a',
        title: 'Awaiting review',
        status,
        operation: null,
        expiresAt: Date.now() + 300000,
        revision: 1,
        target: {
          sessionId: first.sessionId,
          fileKey: 'file-a',
          fileName: 'Design',
          pageId: 'page-a'
        }
      }
      storage.setItem(
        'tempad-dev:design-anchor',
        JSON.stringify({ taskId: task.taskId, fileKey: 'file-a', nodeId: node.id })
      )
      connect(first)
      publish(task)
      await vi.waitFor(() => expect(first.designAnchor.value).toBe(node))
      expect(JSON.parse(data.get('tempad-dev:design-task')!).status).toBe(status)

      mocks.listeners.length = 0
      const refreshed = useMcp()
      expect(refreshed.sessionId).not.toBe(first.sessionId)
      expect(refreshed.designTask.value?.status).toBe(status === 'active' ? 'interrupted' : status)
      expect(refreshed.designTaskRestored.value).toBe(true)
      expect(refreshed.designTask.value?.target.sessionId).toBe(first.sessionId)
      await vi.waitFor(() => expect(refreshed.designAnchor.value).toBe(node))
      expect(mocks.runMcpTool).not.toHaveBeenCalled()
      connect(refreshed)
      publish({ ...task, revision: 2 })
      expect(refreshed.designTask.value?.status).toBe(status === 'active' ? 'paused' : status)
      if (status === 'completed') refreshed.dismissDesignTask(task.taskId)
      else {
        refreshed.stopDesignTask()
        const action = mocks.window.postMessage.mock.calls
          .map(([message]) => message)
          .findLast((message) => message.type === 'mcp.designAction').action
        receive({
          type: 'mcp.designActionResult',
          source: TEMPAD_MCP_BROWSER_SOURCE,
          version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
          result: {
            requestId: action.requestId,
            taskId: task.taskId,
            status: 'delivered',
            message: 'Stopped'
          }
        })
        expect(refreshed.designTask.value?.status).toBe('cancelled')
        refreshed.dismissDesignTask(task.taskId)
      }
      expect(refreshed.designTask.value).toBeNull()
      expect(data.has('tempad-dev:design-task')).toBe(false)
      expect(data.has('tempad-dev:design-anchor')).toBe(false)
      mocks.listeners.length = 0
      const closed = useMcp()
      expect(closed.designTask.value).toBeNull()
      connect(closed)
      publish({
        ...task,
        status: 'active',
        epoch: 3,
        revision: 3,
        target: { ...task.target, sessionId: closed.sessionId }
      })
      expect(closed.designTask.value).toBeNull()
      receive({
        type: 'mcp.toolCall',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        callId: 'stale-write',
        route: {
          gatewayId: 'gateway-a',
          sessionId: closed.sessionId,
          fileKey: 'file-a',
          taskId: task.taskId,
          epoch: 3
        },
        payload: { name: 'apply_canvas', args: { mode: 'create' } }
      })
      expect(mocks.runMcpTool).not.toHaveBeenCalled()
      expect(getPostedMessage('mcp.toolResult')).toMatchObject({
        error: { code: TEMPAD_MCP_ERROR_CODES.DESIGN_TASK_INACTIVE }
      })
    }
  )

  it.each(['wrong-file', 'malformed', 'cancelled', 'unavailable'])(
    'does not restore an unusable saved task (%s)',
    (scenario) => {
      const saved = {
        taskId: 'task-a',
        title: 'Old design',
        operation: null,
        expiresAt: 300000,
        revision: 1,
        status: scenario === 'cancelled' ? 'cancelled' : 'completed',
        target: {
          sessionId: 'old-session',
          fileKey: scenario === 'wrong-file' ? 'other-file' : 'file-a',
          fileName: 'Design',
          pageId: 'page-a'
        }
      }
      Object.assign(mocks.window, {
        figma: { fileKey: 'file-a', currentPage: { id: 'page-a' } },
        sessionStorage: {
          getItem: (key: string) => {
            if (scenario === 'unavailable') throw new Error('No storage')
            return key === 'tempad-dev:design-task'
              ? scenario === 'malformed'
                ? '{'
                : JSON.stringify(saved)
              : null
          }
        }
      })
      expect(useMcp().designTask.value).toBeNull()
    }
  )

  it.each([true, false])(
    'sends captured targets with advertised Queue %s and keeps receiving the final receipt',
    async (queue) => {
      Object.assign(mocks.window, {
        figma: {
          fileKey: 'file-a',
          root: { name: 'Design' },
          currentPage: { id: 'page-b', selection: [{ id: 'unrelated-selection' }] }
        },
        INITIAL_OPTIONS: { editor_type: 'design' }
      })
      vi.stubGlobal('location', { origin: ORIGIN, pathname: '/design/file-a/Design' })
      const mcp = useMcp()
      const sessionId = mcp.sessionId
      const state = bridgeState(sessionId, 'connected', null)
      if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
      receive(state)
      const task = {
        taskId: 'task-a',
        title: 'Settings',
        status: 'active' as const,
        operation: null,
        target: { sessionId, fileKey: 'file-a', fileName: 'Design', pageId: 'page-b' },
        client: { kind: 'codex-app' as const, name: 'Codex App', sessionId: 'thread-a' },
        capabilities: { interrupt: true, queue, steer: true, continue: false },
        expiresAt: Date.now() + 300000,
        revision: 1
      }
      receive({
        type: 'mcp.toolCall',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        callId: 'begin',
        route: { gatewayId: 'gateway-a', sessionId, fileKey: 'file-a' },
        payload: { name: '__begin_design', args: task }
      })
      const feedback = {
        id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
        mode: 'queue' as const,
        fileKey: 'file-a',
        items: [
          {
            nodeId: 'captured-node',
            nodeName: 'Heading',
            pageId: 'page-a',
            text: 'Increase spacing',
            createdAt: 1000
          }
        ],
        createdAt: 1001
      }
      const delivered = vi.fn()
      const promise = mcp.sendDesignFeedback(feedback).then(delivered)
      expect(getPostedMessage('mcp.designAction')).toMatchObject({
        action: { feedback },
        draftScope: {
          taskId: 'task-a',
          fileKey: 'file-a',
          clientKind: 'codex-app',
          conversationId: 'thread-a'
        }
      })
      receive({
        type: 'mcp.designActionResult',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        result: {
          requestId: feedback.id,
          taskId: 'task-a',
          status: 'accepted',
          message: 'Processing'
        }
      })
      await promise
      expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted' }))
      mocks.window.postMessage.mockClear()
      receive({
        type: 'mcp.designActionResult',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        result: {
          requestId: 'old-steer-control',
          taskId: 'task-a',
          status: 'delivered',
          message: 'Unrelated'
        }
      })
      expect(mcp.designActionResult.value?.requestId).toBe(feedback.id)
      expect(mcp.designActionResult.value?.status).toBe('accepted')
      receive({
        type: 'mcp.designActionResult',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        result: { requestId: feedback.id, taskId: 'task-a', status: 'delivered', message: 'Sent' }
      })
      await promise
      expect(mcp.designActionResult.value?.status).toBe('delivered')
      const scope = {
        taskId: 'task-a',
        fileKey: 'file-a',
        clientKind: 'codex-app' as const,
        conversationId: 'thread-a'
      }
      const restore = mcp.requestFeedbackDrafts({ operation: 'load', scope })
      const request = getPostedMessage('mcp.feedbackDrafts') as Extract<
        PageToBridgeMessage,
        { type: 'mcp.feedbackDrafts' }
      >
      receive({
        type: 'mcp.feedbackDraftsResult',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        sessionId,
        requestId: request.requestId,
        payload: { items: feedback.items }
      })
      await expect(restore).resolves.toEqual({ items: feedback.items })
      // Stop still reaches the broker while the Hub is offline.
      receive(bridgeState(sessionId, 'connecting', null))
      mocks.window.postMessage.mockClear()
      mcp.stopDesignTask()
      expect(mcp.designTask.value?.status).toBe('cancelled')
      const stop = getPostedMessage('mcp.designAction') as Extract<
        PageToBridgeMessage,
        { type: 'mcp.designAction' }
      >
      expect(stop.action).toMatchObject({ action: 'stop', taskId: task.taskId, epoch: 0 })
      receive({
        type: 'mcp.designActionResult',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        result: {
          requestId: stop.action.requestId,
          taskId: task.taskId,
          status: 'delivered',
          message: 'Stopped'
        }
      })
    }
  )

  it.each([undefined, { name: 'Destination' }])(
    'pins implicit creation with page %j and drains its result when disabled',
    async (page) => {
      Object.assign(mocks.window, {
        figma: { fileKey: 'file-a', root: { name: 'Design' }, currentPage: { id: 'page-a' } },
        INITIAL_OPTIONS: { editor_type: 'design' }
      })
      vi.stubGlobal('location', { origin: ORIGIN, pathname: '/design/file-a/Design' })
      const mcp = useMcp()
      const sessionId = mcp.sessionId
      const state = bridgeState(sessionId, 'connected', null)
      if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
      receive(state)
      const task = {
        taskId: 'task-a',
        title: 'Settings',
        status: 'active' as const,
        operation: null,
        target: { sessionId, fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
        expiresAt: Date.now() + 300000,
        revision: 1
      }
      const route = { gatewayId: 'gateway-a', sessionId, fileKey: 'file-a' }
      receive({
        type: 'mcp.toolCall',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        callId: 'begin',
        route,
        payload: { name: '__begin_design', args: task }
      })
      expect(mcp.designTask.value?.taskId).toBe('task-a')
      let finish!: (value: unknown) => void
      mocks.runMcpTool.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      receive({
        type: 'mcp.toolCall',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        callId: 'write',
        route: { ...route, taskId: 'task-a' },
        payload: {
          name: 'apply_canvas',
          args: { mode: 'create', markup: '<div />', ...(page ? { page } : {}) }
        }
      })
      expect(mocks.runMcpTool).toHaveBeenCalledWith('apply_canvas', {
        mode: 'create',
        markup: '<div />',
        page: { ...page, id: 'page-a' }
      })
      mocks.options.value.mcpOn = false
      mocks.watchCallbacks.forEach((callback) => callback())
      expect(
        mocks.window.postMessage.mock.calls.some(([message]) => message.type === 'mcp.disable')
      ).toBe(false)
      expect(mcp.designTask.value?.status).toBe('stopping')
      finish({ ok: true })
      await vi.waitFor(() =>
        expect(
          mocks.window.postMessage.mock.calls.some(([message]) => message.type === 'mcp.disable')
        ).toBe(true)
      )
      const messages = mocks.window.postMessage.mock.calls.map(([message]) => message)
      const resultIndex = messages.findIndex(
        (message) => message.type === 'mcp.toolResult' && message.callId === 'write'
      )
      expect(resultIndex).toBeGreaterThan(-1)
      expect(messages.findIndex((message) => message.type === 'mcp.disable')).toBeGreaterThan(
        resultIndex
      )
      expect(
        messages
          .slice(0, resultIndex)
          .some((message) => message.type === 'mcp.sessionInfo' && message.document.busy === false)
      ).toBe(true)
    }
  )

  it.each([
    'valid',
    'legacy-completed',
    'removed',
    'missing',
    'wrong-task',
    'wrong-file',
    'malformed',
    'unavailable'
  ])('restores only a usable anchor for the recovered local task (%s)', async (scenario) => {
    const node = {
      id: 'frame-a',
      type: 'FRAME',
      removed: scenario === 'removed',
      parent: { id: 'page-a', type: 'PAGE' }
    }
    const saved = JSON.stringify({
      taskId: scenario === 'wrong-task' ? 'other-task' : 'task-a',
      fileKey: scenario === 'wrong-file' ? 'other-file' : 'file-a',
      nodeId: node.id
    })
    const storage = {
      getItem: vi.fn((key: string) => {
        if (scenario === 'unavailable') throw new Error('Storage unavailable')
        return key === 'tempad-dev:design-anchor' ? (scenario === 'malformed' ? '{' : saved) : null
      }),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    const api = {
      fileKey: 'file-a',
      root: { name: 'Design' },
      currentPage: { id: 'page-a' },
      getNodeByIdAsync: vi.fn(async () => (scenario === 'missing' ? null : node))
    }
    Object.assign(mocks.window, { figma: api, sessionStorage: storage })
    vi.stubGlobal('figma', api)
    const mcp = useMcp()
    const state = bridgeState(mcp.sessionId, 'connected', null)
    if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
    receive(state)
    const task = {
      taskId: 'task-a',
      title: 'Recovered design',
      status: scenario === 'legacy-completed' ? ('completed' as const) : ('active' as const),
      operation: null,
      expiresAt: Date.now() + 300000,
      revision: 1,
      target: {
        sessionId: 'before-reload',
        fileKey: 'file-a',
        fileName: 'Design',
        pageId: 'page-a'
      }
    }
    const publish = (value: typeof task) =>
      receive({
        type: 'mcp.designTaskState',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        gatewayId: 'gateway-a',
        task: value
      })
    publish(task)
    if (scenario === 'legacy-completed') {
      await vi.waitFor(() => expect(mcp.designAnchor.value).toBe(node))
      expect(mcp.designTaskRestored.value).toBe(true)
    } else {
      expect(mcp.designAnchor.value).toBeNull()
      expect(api.getNodeByIdAsync).not.toHaveBeenCalled()
    }
    publish({ ...task, revision: 2, target: { ...task.target, sessionId: mcp.sessionId } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mcp.designAnchor.value).toBe(
      ['valid', 'legacy-completed'].includes(scenario) ? node : null
    )
    expect(api.currentPage.id).toBe('page-a')
    expect(mocks.runMcpTool).not.toHaveBeenCalled()
  })

  it.each(['new-task', 'stop', 'done', 'explicit-anchor'])(
    'does not let delayed anchor recovery override %s',
    async (change) => {
      const oldNode = {
        id: 'old-frame',
        type: 'FRAME',
        removed: false,
        parent: { id: 'page-a', type: 'PAGE' }
      }
      const newNode = { ...oldNode, id: 'new-frame' }
      let resolveNode!: (value: typeof oldNode) => void
      const pendingNode = new Promise<typeof oldNode>((resolve) => {
        resolveNode = resolve
      })
      const storage = {
        getItem: (key: string) =>
          key === 'tempad-dev:design-anchor'
            ? JSON.stringify({ taskId: 'task-a', fileKey: 'file-a', nodeId: oldNode.id })
            : null,
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
      const api = {
        fileKey: 'file-a',
        root: { name: 'Design' },
        currentPage: { id: 'page-a' },
        getNodeByIdAsync: vi.fn((id: string) =>
          id === oldNode.id ? pendingNode : Promise.resolve(newNode)
        )
      }
      Object.assign(mocks.window, { figma: api, sessionStorage: storage })
      vi.stubGlobal('figma', api)
      const mcp = useMcp()
      const state = bridgeState(mcp.sessionId, 'connected', null)
      if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
      receive(state)
      const task = {
        taskId: 'task-a',
        title: 'Recovered design',
        status: 'active' as const,
        operation: null,
        expiresAt: Date.now() + 300000,
        revision: 1,
        target: {
          sessionId: mcp.sessionId,
          fileKey: 'file-a',
          fileName: 'Design',
          pageId: 'page-a'
        }
      }
      const publish = (value: import('@tempad-dev/shared').DesignTask) =>
        receive({
          type: 'mcp.designTaskState',
          source: TEMPAD_MCP_BROWSER_SOURCE,
          version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
          gatewayId: 'gateway-a',
          task: value
        })
      publish(task)
      if (change === 'new-task') publish({ ...task, taskId: 'task-b', revision: 2 })
      else if (change === 'stop') publish({ ...task, status: 'cancelled', revision: 2 })
      else if (change === 'done') {
        publish({ ...task, status: 'completed', revision: 2 })
        mcp.dismissDesignTask(task.taskId)
      } else {
        receive({
          type: 'mcp.toolCall',
          source: TEMPAD_MCP_BROWSER_SOURCE,
          version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
          callId: 'choose-anchor',
          route: {
            gatewayId: 'gateway-a',
            sessionId: mcp.sessionId,
            fileKey: 'file-a',
            taskId: task.taskId
          },
          payload: { name: 'set_design_anchor', args: { nodeId: newNode.id } }
        })
        await vi.waitFor(() => expect(mcp.designAnchor.value).toBe(newNode))
        expect(storage.setItem).toHaveBeenCalledWith(
          'tempad-dev:design-anchor',
          JSON.stringify({ taskId: task.taskId, fileKey: 'file-a', nodeId: newNode.id })
        )
      }
      resolveNode(oldNode)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mcp.designAnchor.value).toBe(change === 'explicit-anchor' ? newNode : null)
      if (change === 'done')
        expect(storage.removeItem).toHaveBeenCalledWith('tempad-dev:design-anchor')
    }
  )

  it('binds a stable anchor only for successful creates or explicit choices, without navigating Figma', async () => {
    const page = { id: 'page-b', type: 'PAGE' }
    const node = {
      id: 'node-b',
      removed: false,
      type: 'FRAME',
      parent: page,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }
    }
    const api = {
      fileKey: 'file-a',
      root: { name: 'Design' },
      currentPage: { id: 'page-a' },
      getNodeByIdAsync: vi.fn(async (id: string) => (id === node.id ? node : page)),
      setCurrentPageAsync: vi.fn(),
      viewport: { scrollAndZoomIntoView: vi.fn() }
    }
    Object.assign(mocks.window, { figma: api, INITIAL_OPTIONS: { editor_type: 'design' } })
    vi.stubGlobal('figma', api)
    vi.stubGlobal('location', { origin: ORIGIN, pathname: '/design/file-a/Design' })
    const mcp = useMcp()
    const sessionId = mcp.sessionId
    const state = bridgeState(sessionId, 'connected', null)
    if (state.type === 'mcp.state') state.payload.gatewayId = 'gateway-a'
    receive(state)
    const route = { gatewayId: 'gateway-a', sessionId, fileKey: 'file-a' }
    receive({
      type: 'mcp.toolCall',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
      callId: 'begin',
      route,
      payload: {
        name: '__begin_design',
        args: {
          taskId: 'task-a',
          title: 'Settings',
          status: 'active',
          operation: null,
          target: { sessionId, fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
          expiresAt: Date.now() + 300000,
          revision: 1
        }
      }
    })
    let call = 0
    async function apply(result: unknown, name = 'apply_canvas', mode = 'create') {
      const callId = `write-${++call}`
      if (typeof result === 'function')
        mocks.runMcpTool.mockImplementationOnce(result as () => Promise<unknown>)
      else if (result instanceof Error) mocks.runMcpTool.mockRejectedValueOnce(result)
      else mocks.runMcpTool.mockResolvedValueOnce(result)
      receive({
        type: 'mcp.toolCall',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        callId,
        route: { ...route, taskId: 'task-a' },
        payload: { name, args: { mode, page: { id: 'page-b' } } }
      })
      await vi.waitFor(() =>
        expect(
          mocks.window.postMessage.mock.calls.some(
            ([message]) => message.type === 'mcp.toolResult' && message.callId === callId
          )
        ).toBe(true)
      )
    }
    const result = { mutationCount: 1, rootNodeId: node.id, page: { id: page.id } }
    expect(mcp.designAnchor.value).toBeNull()
    await apply(async () => {
      reportCanvasPlacement(node as unknown as SceneNode)
      expect(mcp.designAnchor.value).toBe(node)
      node.removed = true
      throw new Error('Rolled back after placement')
    })
    expect(mcp.designAnchor.value).toBeNull()
    node.removed = false
    await apply(result, 'apply_canvas', 'update')
    expect(mcp.designAnchor.value).toBeNull()
    await apply(result)
    expect(mcp.designAnchor.value).toBe(node)
    await apply({ ...result, mutationCount: 0 })
    await apply(new Error('Rolled back'))
    await apply(result, 'get_structure')
    await apply(result)
    await apply({ mutationCount: 1, page: { id: page.id } })
    expect(mcp.designAnchor.value).toBe(node)
    const nextNode = { ...node, id: 'next-frame' }
    api.getNodeByIdAsync.mockImplementation(async (id: string) =>
      id === nextNode.id ? nextNode : id === node.id ? node : page
    )
    await apply({ ...result, rootNodeId: nextNode.id })
    expect(mcp.designAnchor.value).toBe(node)
    async function anchor(nodeId: string, bound = true) {
      const callId = `anchor-${++call}`
      receive({
        type: 'mcp.toolCall',
        source: TEMPAD_MCP_BROWSER_SOURCE,
        version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
        callId,
        route: { ...route, ...(bound ? { taskId: 'task-a' } : {}) },
        payload: { name: 'set_design_anchor', args: { nodeId } }
      })
      await vi.waitFor(() =>
        expect(
          mocks.window.postMessage.mock.calls.some(
            ([message]) => message.type === 'mcp.toolResult' && message.callId === callId
          )
        ).toBe(true)
      )
      return mocks.window.postMessage.mock.calls.find(([message]) => message.callId === callId)![0]
    }
    expect(await anchor(page.id)).toMatchObject({ error: { code: 'NODE_NOT_VISIBLE' } })
    expect(await anchor(nextNode.id, false)).toMatchObject({
      error: { code: 'DESIGN_TASK_INACTIVE' }
    })
    expect(mcp.designAnchor.value).toBe(node)
    expect(await anchor(nextNode.id)).toMatchObject({
      payload: { nodeId: nextNode.id, pageId: page.id }
    })
    expect(mcp.designAnchor.value).toBe(nextNode)
    const completed = { ...mcp.designTask.value!, status: 'completed' as const, revision: 2 }
    receive({
      type: 'mcp.designTaskState',
      task: completed,
      gatewayId: 'gateway-a',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })
    expect(mcp.designAnchor.value).toBe(nextNode)
    receive({
      type: 'mcp.toolCall',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
      callId: 'resume-completed-review',
      route: { ...route, taskId: 'task-a', epoch: 1 },
      payload: {
        name: '__begin_design',
        args: { ...completed, status: 'active', epoch: 1, revision: 3, needsRead: true }
      }
    })
    await vi.waitFor(() =>
      expect(mcp.designTask.value).toMatchObject({ taskId: 'task-a', status: 'active', epoch: 1 })
    )
    expect(mcp.designAnchor.value).toBe(nextNode)
    expect(api.currentPage.id).toBe('page-a')
    expect(api.setCurrentPageAsync).not.toHaveBeenCalled()
    expect(api.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled()
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
