import type { DesignFeedback, DesignFeedbackItem, FeedbackDraftScope } from '@tempad-dev/shared'

import { describe, expect, it } from 'vitest'

import { FeedbackDraftStore, feedbackDraftKey } from '@/mcp/broker/feedback-drafts'

const scope: FeedbackDraftScope = {
  taskId: 'task-a',
  fileKey: 'file-a',
  clientKind: 'codex-app',
  conversationId: 'thread-a'
}
const first: DesignFeedbackItem = {
  nodeId: '1:2',
  pageId: 'page-a',
  nodeName: 'Heading',
  text: 'More space',
  createdAt: 1000
}
const second: DesignFeedbackItem = {
  ...first,
  nodeId: '2:3',
  pageId: 'page-b',
  nodeName: 'Button',
  text: 'Use a larger label',
  createdAt: 1001
}
const batch: DesignFeedback = {
  id: '77bf50b5-d652-4b94-9970-a537b6a32e1f',
  mode: 'queue',
  fileKey: 'file-a',
  items: [first, second],
  createdAt: 1002
}

function fixture() {
  const data: Record<string, unknown> = {}
  const storage = {
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
  return { data, storage, store: new FeedbackDraftStore(storage) }
}

describe('extension-local element feedback', () => {
  it('isolates tasks within one conversation, including identical notes and late receipts', async () => {
    const f = fixture()
    const nextScope = { ...scope, taskId: 'task-b' }
    const comment = 'Keep the spacing consistent.'
    const feedback = { ...batch, items: [first], comment }
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'comment', scope, comment })
    await f.store.recordSubmission(scope, feedback)
    const reopened = new FeedbackDraftStore(f.storage)
    expect(await reopened.request({ operation: 'load', scope })).toEqual({
      items: [first],
      comment,
      submission: feedback
    })
    expect(await reopened.request({ operation: 'load', scope: nextScope })).toEqual({ items: [] })
    await reopened.request({ operation: 'save', scope: nextScope, item: first })
    await reopened.request({ operation: 'comment', scope: nextScope, comment })
    await reopened.settle(feedback.id, 'delivered')
    expect(await reopened.request({ operation: 'load', scope })).toEqual({ items: [] })
    await reopened.request({ operation: 'clear', scope })
    expect(await reopened.request({ operation: 'load', scope: nextScope })).toEqual({
      items: [first],
      comment
    })
  })

  it('does not assign legacy conversation-wide drafts or receipts to a new task', async () => {
    const f = fixture()
    const legacyScope = {
      fileKey: scope.fileKey,
      clientKind: scope.clientKind,
      conversationId: scope.conversationId
    }
    const legacy = {
      ['tempad.feedback-drafts.v1.' + JSON.stringify(Object.values(legacyScope))]: {
        items: [first]
      },
      ['tempad.feedback-drafts.v1.submission.' + batch.id]: { scope: legacyScope, feedback: batch }
    }
    await f.storage.set(legacy)
    expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [] })
    await f.store.settle(batch.id, 'delivered')
    expect(f.data).toEqual(legacy)
  })

  it('clears a finished round after pending saves without deleting another conversation or reviving it on a late receipt', async () => {
    const f = fixture()
    const otherScope = { ...scope, conversationId: 'another-thread' }
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'comment', scope, comment: 'Last edit' })
    await f.store.recordSubmission(scope, { ...batch, items: [first], comment: 'Last edit' })
    await f.store.request({ operation: 'save', scope: otherScope, item: second })
    const saving = f.store.request({ operation: 'comment', scope, comment: 'Last edit' })
    const clearing = f.store.request({ operation: 'clear', scope })
    await saving
    await expect(clearing).resolves.toEqual({ items: [] })
    const reopened = new FeedbackDraftStore(f.storage)
    expect(await reopened.request({ operation: 'load', scope })).toEqual({ items: [] })
    await reopened.request({ operation: 'comment', scope, comment: 'Last edit' })
    await reopened.request({ operation: 'save', scope, item: first })
    await reopened.settle(batch.id, 'delivered')
    expect(await reopened.request({ operation: 'load', scope })).toEqual({
      items: [first],
      comment: 'Last edit'
    })
    expect(await reopened.request({ operation: 'load', scope: otherScope })).toEqual({
      items: [second]
    })
  })
  it('restores and settles guidance-only delivery after the originating tab has closed', async () => {
    const f = fixture()
    const feedback = { ...batch, items: [], comment: 'Make the whole page calmer.' }
    await f.store.request({ operation: 'comment', scope, comment: feedback.comment })
    await f.store.recordSubmission(scope, feedback)
    const restarted = new FeedbackDraftStore(f.storage)
    expect(await restarted.request({ operation: 'load', scope })).toEqual({
      items: [],
      comment: feedback.comment,
      submission: feedback
    })
    await restarted.settle(feedback.id, 'delivered')
    expect(await restarted.request({ operation: 'load', scope })).toEqual({ items: [] })
    expect(f.data).toEqual({})
  })

  it('persists overall guidance and preserves its newer revision after a delayed receipt', async () => {
    const f = fixture()
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'save', scope, item: second })
    await f.store.request({ operation: 'comment', scope, comment: 'Keep the page compact.' })
    const submission = { ...batch, comment: 'Keep the page compact.' }
    await f.store.recordSubmission(scope, submission)
    const restarted = new FeedbackDraftStore(f.storage)
    expect(await restarted.request({ operation: 'load', scope })).toEqual({
      items: [first, second],
      comment: submission.comment,
      submission
    })
    await restarted.request({ operation: 'comment', scope, comment: 'Use more space instead.' })
    await expect(restarted.recordSubmission(scope, submission)).rejects.toThrow('changed')
    await restarted.settle(batch.id, 'delivered')
    expect(await restarted.request({ operation: 'load', scope })).toEqual({
      items: [],
      comment: 'Use more space instead.'
    })
    await restarted.request({ operation: 'comment', scope, comment: '' })
    expect(f.data).toEqual({})
  })

  it('clears only acknowledged overall guidance and includes it in the total text limit', async () => {
    const f = fixture()
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'comment', scope, comment: 'Keep it compact.' })
    const submission = { ...batch, items: [first], comment: 'Keep it compact.' }
    await f.store.recordSubmission(scope, submission)
    expect(
      (await f.store.request({ operation: 'comment', scope, comment: 'Keep it compact.' }))
        .submission
    ).toEqual(submission)
    await f.store.settle(batch.id, 'delivered')
    expect(f.data).toEqual({})
    for (let index = 0; index < 4; index++)
      await f.store.request({
        operation: 'save',
        scope,
        item: { ...first, nodeId: String(index), text: 'x'.repeat(8000) }
      })
    await expect(f.store.request({ operation: 'comment', scope, comment: 'More' })).rejects.toThrow(
      '32,000'
    )
  })

  it('removes obsolete submission copies when drafts are edited or deleted', async () => {
    const f = fixture()
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'save', scope, item: second })
    await f.store.recordSubmission(scope, batch)
    await f.store.settle(batch.id, 'failed')
    await f.store.request({ operation: 'remove', scope, nodeId: first.nodeId })
    expect(await f.store.request({ operation: 'load', scope })).toEqual({ items: [second] })
    await f.store.request({ operation: 'remove', scope, nodeId: second.nodeId })
    expect(f.data).toEqual({})
  })

  it('restores ordered drafts after tab and worker replacement, isolated by file and conversation', async () => {
    const f = fixture()
    await Promise.all([
      f.store.request({ operation: 'save', scope, item: first }),
      f.store.request({ operation: 'save', scope, item: second })
    ])
    const restarted = new FeedbackDraftStore(f.storage)
    expect((await restarted.request({ operation: 'load', scope })).items).toEqual([first, second])
    expect(
      (await restarted.request({ operation: 'load', scope: { ...scope, fileKey: 'file-b' } })).items
    ).toEqual([])
    expect(
      (
        await restarted.request({
          operation: 'load',
          scope: { ...scope, conversationId: 'thread-b' }
        })
      ).items
    ).toEqual([])
    await restarted.request({ operation: 'remove', scope, nodeId: first.nodeId })
    expect((await restarted.request({ operation: 'load', scope })).items).toEqual([second])
    await restarted.request({ operation: 'remove', scope, nodeId: second.nodeId })
    expect(f.data[feedbackDraftKey(scope)]).toBeUndefined()
  })

  it('settles a sent batch after its tab closes without clearing a newer edit', async () => {
    const f = fixture()
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'save', scope, item: second })
    await f.store.recordSubmission(scope, batch)
    const restarted = new FeedbackDraftStore(f.storage)
    const revised = { ...first, text: 'Even more space', createdAt: 1003 }
    await restarted.request({ operation: 'save', scope, item: revised })
    await restarted.settle(batch.id, 'delivered')
    expect(await restarted.request({ operation: 'load', scope })).toEqual({ items: [revised] })
    await restarted.settle(batch.id, 'delivered')
    expect((await restarted.request({ operation: 'load', scope })).items).toEqual([revised])
  })

  it('retains uncertain delivery identity for manual retry and never dispatches from restoration', async () => {
    const f = fixture()
    await f.store.request({ operation: 'save', scope, item: first })
    await f.store.request({ operation: 'save', scope, item: second })
    await f.store.recordSubmission(scope, batch)
    await f.store.settle(batch.id, 'failed')
    const restarted = new FeedbackDraftStore(f.storage)
    expect(await restarted.request({ operation: 'load', scope })).toEqual({
      items: [first, second],
      submission: batch
    })
    await restarted.recordSubmission(scope, batch)
    await restarted.settle(batch.id, 'delivered')
    expect(await restarted.request({ operation: 'load', scope })).toEqual({ items: [] })
  })

  it('rejects changed snapshots and storage failures without losing confirmed drafts', async () => {
    const f = fixture()
    await f.store.request({ operation: 'save', scope, item: first })
    await expect(f.store.recordSubmission(scope, batch)).rejects.toThrow('changed')
    await expect(f.store.recordSubmission({ ...scope, fileKey: 'file-b' }, batch)).rejects.toThrow(
      'another Figma file'
    )
    const original = f.storage.set
    f.storage.set = async () => {
      throw new Error('Disk full')
    }
    await expect(f.store.request({ operation: 'save', scope, item: second })).rejects.toThrow(
      'Disk full'
    )
    f.storage.set = original
    expect((await f.store.request({ operation: 'load', scope })).items).toEqual([first])
    for (let i = 0; i < 4; i++)
      await f.store.request({
        operation: 'save',
        scope,
        item: { ...first, nodeId: String(i), text: 'x'.repeat(7000) }
      })
    await expect(
      f.store.request({ operation: 'save', scope, item: { ...second, text: 'x'.repeat(8000) } })
    ).rejects.toThrow('32,000')
  })
})
