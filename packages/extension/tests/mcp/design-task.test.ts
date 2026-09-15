import type { DesignTask, FigmaSession } from '@tempad-dev/shared'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { projectCanvasAnchor } from '@/mcp/canvas-overlay'
import { PageDesignTasks } from '@/mcp/design-task'
import { readFigmaSession } from '@/mcp/figma-session'

const route = { sessionId: 'tab-a', fileKey: 'file-a', gatewayId: 'gateway-a', taskId: 'task-a' }

function fixture() {
  let time = 1000
  let session: FigmaSession | null = {
    sessionId: 'tab-a',
    fileKey: 'file-a',
    fileName: 'Design',
    pageId: 'page-a',
    busy: false
  }
  const task: DesignTask = {
    taskId: 'task-a',
    title: 'Settings',
    target: {
      sessionId: 'tab-a',
      fileKey: 'file-a',
      fileName: 'Design',
      pageId: 'page-a'
    },
    status: 'active',
    operation: null,
    expiresAt: 1100,
    revision: 1
  }
  const changed = vi.fn()
  const guard = new PageDesignTasks({ session: () => session, now: () => time, onChange: changed })
  guard.connect('gateway-a')
  return {
    guard,
    task,
    changed,
    advance: (delta: number) => {
      time += delta
    },
    setSession: (value: FigmaSession | null) => {
      session = value
    }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('page-side design fencing', () => {
  it('restores review state without restoring a lease, and fences Done across reloads', () => {
    const f = fixture()
    f.guard.restore(f.task)
    expect(f.guard.task?.status).toBe('interrupted')
    expect(() => f.guard.enter('get_structure', {}, route)).toThrow('lease is inactive')
    f.guard.receive({ ...f.task, revision: 2 }, 'gateway-a')
    expect(f.guard.task?.status).toBe('paused')
    f.guard.receive({ ...f.task, status: 'completed', revision: 3 }, 'gateway-a')
    f.guard.acknowledge('wrong-task')
    expect(f.guard.task?.status).toBe('completed')
    f.guard.acknowledge(f.task.taskId)
    f.guard.receive({ ...f.task, epoch: 1, revision: 4 }, 'gateway-a')
    expect(f.guard.task?.status).toBe('cancelled')
    expect(() => f.guard.enter('apply_canvas', {}, { ...route, epoch: 1 })).toThrow(
      'Begin a new task'
    )
  })

  it('does not restore another file, a cancelled task, or overwrite live work', () => {
    const f = fixture()
    f.guard.restore({ ...f.task, target: { ...f.task.target, fileKey: 'other-file' } })
    f.guard.restore({ ...f.task, status: 'cancelled' })
    expect(f.guard.task).toBeNull()
    f.guard.bind(f.task, route)
    f.guard.acknowledge(f.task.taskId)
    f.guard.restore({ ...f.task, status: 'completed' })
    expect(f.guard.task?.status).toBe('active')
  })

  it('preserves an offline Stop across page refresh before the Hub can acknowledge it', () => {
    const f = fixture()
    let saved: string | null = null
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value
      }
    }
    const options = {
      session: () => ({ ...f.task.target, busy: false }),
      now: () => 1000,
      stoppedStorage: () => storage
    }
    const before = new PageDesignTasks(options)
    before.connect('gateway-a')
    before.bind(f.task, route)
    before.connect(null)
    before.stop(f.task.taskId)

    const after = new PageDesignTasks(options)
    after.restore(f.task)
    expect(after.task).toBeNull()
    after.connect('gateway-b')
    const recovery = { ...f.task, epoch: 1, revision: 3, needsRead: true }
    const newRoute = { ...route, gatewayId: 'gateway-b', epoch: 1 }
    after.receive(recovery, 'gateway-b')
    expect(after.task?.status).toBe('cancelled')
    expect(() => after.bind(recovery, newRoute)).toThrow('Begin a new task')
    expect(() => after.enter('apply_canvas', {}, newRoute)).toThrow('Begin a new task')
  })

  it('keeps Stop effective when tab storage is unavailable or corrupt', () => {
    const f = fixture()
    const guard = new PageDesignTasks({
      session: () => ({ ...f.task.target, busy: false }),
      now: () => 1000,
      stoppedStorage: () => ({
        getItem: () => 'invalid',
        setItem: () => {
          throw new Error('unavailable')
        }
      })
    })
    guard.connect('gateway-a')
    guard.bind(f.task, route)
    guard.stop(f.task.taskId)
    expect(guard.task?.status).toBe('cancelled')
    expect(() => guard.bind({ ...f.task, epoch: 1, revision: 3 }, { ...route, epoch: 1 })).toThrow(
      'Begin a new task'
    )
  })

  it('binds the recovered task in a refreshed page without accepting pre-refresh writes', () => {
    const f = fixture()
    const target = { ...f.task.target, sessionId: 'refreshed-session' }
    f.setSession({ ...target, busy: false })
    const recovered = { ...f.task, target, epoch: 1, revision: 3, needsRead: true }
    const currentRoute = { ...route, sessionId: target.sessionId, epoch: 1 }
    f.guard.receive({ ...f.task, status: 'interrupted', revision: 2 }, 'gateway-a')
    f.guard.receive(recovered, 'gateway-a')
    expect(f.guard.bind(recovered, currentRoute).taskId).toBe(f.task.taskId)
    expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('different or disconnected')
    expect(() => f.guard.enter('apply_canvas', {}, { ...currentRoute, epoch: 0 })).toThrow(
      'task lease is inactive'
    )
    expect(() => f.guard.enter('apply_canvas', {}, currentRoute)).toThrow('task lease is inactive')
    f.guard.enter('get_structure', {}, currentRoute)()
    f.guard.receive({ ...recovered, needsRead: false, revision: 4 }, 'gateway-a')
    f.guard.enter('apply_canvas', {}, currentRoute)()
    expect(f.guard.busy).toBe(false)
  })

  it('resumes its original page binding without navigating the user back to it', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    f.guard.receive({ ...f.task, status: 'paused', revision: 2 }, 'gateway-a')
    f.setSession({ ...f.task.target, pageId: 'page-b', busy: false })
    const resumed = { ...f.task, epoch: 1, revision: 3, needsRead: true }
    expect(f.guard.bind(resumed, route).target.pageId).toBe('page-a')
    f.guard.enter('get_structure', { pageId: 'page-a' }, { ...route, epoch: 1 })()
    expect(() => f.guard.enter('get_structure', {}, { ...route, epoch: 1 })).toThrow(
      'current page changed'
    )
  })

  it.each(['paused', 'completed'] as const)(
    'accepts a resumed %s task while fencing old requests and requiring a fresh read',
    (status) => {
      const f = fixture()
      f.guard.bind(f.task, route)
      f.guard.receive({ ...f.task, status, revision: 2 }, 'gateway-a')
      expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('Resume the task')
      const resumed = { ...f.task, epoch: 1, revision: 3, needsRead: true }
      f.guard.bind(resumed, { ...route, epoch: 1 })
      expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('task lease is inactive')
      expect(() => f.guard.enter('apply_canvas', {}, { ...route, epoch: 1 })).toThrow(
        'task lease is inactive'
      )
      f.guard.enter('get_structure', {}, { ...route, epoch: 1 })()
      f.guard.receive({ ...resumed, revision: 4, needsRead: false }, 'gateway-a')
      f.guard.enter('apply_canvas', {}, { ...route, epoch: 1 })()
      expect(f.guard.busy).toBe(false)
      f.guard.receive({ ...f.task, revision: 2 }, 'gateway-a')
      expect(f.guard.task?.epoch).toBe(1)
    }
  )

  it('does not create activity from a connection and acknowledges an exact target', () => {
    const { guard, task } = fixture()
    expect(guard.task).toBeNull()
    expect(guard.bind(task, route)).toEqual(task)
    expect(guard.busy).toBe(false)
  })

  it('rejects old gateways, other files, other tabs, and an unavailable runtime', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    for (const invalid of [
      undefined,
      { ...route, gatewayId: 'old' },
      { ...route, sessionId: 'other' },
      { ...route, fileKey: 'other' }
    ]) {
      expect(() => f.guard.enter('apply_canvas', {}, invalid)).toThrow('different or disconnected')
    }
    f.setSession(null)
    expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('different or disconnected')
  })

  it('ignores stale task snapshots and snapshots belonging to another file', () => {
    const { guard, task } = fixture()
    guard.receive(task, 'other-gateway')
    guard.receive({ ...task, target: { ...task.target, fileKey: 'other' } }, 'gateway-a')
    expect(guard.task).toBeNull()
    guard.bind(task, route)
    guard.receive({ ...task, status: 'completed', revision: 0 }, 'gateway-a')
    expect(guard.task?.status).toBe('active')
    guard.receive({ ...task, status: 'completed', revision: 2 }, 'gateway-a')
    expect(() => guard.enter('apply_canvas', {}, route)).toThrow('task lease is inactive')
  })

  it('expires idle ownership without clearing a running operation', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    const finish = f.guard.enter('apply_canvas', {}, route)
    f.advance(1000)
    f.guard.expire()
    expect(f.guard.busy).toBe(true)
    expect(f.guard.task?.status).toBe('active')
    expect(() => f.guard.enter('get_structure', {}, route)).toThrow('still executing')
    finish()
    finish()
    f.guard.expire()
    expect(f.guard.task?.status).toBe('expired')
    expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('task lease is inactive')
    const legacy = f.guard.enter('apply_canvas', {}, { ...route, taskId: undefined })
    legacy()
  })

  it('stops immediately before Hub acknowledgement and never revives a locally revoked task', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    f.guard.stop('unrelated')
    f.guard.stop(f.task.taskId)
    // A previously dispatched renewal can arrive after the user clicked Stop.
    f.guard.receive({ ...f.task, revision: 2, expiresAt: 2000 }, 'gateway-a')
    expect(f.guard.task?.status).toBe('cancelled')
    expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('Begin a new task')
    expect(() => f.guard.bind(f.task, route)).toThrow('Begin a new task')
    expect(() =>
      f.guard.bind({ ...f.task, epoch: 1, revision: 3 }, { ...route, epoch: 1 })
    ).toThrow('Begin a new task')
    expect(() => f.guard.enter('apply_canvas', {}, { ...route, taskId: undefined })).toThrow(
      'Begin a new task'
    )
    const next = { ...f.task, taskId: 'task-b', revision: 4 }
    const nextRoute = { ...route, taskId: next.taskId }
    expect(() => f.guard.bind(f.task, route)).toThrow('Begin a new task')
    f.guard.bind(next, nextRoute)
    f.guard.enter('apply_canvas', {}, nextRoute)()
    expect(f.guard.task?.taskId).toBe('task-b')
  })

  it('finishes a stopped transaction as cancelled and cannot restore the task after reconnecting', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    const finish = f.guard.enter('apply_canvas', {}, route)
    f.guard.stop(f.task.taskId)
    f.guard.receive({ ...f.task, status: 'paused', revision: 2 }, 'gateway-a')
    expect(f.guard.task?.status).toBe('stopping')
    finish()
    expect(f.guard.task?.status).toBe('cancelled')
    f.guard.connect('gateway-b')
    expect(() =>
      f.guard.bind({ ...f.task, epoch: 2 }, { ...route, gatewayId: 'gateway-b', epoch: 2 })
    ).toThrow('Begin a new task')
  })

  it('does not let takeover clear the physical execution flag', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    const finish = f.guard.enter('apply_canvas', {}, route)
    f.guard.stop(f.task.taskId)
    expect(f.guard.task?.status).toBe('stopping')
    const next = { ...f.task, taskId: 'task-b', revision: 3 }
    f.guard.receive(next, 'gateway-a')
    expect(() => f.guard.bind(next, route)).toThrow('still executing')
    finish()
    expect(f.guard.bind(next, route).taskId).toBe('task-b')
    expect(() => f.guard.enter('apply_canvas', {}, route)).toThrow('task lease is inactive')
  })

  it('retains busy execution across reconnection but invalidates the previous task and gateway', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    const finish = f.guard.enter('apply_canvas', {}, route)
    f.guard.connect(null)
    f.guard.connect('gateway-b')
    expect(f.guard.busy).toBe(true)
    expect(() => f.guard.enter('get_structure', {}, route)).toThrow('different or disconnected')
    finish()
    const next = { ...f.task, taskId: 'task-b', revision: 1 }
    expect(f.guard.bind(next, { ...route, gatewayId: 'gateway-b' }).taskId).toBe('task-b')
  })

  it('requires explicit targets after manual page switching', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    f.setSession({ ...f.task.target, pageId: 'page-b', busy: false })
    expect(() => f.guard.enter('apply_canvas', { mode: 'create' }, route)).toThrow(
      'current page changed'
    )
    expect(() =>
      f.guard.enter('apply_canvas', { mode: 'create', page: { name: 'Rename' } }, route)
    ).toThrow('current page changed')
    const finish = f.guard.enter('apply_canvas', { targetNodeId: 'node-a' }, route)
    finish()
    expect(() => f.guard.bind(f.task, route)).toThrow('file or page changed')
  })

  it('allows independent reads but fences taskless writes while occupied', () => {
    const f = fixture()
    f.guard.bind(f.task, route)
    const independent = { ...route, taskId: undefined }
    expect(() => f.guard.enter('apply_canvas', {}, independent)).toThrow('belongs to a design task')
    const finish = f.guard.enter('get_structure', {}, independent)
    finish()
  })
})

