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

beforeEach(() => files.clear())

describe('task snapshot recovery', () => {
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
})
