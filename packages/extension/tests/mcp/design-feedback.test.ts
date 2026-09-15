import type { DesignFeedbackItem, DesignTask } from '@tempad-dev/shared'

import { describe, expect, it } from 'vitest'

import {
  describeFeedbackTarget,
  getFeedbackDraftScope,
  sameFeedbackItem
} from '@/mcp/design-feedback'

describe('feedback target context', () => {
  it('derives draft identity from the task and conversation independently of the page lease', () => {
    const bound: DesignTask = {
      taskId: 'task-1',
      title: 'Settings',
      target: { sessionId: 'tab-1', fileKey: 'file-1', fileName: 'Design', pageId: 'page-1' },
      status: 'active',
      operation: null,
      expiresAt: 1000,
      revision: 1,
      client: { kind: 'codex-app', name: 'Codex', sessionId: 'thread-a' }
    }
    const scope = {
      taskId: 'task-1',
      fileKey: 'file-1',
      clientKind: 'codex-app',
      conversationId: 'thread-a'
    }
    expect(getFeedbackDraftScope(bound)).toEqual(scope)
    expect(getFeedbackDraftScope({ ...bound, client: undefined })).toBeNull()
    expect(
      getFeedbackDraftScope({ ...bound, client: { kind: 'codex-app', name: 'Codex' } })
    ).toBeNull()
    expect(
      getFeedbackDraftScope({
        ...bound,
        epoch: 9,
        target: { ...bound.target, sessionId: 'reloaded-tab', pageId: 'another-page' }
      })
    ).toEqual(scope)
    expect(getFeedbackDraftScope({ ...bound, taskId: 'task-2' })).toEqual({
      ...scope,
      taskId: 'task-2'
    })
  })

  it('captures exact IDs and readable page/frame context without depending on later names', () => {
    const page = { id: '1:0', type: 'PAGE', name: 'Account', parent: null }
    const frame = { id: '2:0', type: 'FRAME', name: 'Settings / Desktop', parent: page }
    const group = { id: '3:0', type: 'GROUP', name: 'Header', parent: frame }
    const text = { id: '4:0', type: 'TEXT', name: 'Title', parent: group, removed: false }
    const target = describeFeedbackTarget(text as unknown as SceneNode)
    expect(target).toEqual({
      nodeId: '4:0',
      nodeName: 'Title',
      pageId: '1:0',
      pageName: 'Account',
      frame: { nodeId: '2:0', nodeName: 'Settings / Desktop' }
    })
    frame.name = 'Renamed'
    text.name = 'New title'
    expect(target?.nodeName).toBe('Title')
    expect(target?.frame?.nodeName).toBe('Settings / Desktop')
    expect(describeFeedbackTarget(frame as unknown as SceneNode)?.frame).toBeUndefined()
    expect(
      describeFeedbackTarget({ ...text, parent: page } as unknown as SceneNode)?.frame
    ).toBeUndefined()
    expect(describeFeedbackTarget({ ...text, removed: true } as unknown as SceneNode)).toBeNull()
    expect(describeFeedbackTarget({ ...text, parent: null } as unknown as SceneNode)).toBeNull()
  })

  it('does not clear a saved target whose captured context changed after submission', () => {
    const item: DesignFeedbackItem = {
      nodeId: '4:0',
      nodeName: 'Title',
      pageId: '1:0',
      pageName: 'Account',
      frame: { nodeId: '2:0', nodeName: 'Settings' },
      text: 'More space',
      createdAt: 10
    }
    expect(sameFeedbackItem(item, { ...item })).toBe(true)
    expect(sameFeedbackItem(item, { ...item, pageName: 'Profile' })).toBe(false)
    expect(
      sameFeedbackItem(item, { ...item, frame: { ...item.frame!, nodeName: 'Profile' } })
    ).toBe(false)
    expect(sameFeedbackItem(item, { ...item, frame: { ...item.frame!, nodeId: '3:0' } })).toBe(
      false
    )
  })
})
