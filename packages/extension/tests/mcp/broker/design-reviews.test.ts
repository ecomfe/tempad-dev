import type { DesignTask, FeedbackDraftScope } from '@tempad-dev/shared'

import { describe, expect, it, vi } from 'vitest'

import { DesignReviews } from '@/mcp/broker/design-reviews'
import { FeedbackDraftStore } from '@/mcp/broker/feedback-drafts'

const task: DesignTask = {
  taskId: 'task-a',
  title: 'Design',
  target: { fileKey: 'file-a', fileName: 'Design', sessionId: 'old-session', pageId: 'page-a' },
  status: 'completed',
  operation: null,
  client: { kind: 'codex-app', name: 'Codex', sessionId: 'conversation-a' },
  expiresAt: 1000,
  revision: 5
}
const scope: FeedbackDraftScope = {
  taskId: task.taskId,
  fileKey: task.target.fileKey,
  clientKind: 'codex-app',
  conversationId: 'conversation-a'
}
function storage() {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (next: Record<string, unknown>) => {
      Object.assign(values, structuredClone(next))
    },
    remove: async (key: string) => {
      delete values[key]
    }
  }
}

describe('saved design reviews', () => {
  it('keeps queued Done behind a failing save and continues after the failure', async () => {
    const data = storage()
    const persist = data.set
    const reviews = new DesignReviews(data)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let writing = false
    data.set = async () => {
      writing = true
      await blocked
      throw new Error('Storage unavailable')
    }
    const saving = expect(reviews.save(task)).rejects.toThrow('Storage unavailable')
    let closed = false
    const closing = reviews.close(task, async (values) => {
      closed = true
      await persist(values)
    })
    await vi.waitFor(() => expect(writing).toBe(true))
    expect(closed).toBe(false)
    release()
    await saving
    await closing
    expect(reviews.get('file-a')).toMatchObject({ taskId: task.taskId, reviewClosed: true })
    const restarted = new DesignReviews(data)
    await restarted.ready()
    expect(restarted.get('file-a')).toMatchObject({ reviewClosed: true })
  })

  it('restores a legacy tab only when no later review owns its file', async () => {
    const data = storage()
    const reviews = new DesignReviews(data)
    await reviews.restore(task)
    expect(reviews.get('file-a')).toEqual(task)
    const newer = { ...task, taskId: 'task-b' }
    await reviews.save(newer)
    const restarted = new DesignReviews(data)
    await restarted.restore(task)
    expect(restarted.get('file-a')).toEqual(newer)
    await expect(restarted.close(task)).rejects.toThrow('newer task')
  })

  it('commits Done with draft deletion, rejects late saves, and survives stale Hub updates and restart', async () => {
    const data = storage()
    const reviews = new DesignReviews(data)
    const drafts = new FeedbackDraftStore(data)
    await reviews.save(task)
    await drafts.request({ operation: 'comment', scope, comment: 'Saved comment' })
    const closing = reviews.close(task, (values) => drafts.closeReview(scope, values))
    await closing
    await expect(
      drafts.request({ operation: 'comment', scope, comment: 'Late autosave' })
    ).rejects.toThrow('closed')
    const reopened = new DesignReviews(data)
    expect(await reopened.save({ ...task, revision: 6 })).toMatchObject({ reviewClosed: true })
    expect(
      (await new FeedbackDraftStore(data).request({ operation: 'load', scope })).comment
    ).toBeUndefined()
    const newTask = { ...task, taskId: 'new-task', revision: 7 }
    await reopened.save(newTask)
    await drafts.request({
      operation: 'comment',
      scope: { ...scope, taskId: 'new-task' },
      comment: 'New round'
    })
    await expect(
      drafts.request({ operation: 'comment', scope, comment: 'Still closed' })
    ).rejects.toThrow('closed')
    expect(
      await drafts.request({ operation: 'load', scope: { ...scope, taskId: 'new-task' } })
    ).toEqual({ items: [], comment: 'New round' })
  })

  it('keeps drafts and the open review when Done storage fails', async () => {
    const data = storage()
    const reviews = new DesignReviews(data)
    const drafts = new FeedbackDraftStore(data)
    await reviews.save(task)
    await drafts.request({ operation: 'comment', scope, comment: 'Keep this' })
    data.set = async () => {
      throw new Error('Storage unavailable')
    }
    await expect(
      reviews.close(task, (values) => drafts.closeReview(scope, values))
    ).rejects.toThrow('Storage unavailable')
    expect(reviews.get('file-a')?.reviewClosed).toBeUndefined()
    expect(await drafts.request({ operation: 'load', scope })).toEqual({
      items: [],
      comment: 'Keep this'
    })
  })

  it('keeps a persisted Stop fence when an older active state arrives', async () => {
    const data = storage()
    const reviews = new DesignReviews(data)
    await reviews.save({ ...task, status: 'cancelled' })
    const restarted = new DesignReviews(data)
    expect(await restarted.save({ ...task, status: 'active', revision: 6 })).toMatchObject({
      status: 'cancelled'
    })
    expect(restarted.get('file-a')?.reviewClosed).toBeUndefined()
  })
})
