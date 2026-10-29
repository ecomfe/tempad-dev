import type { DesignTask, FeedbackDraftScope } from '@tempad-dev/shared'

import { DesignTaskSchema } from '@tempad-dev/shared'
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
  it.each(['save', 'restore'] as const)(
    'keeps an offline Stop in memory after failed %s storage and does not acknowledge unpersisted Done',
    async (operation) => {
      const data = storage()
      await data.set({ 'tempad.design-reviews.v1': [task] })
      const reviews = new DesignReviews(data)
      const get = vi.spyOn(data, 'get').mockRejectedValueOnce(new Error('Storage unavailable'))
      const set = vi.spyOn(data, 'set').mockRejectedValue(new Error('Storage unavailable'))
      const stopped = { ...task, status: 'cancelled' as const }
      await expect(reviews[operation](stopped)).rejects.toThrow('Storage unavailable')
      expect(reviews.get('file-a')).toMatchObject({ status: 'cancelled' })
      expect(set).not.toHaveBeenCalled()
      await reviews.ready()
      expect(get).toHaveBeenCalledTimes(2)
      expect(reviews.get('file-a')).toMatchObject({ status: 'cancelled' })
      await expect(reviews.close(task)).rejects.toThrow('Storage unavailable')
      expect(reviews.get('file-a')).toMatchObject({ status: 'cancelled' })
      expect(reviews.get('file-a')?.reviewClosed).toBeUndefined()
      set.mockRestore()
      await reviews.save(stopped)
      const restarted = new DesignReviews(data)
      await restarted.ready()
      expect(restarted.get('file-a')).toMatchObject({ status: 'cancelled' })
    }
  )

  it('retries restoring a review after a failed write without publishing an unpersisted state', async () => {
    const data = storage()
    const write = vi.spyOn(data, 'set').mockRejectedValueOnce(new Error('Storage unavailable'))
    const reviews = new DesignReviews(data)
    await expect(reviews.restore(task)).rejects.toThrow('Storage unavailable')
    expect(reviews.get(task.target.fileKey)).toBeUndefined()
    await reviews.restore(task)
    expect(write).toHaveBeenCalledTimes(2)
    const restarted = new DesignReviews(data)
    await restarted.ready()
    expect(restarted.get(task.target.fileKey)).toEqual(task)
  })

  it('keeps a persisted Stop when Done arrives with an older completed snapshot', async () => {
    const data = storage()
    const reviews = new DesignReviews(data)
    await reviews.save({ ...task, status: 'cancelled' })
    expect(await reviews.close(task)).toMatchObject({
      status: 'cancelled',
      operation: null,
      reviewClosed: true
    })
    const restarted = new DesignReviews(data)
    await restarted.ready()
    expect(restarted.get(task.target.fileKey)).toMatchObject({
      status: 'cancelled',
      operation: null,
      reviewClosed: true
    })
  })

  it('loads valid reviews independently of malformed or future records', async () => {
    const data = storage()
    await data.set({ 'tempad.design-reviews.v1': [{ broken: true }, { ...task, future: true }] })
    const reviews = new DesignReviews(data)
    await reviews.ready()
    expect(reviews.get('file-a')).toEqual(task)
    await reviews.save({ ...task, status: 'cancelled' })
    expect(reviews.get('file-a')?.status).toBe('cancelled')
  })

  it('projects additive stored fields without weakening wire validation or losing them on save', async () => {
    const data = storage()
    const saved = {
      ...task,
      status: 'cancelled',
      futureTask: { value: 1 },
      target: { ...task.target, futureTarget: true },
      client: { ...task.client, futureClient: true },
      capabilities: {
        interrupt: false,
        queue: false,
        steer: false,
        continue: false,
        futureCapability: true
      }
    }
    await data.set({ 'tempad.design-reviews.v1': [saved] })
    const reviews = new DesignReviews(data)
    await reviews.ready()
    const projected = reviews.get('file-a')!
    expect(projected).toMatchObject({ taskId: task.taskId, status: 'cancelled' })
    expect(DesignTaskSchema.safeParse(saved).success).toBe(false)
    expect(DesignTaskSchema.safeParse(projected).success).toBe(true)
    expect(projected).not.toHaveProperty('futureTask')
    expect(projected.target).not.toHaveProperty('futureTarget')
    expect(projected.client).not.toHaveProperty('futureClient')
    expect(projected.capabilities).not.toHaveProperty('futureCapability')
    await reviews.save({ ...projected, status: 'active', revision: 6 })
    expect((await data.get('tempad.design-reviews.v1'))['tempad.design-reviews.v1']).toEqual([
      { ...saved, revision: 6 }
    ])
    const restarted = new DesignReviews(data)
    await restarted.ready()
    expect(restarted.get('file-a')).toMatchObject({ status: 'cancelled', revision: 6 })
  })

  it('preserves incompatible records and their order while saving another file or a new task', async () => {
    const data = storage()
    const future = { ...task, taskId: 'future-task', status: 'future-status' }
    const invalid = { broken: true }
    const unknownClient = { ...task, client: { ...task.client, kind: 'future-agent' } }
    await data.set({ 'tempad.design-reviews.v1': [task, future, invalid, unknownClient] })
    const reviews = new DesignReviews(data)
    await reviews.ready()
    const other = { ...task, taskId: 'other', target: { ...task.target, fileKey: 'other-file' } }
    await reviews.save(other)
    expect((await data.get('tempad.design-reviews.v1'))['tempad.design-reviews.v1']).toEqual([
      task,
      future,
      invalid,
      unknownClient,
      other
    ])
    const fresh = { ...task, taskId: 'fresh-task' }
    await reviews.save(fresh)
    expect((await data.get('tempad.design-reviews.v1'))['tempad.design-reviews.v1']).toEqual([
      future,
      invalid,
      unknownClient,
      other,
      fresh
    ])
    const restarted = new DesignReviews(data)
    await restarted.ready()
    expect(restarted.get('file-a')?.taskId).toBe('fresh-task')
  })

  it('flushes an unsaved Stop alongside another file without reviving cleared identity fields', async () => {
    const data = storage()
    const saved = { ...task, client: { ...task.client, futureClient: true }, futureTask: true }
    await data.set({ 'tempad.design-reviews.v1': [saved] })
    const reviews = new DesignReviews(data)
    await reviews.ready()
    const set = vi.spyOn(data, 'set').mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(
      reviews.save({ ...task, client: undefined, status: 'cancelled' })
    ).rejects.toThrow()
    const other = { ...task, taskId: 'other', target: { ...task.target, fileKey: 'other-file' } }
    await reviews.save(other)
    expect(set).toHaveBeenCalledTimes(2)
    const restarted = new DesignReviews(data)
    await restarted.ready()
    expect(restarted.get('file-a')).toMatchObject({ status: 'cancelled' })
    expect(restarted.get('file-a')?.client).toBeUndefined()
    expect((await data.get('tempad.design-reviews.v1'))['tempad.design-reviews.v1']).toEqual([
      {
        ...task,
        client: undefined,
        status: 'cancelled',
        reviewClosed: undefined,
        futureTask: true
      },
      other
    ])
  })

  it('merges an offline Stop without replacing a newer review', async () => {
    const reviews = new DesignReviews(storage())
    await reviews.save(task)
    await reviews.restore({ ...task, status: 'cancelled' })
    expect(reviews.get('file-a')?.status).toBe('cancelled')
    await reviews.save({ ...task, taskId: 'new-task' })
    await reviews.restore({ ...task, status: 'cancelled' })
    expect(reviews.get('file-a')?.taskId).toBe('new-task')
  })
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
