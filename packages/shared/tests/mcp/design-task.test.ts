import { describe, expect, it } from 'vitest'

import {
  parseBridgeToPageMessage,
  parsePageToBridgeMessage,
  TEMPAD_MCP_BROWSER_PROTOCOL_VERSION,
  TEMPAD_MCP_BROWSER_SOURCE
} from '../../src/mcp/browser-gateway'
import {
  AGENT_CLIENTS,
  AgentClientKindSchema,
  AgentClientSchema,
  BeginDesignParametersSchema,
  DesignActionSchema,
  DesignFeedbackSchema,
  DesignTaskSchema,
  DesignToolRouteSchema,
  EndDesignParametersSchema,
  formatDesignFeedback,
  ResumeDesignParametersSchema,
  SetDesignAnchorParametersSchema,
  FeedbackDraftRequestSchema
} from '../../src/mcp/design-task'
import { parseMessageFromExtension, parseMessageToExtension } from '../../src/mcp/protocol'
import {
  ApplyCanvasParametersSchema,
  GetStructureParametersSchema,
  UploadAssetParametersSchema
} from '../../src/mcp/tools'

const task = {
  taskId: 'task-1',
  title: 'Settings',
  target: { sessionId: 'tab-1', fileKey: 'file-1', fileName: 'Design', pageId: 'page-1' },
  status: 'active',
  operation: null,
  expiresAt: 1000,
  revision: 1
}
const route = { sessionId: 'tab-1', fileKey: 'file-1', gatewayId: 'gateway-1', taskId: 'task-1' }
const base = { source: TEMPAD_MCP_BROWSER_SOURCE, version: TEMPAD_MCP_BROWSER_PROTOCOL_VERSION }

