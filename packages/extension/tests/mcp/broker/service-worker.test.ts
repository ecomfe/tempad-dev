import type { ToolCallMessage } from '@tempad-dev/shared'

import {
  MCP_MAX_ASSET_BYTES,
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE,
  TEMPAD_MCP_ERROR_CODES,
  TEMPAD_MCP_SESSION_PORT_NAME
} from '@tempad-dev/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpBrokerHubClient } from '@/mcp/broker/service-worker'
import type { McpBrokerPort } from '@/mcp/broker/sessions'

import { McpServiceWorkerBroker } from '@/mcp/broker/service-worker'
import {
  type McpPermissionMessageType,
  createMcpPermissionMessage,
  MCP_LOCAL_HOST_ORIGIN
} from '@/mcp/permissions'

const ASSET_HASH = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'

beforeEach(() => {
  const values: Record<string, unknown> = {}
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => {
          Object.assign(values, structuredClone(next))
        },
        remove: async (key: string) => {
          delete values[key]
        }
      }
    }
  })
})

type Listener<T> = (payload: T) => void
type BrokerInternals = {
  handleDesignActionResult: (
    sessionId: string,
    result: import('@tempad-dev/shared').DesignActionResult
  ) => Promise<void>
  handleHubSnapshot: (snapshot: ReturnType<McpBrokerHubClient['getSnapshot']>) => void
  handlePermissionMessage: (type: McpPermissionMessageType) => Promise<{ granted: boolean }>
  routeToolCall: (message: ToolCallMessage) => void
  routeDesignTask: (message: import('@tempad-dev/shared').DesignTaskStateMessage) => Promise<void>
}

function createHubClient(
  snapshot: Partial<ReturnType<McpBrokerHubClient['getSnapshot']>> = {}
): McpBrokerHubClient {
  return {
    getSnapshot: () => ({
      activeId: snapshot.activeId ?? null,
      assetServerUrl: snapshot.assetServerUrl ?? null,
      errorMessage: snapshot.errorMessage ?? null,
      registeredId: snapshot.registeredId ?? null,
      status: snapshot.status ?? 'idle'
    }),
    sendActivate: vi.fn(),
    sendToolResult: vi.fn(),
    sendSessions: vi.fn(),
    sendDesignAction: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  }
}

function createPort(url?: string) {
  const messageListeners: Array<Listener<unknown>> = []
  const disconnectListeners: Array<Listener<void>> = []
  const port = {
    disconnect: vi.fn(),
    name: TEMPAD_MCP_SESSION_PORT_NAME,
    onDisconnect: {
      addListener: vi.fn((listener: Listener<void>) => disconnectListeners.push(listener))
    },
    onMessage: {
      addListener: vi.fn((listener: Listener<unknown>) => messageListeners.push(listener))
    },
    postMessage: vi.fn(),
    sender: url ? { frameId: 0, tab: { id: 1, url }, url } : undefined
  } as unknown as McpBrokerPort

  return {
    disconnect: () => disconnectListeners.forEach((listener) => listener()),
    message: (payload: unknown) => messageListeners.forEach((listener) => listener(payload)),
    port,
    postMessage: port.postMessage as ReturnType<typeof vi.fn>
  }
}

