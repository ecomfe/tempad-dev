import { describe, expect, it, vi, beforeEach } from 'vitest'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  existsSync: (path: string) => files.has(path),
  mkdirSync: () => {},
  readFileSync: (path: string) => {
    if (!files.has(path)) throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
    return files.get(path)
  },
  renameSync: (from: string, to: string) => {
    files.set(to, files.get(from)!)
    files.delete(from)
  },
  writeFileSync: (path: string, data: string) => files.set(path, data)
}))

import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'

beforeEach(() => files.clear())

describe('task snapshot recovery', () => {
  it('retains only matching incompatible current pointers through task restore and save', () => {
    const future = {
      task: {
        taskId: 'future',
        title: 'Future',
        target: { fileKey: 'blocked-file', fileName: 'File', sessionId: 'session', pageId: 'page' },
        status: 'future-status',
        operation: null,
        expiresAt: 1000,
        revision: 1
      },
      requestId: 'future-request'
    }
    files.set(
      '/state/tasks.json',
      JSON.stringify({
        revision: 1,
        current: { 'blocked-file': 'future', 'mismatched-file': 'future', dangling: 'missing' },
        records: [future]
      })
    )
    const store = new DesignTaskStore('/state/tasks.json')
    const tasks = new DesignTasks({ store, createId: () => 'new', now: () => 1000 })
    tasks.restore()
    expect(tasks.current('blocked-file')).toBeUndefined()
    expect(store.blockedFiles).toEqual(new Set(['blocked-file']))
    const other = {
      sessionId: 'other',
      fileKey: 'other',
      fileName: 'Other',
      pageId: 'page',
      busy: false
    }
    expect(() =>
      tasks.begin('owner', 'extension', { ...other, fileKey: 'blocked-file' }, 'New', 'r')
    ).toThrow('Upgrade TemPad Dev MCP')
    tasks.begin('owner', 'extension', other, 'Other', 'request')
    const persisted = JSON.parse(files.get('/state/tasks.json')!)
    expect(persisted.current).toEqual({ 'blocked-file': 'future', other: 'new' })
    expect(persisted.records).toContainEqual(future)

    // Simulate the newer reader recognizing this status, without inventing a current pointer.
    persisted.records.find(
      (record: { task: { taskId: string } }) => record.task.taskId === 'future'
    ).task.status = 'paused'
    files.set('/state/tasks.json', JSON.stringify(persisted))
    const upgraded = new DesignTasks({
      store: new DesignTaskStore('/state/tasks.json'),
      createId: () => 'unused',
      now: () => 1000
    })
    upgraded.restore()
    expect(upgraded.current('blocked-file')?.task).toMatchObject({
      taskId: 'future',
      status: 'paused'
    })
    expect(upgraded.current('mismatched-file')).toBeUndefined()
    expect(upgraded.current('dangling')).toBeUndefined()
    expect(
      upgraded.resume('future', 'restored:future', 1, {
        ...future.task.target,
        busy: false
      }).task.status
    ).toBe('active')
  })

  it('isolates an incompatible record to its file and preserves its fence when saving valid tasks', () => {
    const incompatible = {
      task: { taskId: 'future', target: { fileKey: 'blocked-file' }, status: 'future-status' }
    }
    const good = {
      task: {
        taskId: 'valid',
        title: 'Valid',
        target: { fileKey: 'valid-file', fileName: 'Valid', sessionId: 'session', pageId: 'page' },
        status: 'completed',
        operation: null,
        expiresAt: 1,
        revision: 1
      },
      requestId: 'request',
      retiredAt: 1000
    }
    files.set(
      '/state/tasks.json',
      JSON.stringify({
        revision: 1,
        current: { 'blocked-file': 'future', 'valid-file': 'valid' },
        records: [good, incompatible]
      })
    )
    const store = new DesignTaskStore('/state/tasks.json')
    const snapshot = store.load()!
    expect(snapshot.records).toEqual([good])
    expect(store.blockedFiles).toEqual(new Set(['blocked-file']))
    expect(store.recoveryError).toBeUndefined()
    store.save(snapshot)
    const reopened = new DesignTaskStore('/state/tasks.json')
    expect(reopened.load()?.records).toEqual([good])
    expect(reopened.blockedFiles).toEqual(new Set(['blocked-file']))
    expect(JSON.parse(files.get('/state/tasks.json')!).records).toContainEqual(incompatible)
  })
  it('quarantines malformed state and keeps a durable write fence across restarts', () => {
    files.set('/state/tasks.json', '{broken')
    const store = new DesignTaskStore('/state/tasks.json')
    expect(store.load()).toBeUndefined()
    expect(files.get('/state/tasks.json.corrupt')).toBe('{broken')
    expect(store.recoveryError).toContain('canvas writes are blocked')
    expect(() => store.save({ revision: 0, current: {}, records: [] })).toThrow('recovery')
    const restarted = new DesignTaskStore('/state/tasks.json')
    expect(restarted.load()).toBeUndefined()
    expect(restarted.recoveryError).toContain('Stop fences')
  })

  it('accepts an absent store and atomically saves a new snapshot', () => {
    const store = new DesignTaskStore('/state/tasks.json')
    expect(store.load()).toBeUndefined()
    expect(store.recoveryError).toBeUndefined()
    const snapshot = { revision: 1, current: {}, records: [] }
    store.save(snapshot)
    expect(store.load()).toEqual(snapshot)
    expect(files.has('/state/tasks.json.tmp')).toBe(false)
  })

  it('recovers from a verified replacement snapshot without deleting quarantined evidence', () => {
    files.set('/state/tasks.json', '{broken')
    const store = new DesignTaskStore('/state/tasks.json')
    expect(store.load()).toBeUndefined()
    expect(store.recoveryError).toContain('verified complete snapshot')

    const recovered = {
      revision: 2,
      current: {},
      records: [],
      fileFences: { stopped: true }
    }
    files.set('/state/tasks.json', JSON.stringify(recovered))
    const restarted = new DesignTaskStore('/state/tasks.json')
    expect(restarted.load()).toEqual(recovered)
    expect(restarted.recoveryError).toBeUndefined()
    expect(() => restarted.save(recovered)).not.toThrow()
    expect(new DesignTaskStore('/state/tasks.json').load()).toEqual(recovered)
    expect(files.get('/state/tasks.json.corrupt')).toBe('{broken')
  })

  it('round-trips compact file fences without requiring retained task details', () => {
    const store = new DesignTaskStore('/state/tasks.json')
    const snapshot = {
      revision: 2,
      current: {},
      records: [],
      fileFences: { stopped: true, closed: false }
    }
    store.save(snapshot)
    expect(new DesignTaskStore('/state/tasks.json').load()).toEqual(snapshot)
  })

  it('round-trips read requirements as identifiable file fences for older readers', () => {
    const store = new DesignTaskStore('/state/tasks.json')
    const snapshot = {
      revision: 2,
      current: {},
      records: [],
      filesNeedingRead: ['interrupted-file']
    }
    store.save(snapshot)
    expect(JSON.parse(files.get('/state/tasks.json')!).records).toContainEqual({
      readRequired: true,
      task: { target: { fileKey: 'interrupted-file' } }
    })
    expect(new DesignTaskStore('/state/tasks.json').load()).toEqual(snapshot)
  })

  it('preserves future read markers while loading known markers and recovery generations', () => {
    const future = {
      readRequired: true,
      task: { target: { fileKey: 'future-file' } },
      futureRequirement: { nodeId: '1:1' }
    }
    const generation = '00000000-0000-4000-8000-000000000001'
    files.set(
      '/state/tasks.json',
      JSON.stringify({
        revision: 1,
        current: {},
        records: [
          { recoveryGeneration: generation },
          { readRequired: true, task: { target: { fileKey: 'known-file' } } },
          future
        ]
      })
    )
    const store = new DesignTaskStore('/state/tasks.json')
    const snapshot = store.load()!
    expect(snapshot).toMatchObject({
      filesNeedingRead: ['known-file'],
      recoveryGeneration: generation,
      records: []
    })
    expect(store.blockedFiles).toEqual(new Set(['future-file']))
    store.save(snapshot)
    expect(JSON.parse(files.get('/state/tasks.json')!).records).toContainEqual(future)
    const restarted = new DesignTaskStore('/state/tasks.json')
    expect(restarted.load()).toEqual(snapshot)
    expect(restarted.blockedFiles).toEqual(new Set(['future-file']))
  })
})