describe('canvas overlay geometry', () => {
  it('projects in CSS pixels without multiplying by devicePixelRatio', () => {
    expect(
      projectCanvasAnchor(
        { x: 50, y: 20, width: 100, height: 80 },
        { x: -100, y: -30, width: 500, height: 400 },
        2
      )
    ).toEqual({ x: 300, y: 100, width: 200, height: 160 })
    expect(
      projectCanvasAnchor(
        { x: -150, y: -80, width: 100, height: 80 },
        { x: -100, y: -30, width: 500, height: 400 },
        0.5
      )
    ).toEqual({ x: -25, y: -25, width: 50, height: 40 })
  })

  it('hides invalid geometry', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    for (const zoom of [0, -1, NaN, Infinity])
      expect(projectCanvasAnchor(bounds, bounds, zoom)).toBeNull()
    expect(projectCanvasAnchor({ ...bounds, width: -1 }, bounds, 1)).toBeNull()
    expect(projectCanvasAnchor({ ...bounds, height: -1 }, bounds, 1)).toBeNull()
  })
})

describe('Figma session identity', () => {
  it('uses fileKey when available and URL identity as a fallback', () => {
    vi.stubGlobal('window', { figma: undefined })
    expect(readFigmaSession('tab', false)).toBeNull()
    const api = { currentPage: { id: 'page' }, root: { name: 'Design' }, fileKey: 'file-api' }
    vi.stubGlobal('window', { figma: api })
    vi.stubGlobal('location', { pathname: '/design/file-url/title' })
    expect(readFigmaSession('tab', true)).toMatchObject({ fileKey: 'file-api', busy: true })
    vi.stubGlobal('window', { figma: { ...api, fileKey: undefined } })
    expect(readFigmaSession('tab', false)?.fileKey).toBe('file-url')
    vi.stubGlobal('location', { pathname: '/other' })
    expect(readFigmaSession('tab', false)).toBeNull()
  })
})