function pageMessage(
  type: 'mcp.activateSession' | 'mcp.disable' | 'mcp.enable',
  sessionId = 'session-1'
) {
  return {
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type,
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function designBroker() {
  const client = createHubClient({
    status: 'connected',
    registeredId: 'gateway-a',
    activeId: 'gateway-a'
  })
  const broker = new McpServiceWorkerBroker(client)
  const internals = broker as unknown as BrokerInternals
  internals.handleHubSnapshot(client.getSnapshot())
  const a = createPort('https://www.figma.com/design/file-a/Design')
  const b = createPort('https://www.figma.com/design/file-b/Design')
  for (const [port, sessionId, fileKey] of [
    [a, 'tab-a', 'file-a'],
    [b, 'tab-b', 'file-b']
  ] as const) {
    port.port.sender!.documentId = `document-${sessionId}`
    broker.handlePort(port.port)
    port.message({
      ...pageMessage('mcp.enable', sessionId),
      document: { fileKey, fileName: 'Design', pageId: 'page-a', busy: false }
    })
  }
  b.message(pageMessage('mcp.activateSession', 'tab-b'))
  return { broker, internals, client, a, b }
}

describe('design task broker routing', () => {
  it('closes a review offline, clears its drafts, and synchronizes Done before a stale page can reopen it', async () => {
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Design',
      status: 'completed' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      client: { kind: 'codex-app' as const, name: 'Codex', sessionId: 'conversation-a' },
      expiresAt: 1000,
      revision: 4
    }
    await f.internals.routeDesignTask({ type: 'designTaskState', task })
    const scope = {
      taskId: task.taskId,
      fileKey: 'file-a',
      clientKind: 'codex-app',
      conversationId: 'conversation-a'
    }
    const draft = (operation: unknown, requestId: string) =>
      f.a.message({
        ...pageMessage('mcp.enable', 'tab-a'),
        type: 'mcp.feedbackDrafts',
        requestId,
        request: { scope, ...(operation as object) }
      })
    draft(
      { operation: 'comment', comment: 'Keep the spacing' },
      '00000000-0000-4000-8000-000000000001'
    )
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.feedbackDraftsResult',
          payload: { items: [], comment: 'Keep the spacing' }
        })
      )
    )
    const offline = { ...f.client.getSnapshot(), status: 'connecting' as const, registeredId: null }
    vi.spyOn(f.client, 'getSnapshot').mockReturnValue(offline)
    f.internals.handleHubSnapshot(offline)
    const action = {
      requestId: '00000000-0000-4000-8000-000000000002',
      taskId: task.taskId,
      epoch: 0,
      action: 'done'
    }
    f.a.message({ ...pageMessage('mcp.enable', 'tab-a'), type: 'mcp.designAction', action })
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.designActionResult',
          result: expect.objectContaining({ status: 'delivered', requestId: action.requestId })
        })
      )
    )
    draft({ operation: 'load' }, '00000000-0000-4000-8000-000000000003')
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.feedbackDraftsResult',
          requestId: '00000000-0000-4000-8000-000000000003',
          payload: { items: [] }
        })
      )
    )
    const next = designBroker()
    next.a.message({
      ...pageMessage('mcp.enable', 'tab-a'),
      reviewTask: task,
      document: { fileKey: 'file-a', fileName: 'Design', pageId: 'page-a', busy: false }
    })
    await vi.waitFor(() =>
      expect(next.client.sendSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          reviews: [{ sessionId: 'tab-a', task: { ...task, reviewClosed: true } }]
        })
      )
    )
    await next.internals.routeDesignTask({
      type: 'designTaskState',
      task: { ...task, revision: 10 }
    })
    expect(next.a.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mcp.designTaskState',
        task: expect.objectContaining({ reviewClosed: true })
      })
    )
    expect(next.client.sendDesignAction).not.toHaveBeenCalled()
  })

  it('keeps the newest Hub revision when storage finishes asynchronously', async () => {
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Design',
      status: 'completed' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      expiresAt: 1000,
      revision: 10
    }
    await Promise.all([
      f.internals.routeDesignTask({ type: 'designTaskState', task }),
      f.internals.routeDesignTask({ type: 'designTaskState', task: { ...task, revision: 9 } })
    ])
    expect(f.a.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mcp.designTaskState', task })
    )
  })

  it('sends Stop before synchronizing cancellation so the Hub can interrupt the active turn', async () => {
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Settings',
      status: 'active' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      expiresAt: 300000,
      revision: 1
    }
    await f.internals.routeDesignTask({ type: 'designTaskState', task })
    const received: string[] = []
    vi.mocked(f.client.sendDesignAction).mockImplementation(() => {
      received.push('stop')
    })
    vi.mocked(f.client.sendSessions).mockImplementation((snapshot) => {
      if (
        snapshot.reviews?.some(
          ({ task }) => task.taskId === 'task-a' && task.status === 'cancelled'
        )
      )
        received.push('cancelled')
    })
    f.a.message({
      ...pageMessage('mcp.enable', 'tab-a'),
      type: 'mcp.designAction',
      action: {
        requestId: '00000000-0000-4000-8000-000000000001',
        taskId: task.taskId,
        epoch: 0,
        action: 'stop'
      }
    })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received).toEqual(['stop', 'cancelled'])
  })

  it('acknowledges local Stop when the host disconnects and routes an explicit new task', async () => {
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Settings',
      status: 'active' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      expiresAt: 300000,
      revision: 1
    }
    await f.internals.routeDesignTask({ type: 'designTaskState', task })
    vi.mocked(f.client.sendDesignAction).mockImplementation(() => {
      throw new Error('Host disconnected')
    })
    const action = {
      requestId: '00000000-0000-4000-8000-000000000001',
      taskId: task.taskId,
      epoch: 0,
      action: 'stop'
    }
    f.a.message({ ...pageMessage('mcp.enable', 'tab-a'), type: 'mcp.designAction', action })
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.designActionResult',
          result: expect.objectContaining({
            status: 'delivered',
            message: 'Design task stopped. Agent interruption is unavailable.'
          })
        })
      )
    )
    expect(f.client.sendSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reviews: expect.arrayContaining([
          expect.objectContaining({
            task: expect.objectContaining({ taskId: 'task-a', status: 'cancelled' })
          })
        ])
      })
    )
    const nextTask = { ...task, taskId: 'task-b', revision: 2 }
    const call: ToolCallMessage = {
      type: 'toolCall',
      id: 'new-task',
      route: { gatewayId: 'gateway-a', sessionId: 'tab-a', fileKey: 'file-a' },
      payload: { name: '__begin_design', args: nextTask }
    }
    f.a.postMessage.mockClear()
    await f.internals.routeDesignTask({ type: 'designTaskState', task: nextTask })
    f.internals.routeToolCall(call)
    expect(f.a.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mcp.toolCall', callId: 'new-task' })
    )
    expect(f.a.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mcp.designTaskState', task: nextTask })
    )
    f.client.sendDesignAction = vi.fn()
    // A different port cannot stop this task by claiming its session id.
    f.b.message({ ...pageMessage('mcp.enable', 'tab-a'), type: 'mcp.designAction', action })
    expect(f.client.sendDesignAction).not.toHaveBeenCalled()
  })

  it('acknowledges local Stop without dispatching to an already disconnected host', async () => {
    const f = designBroker()
    vi.spyOn(f.client, 'getSnapshot').mockReturnValue({
      ...f.client.getSnapshot(),
      status: 'connecting'
    })
    const action = {
      requestId: '00000000-0000-4000-8000-000000000001',
      taskId: 'task-a',
      epoch: 0,
      action: 'stop'
    }
    f.a.message({ ...pageMessage('mcp.enable', 'tab-a'), type: 'mcp.designAction', action })
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.designActionResult',
          result: expect.objectContaining({
            status: 'delivered',
            message: 'Design task stopped. Agent interruption is unavailable.'
          })
        })
      )
    )
    expect(f.client.sendDesignAction).not.toHaveBeenCalled()
  })

  it('persists per-element drafts for the bound conversation and clears a delivered batch after its tab closes', async () => {
    const data: Record<string, unknown> = {}
    const local = {
      async get(key: string) {
        return { [key]: structuredClone(data[key]) }
      },
      async set(values: Record<string, unknown>) {
        Object.assign(data, structuredClone(values))
      },
      async remove(key: string) {
        delete data[key]
      }
    }
    vi.stubGlobal('browser', { storage: { local } })
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Settings',
      status: 'active' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      client: { kind: 'codex-app' as const, name: 'Codex App', sessionId: 'thread-a' },
      expiresAt: 300000,
      revision: 1
    }
    await f.internals.routeDesignTask({ type: 'designTaskState', task })
    const scope = {
      taskId: 'task-a',
      fileKey: 'file-a',
      clientKind: 'codex-app',
      conversationId: 'thread-a'
    }
    const item = {
      nodeId: '1:2',
      nodeName: 'Heading',
      pageId: 'page-a',
      text: 'More space',
      createdAt: 1000
    }
    const requestId = '77bf50b5-d652-4b94-9970-a537b6a32e1f'
    const request = {
      ...pageMessage('mcp.enable', 'tab-a'),
      type: 'mcp.feedbackDrafts',
      requestId,
      request: { operation: 'save', scope, item }
    }
    f.a.message(request)
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcp.feedbackDraftsResult', payload: { items: [item] } })
      )
    )
    expect(f.client.sendDesignAction).not.toHaveBeenCalled()
    f.b.message({ ...request, sessionId: 'tab-b' })
    await vi.waitFor(() =>
      expect(f.b.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.feedbackDraftsResult',
          error: expect.objectContaining({
            message: 'Comments are unavailable in this file.'
          })
        })
      )
    )
    const feedback = {
      id: requestId,
      fileKey: 'file-a',
      mode: 'queue',
      items: [item],
      createdAt: 1001
    }
    f.a.message({
      ...request,
      request: { operation: 'load', scope: { ...scope, taskId: 'task-b' } }
    })
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.feedbackDraftsResult',
          payload: { items: [] }
        })
      )
    )
    f.a.message({
      ...pageMessage('mcp.enable', 'tab-a'),
      type: 'mcp.designAction',
      draftScope: scope,
      action: { requestId, taskId: 'task-b', epoch: 0, action: 'feedback', feedback }
    })
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.designActionResult',
          result: expect.objectContaining({
            status: 'failed',
            message: 'Comments are unavailable for this task.'
          })
        })
      )
    )
    expect(f.client.sendDesignAction).not.toHaveBeenCalled()
    f.a.message({
      ...pageMessage('mcp.enable', 'tab-a'),
      type: 'mcp.designAction',
      draftScope: scope,
      action: { requestId, taskId: 'task-a', epoch: 0, action: 'feedback', feedback }
    })
    await vi.waitFor(() => expect(f.client.sendDesignAction).toHaveBeenCalledOnce())
    expect(JSON.stringify(data)).toContain('submission')
    f.a.disconnect()
    await f.internals.handleDesignActionResult('tab-a', {
      requestId,
      taskId: 'task-a',
      status: 'delivered',
      message: 'Sent'
    })
    expect(Object.keys(data)).toEqual(['tempad.design-reviews.v1'])
  })

  it('keeps local comments available after refresh and a worker restart without reopening host delivery', async () => {
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Settings',
      status: 'completed' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      client: { kind: 'codex-app' as const, name: 'Codex', sessionId: 'thread-a' },
      expiresAt: 300000,
      revision: 1
    }
    await f.internals.routeDesignTask({ type: 'designTaskState', task })
    const scope = {
      taskId: 'task-a',
      fileKey: 'file-a',
      clientKind: 'codex-app',
      conversationId: 'thread-a'
    }
    const item = {
      nodeId: '1:2',
      nodeName: 'Heading',
      pageId: 'page-a',
      text: 'More space',
      createdAt: 1000
    }
    const request = {
      ...pageMessage('mcp.enable', 'tab-a'),
      type: 'mcp.feedbackDrafts',
      requestId: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
      request: { operation: 'save', scope, item }
    }
    f.a.message(request)
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcp.feedbackDraftsResult', payload: { items: [item] } })
      )
    )
    f.a.disconnect()
    const client = createHubClient({ status: 'connecting' })
    const broker = new McpServiceWorkerBroker(client)
    const refreshed = createPort('https://www.figma.com/design/file-a/Design')
    broker.handlePort(refreshed.port)
    refreshed.message({
      ...pageMessage('mcp.enable', 'after-refresh'),
      document: { fileKey: 'file-a', fileName: 'Design', pageId: 'page-a', busy: false }
    })
    refreshed.message({
      ...request,
      sessionId: 'after-refresh',
      request: { operation: 'load', scope }
    })
    await vi.waitFor(() =>
      expect(refreshed.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcp.feedbackDraftsResult', payload: { items: [item] } })
      )
    )
    for (const otherScope of [
      { ...scope, taskId: 'other-task' },
      { ...scope, conversationId: 'other-thread' }
    ]) {
      refreshed.postMessage.mockClear()
      refreshed.message({
        ...request,
        sessionId: 'after-refresh',
        request: { operation: 'load', scope: otherScope }
      })
      await vi.waitFor(() =>
        expect(refreshed.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'mcp.feedbackDraftsResult', payload: { items: [] } })
        )
      )
    }
    refreshed.message({
      ...request,
      sessionId: 'after-refresh',
      request: { operation: 'comment', scope, comment: 'One more change' }
    })
    await vi.waitFor(() =>
      expect(refreshed.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { items: [item], comment: 'One more change' } })
      )
    )
    refreshed.message({
      ...pageMessage('mcp.enable', 'after-refresh'),
      type: 'mcp.designAction',
      draftScope: scope,
      action: {
        requestId: request.requestId,
        taskId: 'task-a',
        epoch: 0,
        action: 'feedback',
        feedback: {
          id: request.requestId,
          fileKey: 'file-a',
          mode: 'queue',
          items: [item],
          createdAt: 1001
        }
      }
    })
    await vi.waitFor(() =>
      expect(refreshed.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp.designActionResult',
          result: expect.objectContaining({ status: 'failed' })
        })
      )
    )
    expect(client.sendDesignAction).not.toHaveBeenCalled()
    refreshed.postMessage.mockClear()
    refreshed.message({
      ...request,
      sessionId: 'after-refresh',
      request: { operation: 'clear', scope }
    })
    await vi.waitFor(() =>
      expect(refreshed.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcp.feedbackDraftsResult', payload: { items: [] } })
      )
    )
  })

  it('routes to a bound tab after a different tab is activated, and never falls back if it disappears', async () => {
    const f = designBroker()
    const call: ToolCallMessage = {
      type: 'toolCall',
      id: 'design-write',
      route: { gatewayId: 'gateway-a', sessionId: 'tab-a', fileKey: 'file-a', taskId: 'task-a' },
      payload: { name: 'apply_canvas', args: { mode: 'create', markup: '<div />' } }
    }
    f.a.postMessage.mockClear()
    f.b.postMessage.mockClear()
    f.internals.routeToolCall(call)
    await vi.waitFor(() =>
      expect(f.a.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcp.toolCall', route: call.route })
      )
    )
    expect(f.b.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mcp.toolCall' })
    )
    f.a.disconnect()
    f.b.postMessage.mockClear()
    f.internals.routeToolCall({ ...call, id: 'late-write' })
    expect(f.client.sendToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'late-write',
        error: expect.objectContaining({ code: 'DESIGN_TARGET_CHANGED' })
      })
    )
    expect(f.b.postMessage).not.toHaveBeenCalled()
  })

  it('fences previous gateway requests and publishes actual session metadata', () => {
    const f = designBroker()
    expect(f.client.sendSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({ sessionId: 'tab-a', tabId: 1, documentId: 'document-tab-a' })
        ])
      })
    )
    f.a.postMessage.mockClear()
    f.internals.routeToolCall({
      type: 'toolCall',
      id: 'old-call',
      route: { gatewayId: 'old-gateway', sessionId: 'tab-a', fileKey: 'file-a' },
      payload: { name: 'get_structure', args: {} }
    })
    expect(f.a.postMessage).not.toHaveBeenCalled()
    f.a.message({
      ...pageMessage('mcp.enable', 'tab-a'),
      type: 'mcp.sessionInfo',
      document: { fileKey: 'file-a', fileName: 'Design', pageId: 'page-b', busy: true }
    })
    expect(f.client.sendSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeSessionId: 'tab-b',
        sessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'tab-a',
            pageId: 'page-b',
            busy: true,
            tabId: 1,
            documentId: 'document-tab-a'
          })
        ])
      })
    )
  })

  it('only synchronizes task state to the matching file and validates the stop sender', async () => {
    const f = designBroker()
    const task = {
      taskId: 'task-a',
      title: 'Settings',
      status: 'active' as const,
      operation: null,
      target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
      expiresAt: 300000,
      revision: 1
    }
    f.a.postMessage.mockClear()
    f.b.postMessage.mockClear()
    await f.internals.routeDesignTask({ type: 'designTaskState', task })
    expect(f.a.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mcp.designTaskState', task })
    )
    expect(f.b.postMessage).not.toHaveBeenCalled()
    const action = {
      requestId: '00000000-0000-4000-8000-000000000001',
      taskId: 'task-a',
      epoch: 0,
      action: 'stop'
    }
    f.b.message({ ...pageMessage('mcp.enable', 'tab-a'), type: 'mcp.designAction', action })
    expect(f.client.sendDesignAction).not.toHaveBeenCalled()
    f.a.message({ ...pageMessage('mcp.enable', 'tab-a'), type: 'mcp.designAction', action })
    await vi.waitFor(() =>
      expect(f.client.sendDesignAction).toHaveBeenCalledWith({
        type: 'designAction',
        sessionId: 'tab-a',
        action
      })
    )
  })
})

