import type {
  DesignFeedback,
  FeedbackDraftRequest,
  FeedbackDraftScope,
  FeedbackDraftSnapshot
} from '@tempad-dev/shared'

import {
  DesignFeedbackSchema,
  FeedbackDraftScopeSchema,
  FeedbackDraftSnapshotSchema,
  MCP_DESIGN_FEEDBACK_MAX_ITEMS,
  MCP_DESIGN_FEEDBACK_MAX_TEXT
} from '@tempad-dev/shared'

import { sameFeedbackItem } from '@/mcp/design-feedback'

import { createSerialQueue } from './serial'

type Storage = {
  get(key: string): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}
// Legacy conversation-wide drafts have no trustworthy task owner; do not import them.
const PREFIX = 'tempad.feedback-drafts.v2.'

export function feedbackDraftKey(scope: FeedbackDraftScope): string {
  return (
    PREFIX + JSON.stringify([scope.fileKey, scope.clientKind, scope.conversationId, scope.taskId])
  )
}

/** Extension-local drafts outlive a page, tab, Hub, and service worker. Never auto-send them. */
export class FeedbackDraftStore {
  private readonly serial = createSerialQueue()
  constructor(private readonly storage: Storage) {}

  private async read(scope: FeedbackDraftScope): Promise<FeedbackDraftSnapshot> {
    const key = feedbackDraftKey(scope)
    const value = (await this.storage.get(key))[key]
    return value === undefined ? { items: [] } : FeedbackDraftSnapshotSchema.parse(value)
  }

  private async write(scope: FeedbackDraftScope, snapshot: FeedbackDraftSnapshot): Promise<void> {
    const key = feedbackDraftKey(scope)
    if (!snapshot.items.length && !snapshot.comment && !snapshot.submission)
      await this.storage.remove(key)
    else await this.storage.set({ [key]: snapshot })
  }

  request(request: FeedbackDraftRequest): Promise<FeedbackDraftSnapshot> {
    return this.serial(async () => {
      if (!['load', 'clear'].includes(request.operation)) await this.assertOpen(request.scope)
      const snapshot = await this.read(request.scope)
      if (request.operation === 'load') return snapshot
      if (request.operation === 'clear') {
        await this.advanceRound(request.scope)
        return { items: [] }
      }
      const comment = request.operation === 'comment' ? request.comment.trim() : snapshot.comment
      if (request.operation === 'comment' && (comment || undefined) === snapshot.comment)
        return snapshot
      let items = [...snapshot.items]
      if (request.operation === 'remove')
        items = items.filter((item) => item.nodeId !== request.nodeId)
      else if (request.operation === 'save') {
        const index = items.findIndex((item) => item.nodeId === request.item.nodeId)
        if (index < 0) items.push(request.item)
        else items[index] = request.item
      }
      if (
        items.length > MCP_DESIGN_FEEDBACK_MAX_ITEMS ||
        items.reduce((length, item) => length + item.text.length, comment?.length ?? 0) >
          MCP_DESIGN_FEEDBACK_MAX_TEXT
      ) {
        throw new Error('A feedback batch can contain up to 20 elements and 32,000 characters.')
      }
      // An explicit edit or deletion replaces the old batch. Keep any in-flight
      // receipt separately so a late acknowledgement can still settle safely.
      const next = { items, ...(comment ? { comment } : {}) }
      await this.write(request.scope, next)
      return next
    })
  }

  private async assertOpen(scope: FeedbackDraftScope): Promise<void> {
    const key = feedbackDraftKey(scope) + '.closed'
    if ((await this.storage.get(key))[key]) throw new Error('This design review is closed.')
  }

  closeReview(scope: FeedbackDraftScope, values: Record<string, unknown>): Promise<void> {
    return this.serial(() =>
      this.advanceRound(scope, { ...values, [feedbackDraftKey(scope) + '.closed']: true })
    )
  }

  private async advanceRound(
    scope: FeedbackDraftScope,
    values: Record<string, unknown> = {}
  ): Promise<void> {
    const key = feedbackDraftKey(scope)
    const roundKey = key + '.round'
    const round = (await this.storage.get(roundKey))[roundKey] as number | undefined
    // Fence old receipts even if text repeats; Done also commits its closed review here.
    await this.storage.set({ ...values, [key]: { items: [] }, [roundKey]: (round ?? 0) + 1 })
  }

  recordSubmission(scope: FeedbackDraftScope, feedback: DesignFeedback): Promise<void> {
    return this.serial(async () => {
      await this.assertOpen(scope)
      if (scope.fileKey !== feedback.fileKey)
        throw new Error('Feedback belongs to another Figma file.')
      const snapshot = await this.read(scope)
      if (
        (feedback.comment ?? '') !== (snapshot.comment ?? '') ||
        !feedback.items.every((item) =>
          snapshot.items.some((saved) => sameFeedbackItem(item, saved))
        )
      ) {
        throw new Error('Drafts changed in another tab. Reload the drafts before sending.')
      }
      const roundKey = feedbackDraftKey(scope) + '.round'
      const round = (await this.storage.get(roundKey))[roundKey]
      // Save the delivery identity before dispatch, including when the tab closes immediately.
      await this.storage.set({
        [feedbackDraftKey(scope)]: { ...snapshot, submission: feedback },
        [PREFIX + 'submission.' + feedback.id]: { scope, feedback, round }
      })
    })
  }

  settle(requestId: string, status: 'delivered' | 'failed'): Promise<void> {
    return this.serial(async () => {
      const key = PREFIX + 'submission.' + requestId
      const value = (await this.storage.get(key))[key] as
        | { scope?: unknown; feedback?: unknown; round?: unknown }
        | undefined
      if (!value) return
      const scope = FeedbackDraftScopeSchema.parse(value.scope)
      const feedback = DesignFeedbackSchema.parse(value.feedback)
      const roundKey = feedbackDraftKey(scope) + '.round'
      const round = (await this.storage.get(roundKey))[roundKey]
      if (status === 'delivered' && round === value.round) {
        const snapshot = await this.read(scope)
        const items = snapshot.items.filter(
          (item) => !feedback.items.some((sent) => sameFeedbackItem(item, sent))
        )
        const submission = snapshot.submission?.id === requestId ? undefined : snapshot.submission
        const comment = snapshot.comment === feedback.comment ? undefined : snapshot.comment
        await this.write(scope, {
          items,
          ...(comment ? { comment } : {}),
          ...(submission ? { submission } : {})
        })
      }
      // A failed/uncertain submission remains in the snapshot for an explicit, deduplicated retry.
      await this.storage.remove(key)
    })
  }
}