describe('design task contracts', () => {
  it('carries saved review identity and durable Done without changing a write lease', () => {
    const review = { ...task, reviewClosed: true }
    expect(
      parsePageToBridgeMessage({
        ...base,
        type: 'mcp.enable',
        sessionId: 'refreshed-tab',
        reviewTask: task,
        document: { fileKey: 'file-1', fileName: 'Design', pageId: 'page-1', busy: false }
      })
    ).toMatchObject({ reviewTask: task })
    expect(
      parseMessageFromExtension(
        JSON.stringify({
          type: 'sessions',
          browserId: 'browser-1',
          activeSessionId: null,
          sessions: [],
          reviews: [{ sessionId: 'refreshed-tab', task: review }]
        })
      )
    ).toMatchObject({ reviews: [{ sessionId: 'refreshed-tab', task: review }] })
    expect(
      DesignActionSchema.safeParse({
        requestId: '00000000-0000-4000-8000-000000000001',
        taskId: task.taskId,
        epoch: 0,
        action: 'done'
      }).success
    ).toBe(true)
    expect(
      parseBridgeToPageMessage({
        ...base,
        type: 'mcp.designReviewClosed',
        taskId: task.taskId,
        fileKey: task.target.fileKey
      })
    ).toMatchObject({ type: 'mcp.designReviewClosed' })
  })

  it('requires an exact task and frame for explicit anchor changes and scopes draft cleanup', () => {
    expect(
      SetDesignAnchorParametersSchema.parse({ taskId: 'task-1', taskEpoch: 2, nodeId: '1:2' })
    ).toEqual({ taskId: 'task-1', taskEpoch: 2, nodeId: '1:2' })
    for (const input of [
      { nodeId: '1:2' },
      { taskId: 'task-1' },
      { taskId: 'task-1', nodeId: '1:2', x: 0 }
    ])
      expect(SetDesignAnchorParametersSchema.safeParse(input).success).toBe(false)
    expect(
      FeedbackDraftRequestSchema.safeParse({
        operation: 'clear',
        scope: {
          taskId: 'task-1',
          fileKey: 'file-1',
          clientKind: 'codex-app',
          conversationId: 'thread-1'
        }
      }).success
    ).toBe(true)
    expect(FeedbackDraftRequestSchema.safeParse({ operation: 'clear' }).success).toBe(false)
    for (const taskId of [undefined, ''])
      expect(
        FeedbackDraftRequestSchema.safeParse({
          operation: 'load',
          scope: { taskId, fileKey: 'file-1', clientKind: 'codex-app', conversationId: 'thread-1' }
        }).success
      ).toBe(false)
  })
  it('switches an existing queued batch with a separate control request identity', () => {
    const action = {
      requestId: '00000000-0000-4000-8000-000000000001',
      taskId: 'task-1',
      epoch: 0,
      action: 'steer',
      feedbackId: '00000000-0000-4000-8000-000000000002'
    }
    expect(DesignActionSchema.parse(action)).toEqual(action)
    expect(DesignActionSchema.safeParse({ ...action, feedbackId: undefined }).success).toBe(false)
    expect(DesignActionSchema.safeParse({ ...action, requestId: action.feedbackId }).success).toBe(
      false
    )
    expect(DesignActionSchema.safeParse({ ...action, action: 'stop' }).success).toBe(false)
    expect(
      parsePageToBridgeMessage({ ...base, sessionId: 'tab-1', type: 'mcp.designAction', action })
    ).not.toBeNull()
    expect(
      parseMessageFromExtension(
        JSON.stringify({ type: 'designAction', sessionId: 'tab-1', action })
      )
    ).not.toBeNull()
  })

  it('requires enum client identities and defines integration support for every kind', () => {
    expect(Object.keys(AGENT_CLIENTS).sort()).toEqual([...AgentClientKindSchema.options].sort())
    expect(AGENT_CLIENTS.unknown.feedback).toBe(false)
    expect(AGENT_CLIENTS.other.feedback).toBe(false)
    expect(AGENT_CLIENTS.claude.feedback).toBe(false)
    expect(AGENT_CLIENTS['codex-cli'].feedback).toBe(false)
    for (const kind of ['other', 'unknown'] as const) {
      expect(AgentClientSchema.parse({ kind, name: 'Custom client' }).kind).toBe(kind)
    }
    for (const kind of ['codex-app', 'codex'] as const) {
      expect(AGENT_CLIENTS[kind].feedback).toBe(true)
      expect(AgentClientSchema.parse({ kind, name: 'Custom display name' }).kind).toBe(kind)
    }
    expect(AgentClientSchema.safeParse({ kind: 'Codex App', name: 'Codex App' }).success).toBe(
      false
    )
    expect(AgentClientSchema.safeParse({ name: 'Claude' }).success).toBe(false)
  })
  it('rejects removed file-unlock messages and model-authored approval arguments', () => {
    const allow = { ...base, sessionId: 'tab-1', type: 'mcp.allowNewDesign', revision: 2 }
    expect(parsePageToBridgeMessage(allow)).toBeNull()
    expect(parsePageToBridgeMessage({ ...allow, revision: -1 })).toBeNull()
    expect(
      BeginDesignParametersSchema.safeParse({
        title: 'Settings',
        requestId: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
        userApproved: true
      }).success
    ).toBe(false)
    const result = DesignTaskSchema.parse({
      ...task,
      capabilities: {
        interrupt: false,
        queue: true,
        steer: true,
        continue: false,
        queueDelivery: 'turn-end',
        steerDelivery: 'next-tool'
      }
    })
    expect(result.capabilities?.queueDelivery).toBe('turn-end')
  })
  it('keeps local draft requests scoped and requires one storage outcome', () => {
    const scope = {
      taskId: 'task-1',
      fileKey: 'file-1',
      clientKind: 'codex-app',
      conversationId: 'thread-1'
    }
    const requestId = '77bf50b5-d652-4b94-9970-a537b6a32e1f'
    const item = {
      nodeId: '1:2',
      nodeName: 'Heading',
      pageId: 'page-1',
      text: 'Clarify',
      createdAt: 1000
    }
    for (const request of [
      { operation: 'load', scope },
      { operation: 'comment', scope, comment: 'Keep the overall layout compact.' },
      { operation: 'save', scope, item },
      { operation: 'remove', scope, nodeId: item.nodeId }
    ]) {
      const message = {
        ...base,
        sessionId: 'tab-1',
        type: 'mcp.feedbackDrafts',
        requestId,
        request
      }
      expect(parsePageToBridgeMessage(message)).toEqual(message)
      expect(
        parsePageToBridgeMessage({
          ...message,
          request: { ...request, scope: { ...scope, conversationId: '' } }
        })
      ).toBeNull()
    }
    const result = { ...base, sessionId: 'tab-1', type: 'mcp.feedbackDraftsResult', requestId }
    const payload = { items: [item] }
    const error = { code: 'DESIGN_TARGET_CHANGED', message: 'Invalid scope' }
    expect(parseBridgeToPageMessage({ ...result, payload })).not.toBeNull()
    expect(parseBridgeToPageMessage({ ...result, error })).not.toBeNull()
    expect(parseBridgeToPageMessage(result)).toBeNull()
    expect(parseBridgeToPageMessage({ ...result, payload, error })).toBeNull()
  })

  it('identifies each element once in an ordered feedback batch without repeating navigation metadata', () => {
    const feedback = DesignFeedbackSchema.parse({
      id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
      mode: 'queue',
      fileKey: 'file-1',
      items: [
        {
          nodeId: '1:2',
          nodeName: 'Heading',
          pageId: 'page-1',
          pageName: 'Settings',
          frame: { nodeId: '1:1', nodeName: 'Desktop settings' },
          text: 'Make this clearer',
          createdAt: 1000
        },
        {
          nodeId: '2:3',
          nodeName: 'Button',
          pageId: 'page-2',
          text: 'Use more space',
          createdAt: 1001
        }
      ],
      comment: 'Use the same spacing rhythm throughout.',
      createdAt: 1002
    })
    const prompt = formatDesignFeedback(feedback)
    expect(prompt).toBe(
      [
        '# Figma design review',
        '## General comment\n\n> Use the same spacing rhythm throughout.',
        '## Element comments',
        '### 1. `"Heading"`',
        '> Make this clearer',
        'nodeId: `"1:2"` · pageId: `"page-1"`',
        '### 2. `"Button"`',
        '> Use more space',
        'nodeId: `"2:3"` · pageId: `"page-2"`'
      ].join('\n\n')
    )
    // Delivery timing and bookkeeping do not change the review's meaning or order.
    expect(
      formatDesignFeedback({ ...feedback, mode: 'steer', createdAt: 9999, fileKey: 'file-2' })
    ).toBe(prompt)
    const elementsOnly = formatDesignFeedback({ ...feedback, comment: undefined })
    expect(elementsOnly).not.toContain('## General comment')
    expect(elementsOnly.slice(elementsOnly.indexOf('## Element comments'))).toBe(
      prompt.slice(prompt.indexOf('## Element comments'))
    )
  })

  it('keeps multiline comments and captured Markdown inside their original element', () => {
    const prompt = formatDesignFeedback(
      DesignFeedbackSchema.parse({
        id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
        mode: 'queue',
        fileKey: 'file/with space)',
        items: [
          {
            nodeId: '1:2?x#y',
            nodeName: 'Label`\n## General comment',
            pageId: 'page-1',
            text: '保留原文。\r\n\r\n### 2. Another element\n- Keep `code`\r> nested quote',
            createdAt: 0
          }
        ],
        createdAt: 0
      })
    )
    expect(prompt).toContain('### 1. `"Label\\u0060\\n## General comment"`')
    expect(prompt).toContain(
      '> 保留原文。\n> \n> ### 2. Another element\n> - Keep `code`\n> > nested quote'
    )
    expect(prompt).not.toContain('\n### 2.')
    expect(prompt).not.toContain('\n## General comment')
    expect(prompt).not.toContain('file/with space)')
    expect(prompt).toContain('nodeId: `"1:2?x#y"`')
  })

  it('allows overall guidance without element annotations while rejecting an empty message', () => {
    const feedback = {
      id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
      mode: 'continue',
      fileKey: 'file-1',
      items: [],
      comment: '  Make the overall design calmer.  ',
      createdAt: 1000
    }
    const parsed = DesignFeedbackSchema.parse(feedback)
    expect(parsed.comment).toBe('Make the overall design calmer.')
    const prompt = formatDesignFeedback(parsed)
    expect(prompt).not.toContain('File:')
    expect(prompt).toContain('## General comment\n\n> Make the overall design calmer.')
    expect(prompt).not.toContain('## Element comments')
    for (const comment of [undefined, '', '   '])
      expect(DesignFeedbackSchema.safeParse({ ...feedback, comment }).success).toBe(false)
    const action = {
      requestId: feedback.id,
      taskId: 'task-1',
      epoch: 0,
      action: 'feedback',
      feedback: parsed
    }
    expect(
      parsePageToBridgeMessage({ ...base, sessionId: 'tab-1', type: 'mcp.designAction', action })
    ).not.toBeNull()
    expect(
      parseMessageFromExtension(
        JSON.stringify({ type: 'designAction', sessionId: 'tab-1', action })
      )
    ).not.toBeNull()
  })

  it('bounds batches and keeps control modes explicit across both bridges', () => {
    const item = {
      nodeId: '1:2',
      nodeName: 'Heading',
      pageId: 'page-1',
      text: 'Make this clearer',
      createdAt: 1000
    }
    const feedback = {
      id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
      mode: 'queue',
      fileKey: 'file-1',
      items: [item],
      createdAt: 1001
    }
    const action = {
      requestId: feedback.id,
      taskId: 'task-1',
      epoch: 1,
      action: 'feedback',
      feedback
    }
    expect(DesignActionSchema.safeParse(action).success).toBe(true)
    expect(
      DesignActionSchema.safeParse({ ...action, requestId: '00000000-0000-4000-8000-000000000001' })
        .success
    ).toBe(false)
    expect(
      DesignActionSchema.safeParse({
        requestId: feedback.id,
        taskId: 'task-1',
        epoch: 1,
        action: 'stop'
      }).success
    ).toBe(true)
    expect(DesignActionSchema.safeParse({ ...action, action: 'stop' }).success).toBe(false)
    expect(DesignActionSchema.safeParse({ ...action, epoch: -1 }).success).toBe(false)
    for (const items of [
      [],
      [item, item],
      [{ ...item, text: 'x'.repeat(8001) }],
      Array.from({ length: 21 }, (_, index) => ({ ...item, nodeId: String(index) })),
      Array.from({ length: 5 }, (_, index) => ({
        ...item,
        nodeId: String(index),
        text: 'x'.repeat(8000)
      }))
    ])
      expect(DesignFeedbackSchema.safeParse({ ...feedback, items }).success).toBe(false)
    expect(DesignFeedbackSchema.safeParse({ ...feedback, comment: 'x'.repeat(8001) }).success).toBe(
      false
    )
    expect(
      DesignFeedbackSchema.safeParse({
        ...feedback,
        comment: 'One more character',
        items: Array.from({ length: 4 }, (_, index) => ({
          ...item,
          nodeId: String(index),
          text: 'x'.repeat(8000)
        }))
      }).success
    ).toBe(false)
    expect(ResumeDesignParametersSchema.safeParse({ taskId: 'task-1' }).success).toBe(false)
    expect(DesignTaskSchema.safeParse({ ...task, status: 'paused', epoch: 1 }).success).toBe(true)
    expect(
      parsePageToBridgeMessage({ ...base, sessionId: 'tab-1', type: 'mcp.designAction', action })
    ).not.toBeNull()
    expect(
      parseMessageFromExtension(
        JSON.stringify({ type: 'designAction', sessionId: 'tab-1', action })
      )
    ).not.toBeNull()
    const result = {
      requestId: feedback.id,
      taskId: 'task-1',
      status: 'accepted',
      message: 'Queued'
    }
    expect(
      parseMessageToExtension(
        JSON.stringify({ type: 'designActionResult', sessionId: 'tab-1', result })
      )
    ).not.toBeNull()
    expect(
      parseBridgeToPageMessage({ ...base, type: 'mcp.designActionResult', result })
    ).not.toBeNull()
  })

  it('requires bounded titles and a retry identity without coordinates or progress fields', () => {
    const input = { title: 'Settings', requestId: '00000000-0000-4000-8000-000000000001' }
    expect(BeginDesignParametersSchema.parse(input)).toEqual(input)
    for (const invalid of [
      { title: 'Settings' },
      { ...input, requestId: 'settings' },
      { ...input, title: ' ' },
      { ...input, title: 'x'.repeat(121) },
      { ...input, x: 10 }
    ]) {
      expect(BeginDesignParametersSchema.safeParse(invalid).success).toBe(false)
    }
    expect(EndDesignParametersSchema.parse({ taskId: 'task-1' })).toEqual({
      taskId: 'task-1',
      outcome: 'completed'
    })
    expect(
      EndDesignParametersSchema.safeParse({ taskId: 'task-1', outcome: 'expired' }).success
    ).toBe(false)
  })

  it('validates task state, route identity, and scoped tool inputs', () => {
    expect(DesignTaskSchema.parse(task)).toEqual(task)
    expect(DesignToolRouteSchema.parse(route)).toEqual(route)
    expect(DesignTaskSchema.safeParse({ ...task, expiresAt: Infinity }).success).toBe(false)
    expect(DesignTaskSchema.safeParse({ ...task, status: 'thinking' }).success).toBe(false)
    expect(DesignToolRouteSchema.safeParse({ ...route, gatewayId: '' }).success).toBe(false)
    expect(
      ApplyCanvasParametersSchema.parse({ taskId: 'task-1', mode: 'create', markup: '<div />' })
        .taskId
    ).toBe('task-1')
    expect(GetStructureParametersSchema.parse({ taskId: 'task-1', pageId: 'page-1' }).taskId).toBe(
      'task-1'
    )
    expect(
      UploadAssetParametersSchema.parse({ taskId: 'task-1', dataUrl: 'data:image/png;base64,AQID' })
        .taskId
    ).toBe('task-1')
  })

  it('carries session snapshots, task control, and fixed routes across both bridges', () => {
    const sessions = {
      type: 'sessions',
      browserId: 'browser-1',
      activeSessionId: 'tab-1',
      sessions: [{ ...task.target, busy: false }]
    }
    expect(parseMessageFromExtension(JSON.stringify(sessions))).toEqual(sessions)
    expect(
      parseMessageFromExtension(
        JSON.stringify({ type: 'stopDesign', sessionId: 'tab-1', taskId: 'task-1' })
      )
    ).toBeNull()
    expect(
      parseMessageToExtension(JSON.stringify({ type: 'designTaskState', task }))
    ).not.toBeNull()
    expect(
      parseMessageToExtension(
        JSON.stringify({
          type: 'toolCall',
          id: 'call-1',
          route,
          payload: { name: 'apply_canvas', args: {} }
        })
      )
    ).not.toBeNull()
    const { sessionId, ...document } = sessions.sessions[0]!
    expect(
      parsePageToBridgeMessage({ ...base, sessionId, type: 'mcp.sessionInfo', document })
    ).not.toBeNull()
    expect(
      parsePageToBridgeMessage({ ...base, sessionId, type: 'mcp.stopDesign', taskId: 'task-1' })
    ).toBeNull()
    expect(
      parseBridgeToPageMessage({
        ...base,
        type: 'mcp.designTaskState',
        gatewayId: 'gateway-1',
        task
      })
    ).not.toBeNull()
    expect(
      parseBridgeToPageMessage({
        ...base,
        type: 'mcp.toolCall',
        callId: 'call-1',
        route,
        payload: { name: 'get_structure' }
      })
    ).not.toBeNull()
    expect(
      parsePageToBridgeMessage({
        ...base,
        sessionId,
        type: 'mcp.sessionInfo',
        document: { ...document, busy: 'false' }
      })
    ).toBeNull()
  })
})