function toolResult(callId: string, sessionId = 'session-1') {
  return {
    callId,
    payload: { ok: true },
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.toolResult',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function assetUpload(sessionId = 'session-1') {
  return {
    payload: {
      base64: 'AQID',
      hash: ASSET_HASH,
      metadata: { height: 20, themeable: true, width: 10 },
      mimeType: 'image/png'
    },
    requestId: 'upload-1',
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.uploadAsset',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function assetDownload(sessionId = 'session-1') {
  return {
    payload: { hash: ASSET_HASH },
    requestId: 'download-1',
    sessionId,
    source: TEMPAD_MCP_BROWSER_SOURCE,
    type: 'mcp.downloadAsset',
    version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
  }
}

function routeToolCall(broker: McpServiceWorkerBroker, id = 'call-1'): void {
  const internals = broker as unknown as BrokerInternals
  internals.routeToolCall({
    id,
    payload: { args: { nodeId: '1:2' }, name: 'get_code' },
    type: 'toolCall'
  })
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mcp/broker/service-worker', () => {
  it('wires runtime ports while ignoring unrelated ports, invalid senders, and malformed traffic', () => {
    let connectListener: ((port: McpBrokerPort) => void) | undefined
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn(), request: vi.fn() },
      runtime: {
        onConnect: {
          addListener: vi.fn((listener: typeof connectListener) => {
            connectListener = listener
          })
        },
        onMessage: { addListener: vi.fn() }
      }
    })
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    broker.start()

    const unrelated = createPort('https://www.figma.com/design/abc/File')
    Object.assign(unrelated.port, { name: 'other-port' })
    connectListener?.(unrelated.port)
    expect(unrelated.port.onMessage.addListener).not.toHaveBeenCalled()

    const malformedSender = createPort('not a URL')
    connectListener?.(malformedSender.port)
    expect(malformedSender.port.disconnect).toHaveBeenCalledTimes(1)

    const valid = createPort('https://www.figma.com/design/abc/File')
    connectListener?.(valid.port)
    valid.message({ type: 'not-tempad' })
    expect(valid.port.onMessage.addListener).toHaveBeenCalledTimes(1)
    expect(hubClient.start).not.toHaveBeenCalled()
  })

  it('rejects session ports without a Figma sender URL', () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const { port } = createPort()

    broker.handlePort(port)

    expect(port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not let a replaced port disconnect unregister the current session', () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.enable'))

    const callsBeforeDisconnect = second.postMessage.mock.calls.length
    first.disconnect()
    second.message(pageMessage('mcp.activateSession'))

    expect(second.postMessage.mock.calls.length).toBeGreaterThan(callsBeforeDisconnect)
  })

  it('routes tool calls to the active session and forwards matching results', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    routeToolCall(broker)

    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        type: 'mcp.toolCall'
      })
    )

    session.message(toolResult('call-1'))

    expect(hubClient.sendToolResult).toHaveBeenCalledWith({
      id: 'call-1',
      payload: { ok: true },
      type: 'toolResult'
    })

    routeToolCall(broker)
    const { payload: _payload, ...failedResult } = toolResult('call-1')
    session.message({ ...failedResult, error: { message: 'failed' } })
    expect(hubClient.sendToolResult).toHaveBeenLastCalledWith({
      error: { message: 'failed' },
      id: 'call-1',
      type: 'toolResult'
    })
  })

  it('rejects pending work when one port replaces and then disables its session', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable', 'session-a'))
    session.message(pageMessage('mcp.activateSession', 'session-a'))
    routeToolCall(broker)
    session.message(pageMessage('mcp.enable', 'session-b'))

    expect(hubClient.sendToolResult).toHaveBeenCalledWith({
      error: {
        code: TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
        message: 'Figma session was replaced before providing a result.'
      },
      id: 'call-1',
      type: 'toolResult'
    })

    session.message(pageMessage('mcp.disable', 'session-b'))
    expect(hubClient.stop).toHaveBeenCalledTimes(1)
  })

  it('activates the hub only for an explicit session activation request', () => {
    const snapshot: Partial<ReturnType<McpBrokerHubClient['getSnapshot']>> = {
      activeId: 'other-gateway',
      registeredId: 'gateway-1',
      status: 'connected'
    }
    const hubClient = createHubClient(snapshot)
    const broker = new McpServiceWorkerBroker(hubClient)
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))

    expect(hubClient.sendActivate).not.toHaveBeenCalled()
    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ activeSessionId: null }),
        type: 'mcp.state'
      })
    )

    session.message(pageMessage('mcp.activateSession'))

    expect(hubClient.sendActivate).toHaveBeenCalledTimes(1)
    snapshot.activeId = 'gateway-1'
    session.message(pageMessage('mcp.activateSession'))
    expect(hubClient.sendActivate).toHaveBeenCalledTimes(1)
  })

  it('requires a new explicit tab choice when a hub reconnects with multiple sessions', () => {
    const snapshot: Partial<ReturnType<McpBrokerHubClient['getSnapshot']>> = {
      activeId: 'gateway-1',
      registeredId: 'gateway-1',
      status: 'connected'
    }
    const hubClient = createHubClient(snapshot)
    const broker = new McpServiceWorkerBroker(hubClient)
    const internals = broker as unknown as BrokerInternals
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/def/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.enable', 'session-b'))
    second.message(pageMessage('mcp.activateSession', 'session-b'))

    snapshot.activeId = 'gateway-2'
    snapshot.registeredId = 'gateway-2'
    internals.handleHubSnapshot(hubClient.getSnapshot())
    internals.routeToolCall({
      id: 'call-after-reconnect',
      payload: { args: undefined, name: 'get_code' },
      type: 'toolCall'
    })

    expect(hubClient.sendToolResult).toHaveBeenLastCalledWith({
      error: {
        code: TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
        message: 'No active TemPad Dev Figma session available.'
      },
      id: 'call-after-reconnect',
      type: 'toolResult'
    })
  })

  it('ignores session control messages from ports that do not own the session', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.disable', 'session-a'))
    second.message(pageMessage('mcp.activateSession', 'session-a'))
    routeToolCall(broker)

    expect(first.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        type: 'mcp.toolCall'
      })
    )
    expect(hubClient.sendToolResult).not.toHaveBeenCalled()
  })

  it('ignores tool results from ports that do not own the claimed session', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const owner = createPort('https://www.figma.com/design/abc/File')
    const other = createPort('https://www.figma.com/design/def/File')

    broker.handlePort(owner.port)
    owner.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(other.port)
    other.message(pageMessage('mcp.enable', 'session-b'))
    owner.message(pageMessage('mcp.activateSession', 'session-a'))
    routeToolCall(broker)

    other.message(toolResult('call-1', 'session-a'))
    expect(hubClient.sendToolResult).not.toHaveBeenCalled()

    owner.message(toolResult('call-1', 'session-a'))
    expect(hubClient.sendToolResult).toHaveBeenCalledTimes(1)
  })

  it('prunes sessions that fail state delivery and rebroadcasts the current count', () => {
    const broker = new McpServiceWorkerBroker(
      createHubClient({ activeId: 'gateway-1', registeredId: 'gateway-1', status: 'connected' })
    )
    const first = createPort('https://www.figma.com/design/abc/File')
    const second = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(first.port)
    first.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(second.port)
    second.message(pageMessage('mcp.enable', 'session-b'))
    first.postMessage.mockClear()
    second.postMessage.mockClear()
    first.postMessage.mockImplementation(() => {
      throw new Error('port closed')
    })

    second.message(pageMessage('mcp.activateSession', 'session-b'))

    expect(second.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          activeSessionId: 'session-b',
          sessionCount: 1
        }),
        type: 'mcp.state'
      })
    )
  })

  it('contains active-session delivery failure without stopping another live session', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)
    const failing = createPort('https://www.figma.com/design/abc/File')
    const survivor = createPort('https://www.figma.com/design/def/File')

    broker.handlePort(failing.port)
    failing.message(pageMessage('mcp.enable', 'session-a'))
    broker.handlePort(survivor.port)
    survivor.message(pageMessage('mcp.enable', 'session-b'))
    failing.message(pageMessage('mcp.activateSession', 'session-a'))
    failing.postMessage.mockImplementation(() => {
      throw new Error('port closed')
    })

    routeToolCall(broker)

    expect(hubClient.sendToolResult).toHaveBeenCalledWith({
      error: {
        code: TEMPAD_MCP_ERROR_CODES.EXTENSION_DISCONNECTED,
        message: 'Figma session disconnected before receiving a tool call.'
      },
      id: 'call-1',
      type: 'toolResult'
    })
    expect(hubClient.stop).not.toHaveBeenCalled()
    expect(survivor.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ sessionCount: 1 }),
        type: 'mcp.state'
      })
    )
  })

  it('uploads assets through the hub asset server for the owning session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, statusText: 'Created' })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const broker = new McpServiceWorkerBroker(
      createHubClient({ assetServerUrl: 'http://127.0.0.1:9000' })
    )
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetUpload())
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith(`http://127.0.0.1:9000/assets/${ASSET_HASH}`, {
      body: expect.any(Blob),
      headers: {
        'Content-Type': 'image/png',
        'X-Asset-Height': '20',
        'X-Asset-Themeable': 'true',
        'X-Asset-Width': '10'
      },
      method: 'POST'
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    await expect((init.body as Blob).arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer
    )
    expect(session.postMessage).toHaveBeenLastCalledWith({
      requestId: 'upload-1',
      sessionId: 'session-1',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetUploadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })
  })

  it('downloads and verifies hash-addressed assets for the owning session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
        status: 200
      })
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const broker = new McpServiceWorkerBroker(
      createHubClient({ assetServerUrl: 'http://127.0.0.1:9000' })
    )
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetDownload())
    await flushMicrotasks()
    await flushMicrotasks()
    await vi.waitFor(() => expect(session.postMessage).toHaveBeenCalled())

    expect(fetchMock).toHaveBeenCalledWith(`http://127.0.0.1:9000/assets/${ASSET_HASH}`, {
      method: 'GET'
    })
    expect(session.postMessage).toHaveBeenLastCalledWith({
      payload: {
        base64: 'AQID',
        mimeType: 'image/png',
        size: 3
      },
      requestId: 'download-1',
      sessionId: 'session-1',
      source: TEMPAD_MCP_BROWSER_SOURCE,
      type: 'mcp.assetDownloadResult',
      version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION
    })
  })

  it('returns a coded error when a downloaded asset is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch
    )
    const broker = new McpServiceWorkerBroker(
      createHubClient({ assetServerUrl: 'http://127.0.0.1:9000' })
    )
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetDownload())
    await flushMicrotasks()
    await flushMicrotasks()

    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: {
          code: TEMPAD_MCP_ERROR_CODES.ASSET_NOT_FOUND,
          message: expect.stringContaining('was not found')
        },
        requestId: 'download-1',
        type: 'mcp.assetDownloadResult'
      })
    )
  })

  it('stops streaming assets once the bridge byte limit is exceeded', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MCP_MAX_ASSET_BYTES))
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: { 'Content-Type': 'image/png' },
          status: 200
        })
      ) as unknown as typeof fetch
    )
    const broker = new McpServiceWorkerBroker(
      createHubClient({ assetServerUrl: 'http://127.0.0.1:9000' })
    )
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetDownload())

    await vi.waitFor(() =>
      expect(session.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          error: {
            code: TEMPAD_MCP_ERROR_CODES.ASSET_TOO_LARGE,
            message: expect.stringContaining('bridge limit')
          },
          requestId: 'download-1',
          type: 'mcp.assetDownloadResult'
        })
      )
    )
  })

  it('returns an asset upload error when the hub has no asset server URL', async () => {
    const broker = new McpServiceWorkerBroker(createHubClient())
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetUpload())
    await flushMicrotasks()

    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: {
          code: TEMPAD_MCP_ERROR_CODES.ASSET_SERVER_NOT_CONFIGURED,
          message: 'Asset server URL is not configured.'
        },
        requestId: 'upload-1',
        type: 'mcp.assetUploadResult'
      })
    )
  })

  it('reports non-successful asset uploads and cleans up failed result delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 507, statusText: 'Quota' })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const hubClient = createHubClient({ assetServerUrl: 'http://127.0.0.1:9000' })
    const broker = new McpServiceWorkerBroker(hubClient)
    const session = createPort('https://www.figma.com/design/abc/File')

    broker.handlePort(session.port)
    session.message(pageMessage('mcp.enable'))
    session.postMessage.mockClear()
    session.message(assetUpload())
    await flushMicrotasks()
    await flushMicrotasks()

    expect(session.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: { message: 'Upload failed with status 507 Quota' },
        requestId: 'upload-1',
        type: 'mcp.assetUploadResult'
      })
    )

    session.postMessage.mockImplementation(() => {
      throw new Error('port closed')
    })
    session.message({ ...assetUpload(), requestId: 'upload-2' })
    await flushMicrotasks()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(hubClient.stop).toHaveBeenCalledTimes(1)
  })

  it('returns a coded error when no active session can receive a tool call', () => {
    const hubClient = createHubClient()
    const broker = new McpServiceWorkerBroker(hubClient)

    routeToolCall(broker)

    expect(hubClient.sendToolResult).toHaveBeenCalledWith({
      error: {
        code: TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
        message: 'No active TemPad Dev Figma session available.'
      },
      id: 'call-1',
      type: 'toolResult'
    })
  })

  it('checks local host permissions without prompting', async () => {
    const contains = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('permissions unavailable'))
    const request = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('browser', {
      permissions: {
        contains,
        request
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient()) as unknown as BrokerInternals

    await expect(broker.handlePermissionMessage('mcp.permissions.contains')).resolves.toEqual({
      granted: true
    })
    await expect(broker.handlePermissionMessage('mcp.permissions.contains')).resolves.toEqual({
      granted: false
    })
    await expect(broker.handlePermissionMessage('mcp.permissions.contains')).resolves.toEqual({
      granted: false
    })

    expect(contains).toHaveBeenCalledWith({ origins: [MCP_LOCAL_HOST_ORIGIN] })
    expect(contains).toHaveBeenCalledTimes(3)
    expect(request).not.toHaveBeenCalled()
  })

  it('requests local host permissions without awaiting first, preserving user activation', async () => {
    const contains = vi.fn().mockResolvedValue(false)
    const request = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('browser', {
      permissions: {
        contains,
        request
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient()) as unknown as BrokerInternals

    const pending = broker.handlePermissionMessage('mcp.permissions.request')

    expect(request).toHaveBeenCalledWith({ origins: [MCP_LOCAL_HOST_ORIGIN] })
    expect(contains).not.toHaveBeenCalled()

    await expect(pending).resolves.toEqual({ granted: true })
  })

  it('treats a request() failure as a denied permission', async () => {
    vi.stubGlobal('browser', {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi
          .fn()
          .mockRejectedValue(new Error('This function must be called during a user gesture'))
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient()) as unknown as BrokerInternals

    await expect(broker.handlePermissionMessage('mcp.permissions.request')).resolves.toEqual({
      granted: false
    })
  })

  it('answers permission messages over sendResponse and keeps the channel open', async () => {
    let listener:
      | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
      | undefined
    const request = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn().mockResolvedValue(false), request },
      runtime: {
        onConnect: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((fn: typeof listener) => {
            listener = fn
          })
        }
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient())
    broker.start()

    const sendResponse = vi.fn()
    // Returning a promise here is a Firefox-only affordance: Chromium closes the
    // channel unless the listener returns literal `true`.
    const kept = listener?.(createMcpPermissionMessage('mcp.permissions.request'), {}, sendResponse)
    expect(kept).toBe(true)

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ granted: true }))
  })

  it('ignores unrelated runtime messages', () => {
    let listener:
      | ((message: unknown, sender: unknown, sendResponse: unknown) => unknown)
      | undefined
    vi.stubGlobal('browser', {
      permissions: { contains: vi.fn(), request: vi.fn() },
      runtime: {
        onConnect: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((fn: typeof listener) => {
            listener = fn
          })
        }
      }
    })
    const broker = new McpServiceWorkerBroker(createHubClient())
    broker.start()

    expect(listener?.({ type: 'something.else' }, {}, vi.fn())).toBeUndefined()
  })
})
