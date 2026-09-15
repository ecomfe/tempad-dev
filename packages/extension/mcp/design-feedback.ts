import type { DesignFeedbackItem, DesignTask, FeedbackDraftScope } from '@tempad-dev/shared'

/** Draft identity survives page and lease changes; authorization is checked by each boundary. */
export function getFeedbackDraftScope(task: DesignTask): FeedbackDraftScope | null {
  const client = task.client
  return client?.sessionId
    ? {
        taskId: task.taskId,
        fileKey: task.target.fileKey,
        clientKind: client.kind,
        conversationId: client.sessionId
      }
    : null
}

/** Capture readable context once; subsequent selection or renaming cannot retarget a draft. */
export function describeFeedbackTarget(
  node: SceneNode
): Omit<DesignFeedbackItem, 'text' | 'createdAt'> | null {
  if (node.removed) return null
  let parent: BaseNode | null = node.parent
  let frame: DesignFeedbackItem['frame']
  while (parent && parent.type !== 'PAGE') {
    if (!frame && parent.type === 'FRAME')
      frame = { nodeId: parent.id, nodeName: parent.name.slice(0, 256) }
    parent = parent.parent
  }
  if (!parent) return null
  return {
    nodeId: node.id,
    nodeName: node.name.slice(0, 256),
    pageId: parent.id,
    ...(parent.name ? { pageName: parent.name.slice(0, 256) } : {}),
    ...(frame ? { frame } : {})
  }
}

/** Delivery clears the submitted revision of an element, never a later edit. */
export function sameFeedbackItem(first: DesignFeedbackItem, second: DesignFeedbackItem): boolean {
  return (
    first.nodeId === second.nodeId &&
    first.pageId === second.pageId &&
    first.nodeName === second.nodeName &&
    first.pageName === second.pageName &&
    first.frame?.nodeId === second.frame?.nodeId &&
    first.frame?.nodeName === second.frame?.nodeName &&
    first.text === second.text &&
    first.createdAt === second.createdAt
  )
}
