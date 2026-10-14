import { afterEach, describe, expect, it, vi } from 'vitest'

import { canvasHoverContains, observeCanvasOverlay, placeCanvasPopover } from '@/mcp/canvas-overlay'

const mocks = vi.hoisted(() => ({
  rect: vi.fn(() => ({ left: 10, top: 20, width: 600, height: 500 }))
}))
vi.mock('@/utils/figma', () => ({ getCanvas: () => ({ getBoundingClientRect: mocks.rect }) }))
const dispose: Array<() => void> = []
afterEach(() => {
  dispose.splice(0).forEach((stop) => stop())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared canvas overlay frame', () => {
  it.each([
    { action: 'activity', idle: false },
    { action: 'activity', idle: true },
    { action: 'resubscribe', idle: false },
    { action: 'resubscribe', idle: true }
  ])('keeps one shared loop after $action reentry (idle: $idle)', ({ action, idle }) => {
    vi.useFakeTimers()
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const events = new EventTarget()
    vi.stubGlobal('window', events)
    vi.stubGlobal('document', new EventTarget())
    const runFrame = () => {
      expect(frames.size).toBe(1)
      const [id, callback] = [...frames][0]!
      frames.delete(id)
      callback(performance.now())
    }
    let reenter = false
    let stop = observeCanvasOverlay(() => {
      if (!reenter) return
      reenter = false
      if (action === 'activity') events.dispatchEvent(new Event('pointermove'))
      else {
        stop()
        stop = observeCanvasOverlay(vi.fn())
      }
    })
    dispose.push(() => stop())
    if (idle) {
      now.mockReturnValue(1000)
      runFrame()
      expect(frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(1)
    }
    reenter = true
    if (idle) vi.advanceTimersByTime(100)
    else runFrame()
    expect(frames.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    stop()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    events.dispatchEvent(new Event('pointermove'))
    expect(frames.size).toBe(0)
  })

  it('measures once per frame for task status and annotation observers, and stops only after the last subscriber', () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let frame!: FrameRequestCallback
    const raf = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    const cancel = vi.fn()
    const api = {
      fileKey: 'file-a',
      currentPage: { id: 'page-a', selection: [{ id: 'node-a' }] },
      viewport: { bounds: { x: 0, y: 0, width: 600, height: 500 }, zoom: 1 }
    }
    const events = new EventTarget()
    vi.stubGlobal('window', Object.assign(events, { figma: api }))
    vi.stubGlobal('document', Object.assign(new EventTarget(), { querySelectorAll: () => [] }))
    vi.stubGlobal('location', { pathname: '/design/file-a/Design' })
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const status = vi.fn(),
      annotations = vi.fn()
    const stopStatus = observeCanvasOverlay(status)
    dispose.push(stopStatus)
    const stopAnnotations = observeCanvasOverlay(annotations)
    dispose.push(stopAnnotations)
    const failingObserver = () => {
      throw new Error('Detached native node')
    }
    let stopFailing!: () => void
    expect(() => {
      stopFailing = observeCanvasOverlay(failingObserver)
    }).not.toThrow()
    dispose.push(stopFailing)
    expect(raf).toHaveBeenCalledTimes(1)
    expect(mocks.rect).toHaveBeenCalledTimes(1)
    expect(status.mock.calls[0]![0]).toBe(annotations.mock.calls[0]![0])
    const now = vi.spyOn(performance, 'now')
    api.viewport.zoom = 2
    api.viewport.bounds.x = 40
    api.currentPage.selection = [{ id: 'node-b' }]
    frame(16)
    expect(raf).toHaveBeenCalledTimes(2)
    expect(mocks.rect).toHaveBeenCalledTimes(2)
    expect(status.mock.lastCall![0]).toBe(annotations.mock.lastCall![0])
    expect(annotations.mock.lastCall![0]).toMatchObject({
      zoom: 2,
      bounds: { x: 40 },
      selectedNode: { id: 'node-b' }
    })
    mocks.rect.mockReturnValueOnce({ left: 0, top: 0, width: 0, height: 0 })
    frame(32)
    expect(status.mock.lastCall![0]).toBeNull()
    expect(annotations.mock.lastCall![0]).toBeNull()
    now.mockReturnValue(performance.now() + 1000)
    frame(1000)
    const measurements = mocks.rect.mock.calls.length
    const scheduledFrames = raf.mock.calls.length
    const deliveries = status.mock.calls.length
    api.viewport.zoom = 3
    vi.advanceTimersByTime(99)
    expect(status).toHaveBeenCalledTimes(deliveries)
    vi.advanceTimersByTime(1)
    expect(status.mock.lastCall![0]).toMatchObject({ zoom: 3 })
    expect(mocks.rect).toHaveBeenCalledTimes(measurements + 1)
    expect(raf).toHaveBeenCalledTimes(scheduledFrames)
    // A new observer shares the idle snapshot without starting a second polling loop.
    const idleObserver = vi.fn()
    const stopIdle = observeCanvasOverlay(idleObserver)
    dispose.push(stopIdle)
    expect(idleObserver.mock.lastCall![0]).toBe(status.mock.lastCall![0])
    expect(vi.getTimerCount()).toBe(1)
    // Pointer activity resumes frame-rate updates immediately, cancelling the idle timer.
    events.dispatchEvent(new Event('pointermove'))
    expect(raf).toHaveBeenCalledTimes(scheduledFrames + 1)
    expect(vi.getTimerCount()).toBe(0)
    frame(1016)
    expect(mocks.rect).toHaveBeenCalledTimes(measurements + 2)
    stopIdle()
    stopFailing()
    stopStatus()
    expect(cancel).not.toHaveBeenCalled()
    stopAnnotations()
    expect(cancel).toHaveBeenCalledOnce()
    const stoppedFrames = raf.mock.calls.length
    events.dispatchEvent(new Event('pointermove'))
    expect(raf).toHaveBeenCalledTimes(stoppedFrames)
    // Disposing the last observer while idle cancels the polling timer too.
    const stop = observeCanvasOverlay(vi.fn())
    dispose.push(stop)
    now.mockReturnValue(2000)
    frame(2000)
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['initial', 'active', 'idle'])(
    'suspends hidden documents from %s state and resumes once visible',
    (state) => {
      vi.useFakeTimers()
      const now = vi.spyOn(performance, 'now').mockReturnValue(0)
      const frames = new Map<number, FrameRequestCallback>()
      let nextId = 0
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++nextId, callback)
        return nextId
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
      const events = new EventTarget()
      const page = Object.assign(new EventTarget(), {
        hidden: state === 'initial',
        querySelectorAll: () => []
      })
      const remove = vi.spyOn(page, 'removeEventListener')
      vi.stubGlobal('document', page)
      vi.stubGlobal(
        'window',
        Object.assign(events, {
          figma: {
            fileKey: 'file-a',
            currentPage: { id: 'page-a', selection: [] },
            viewport: { bounds: { x: 0, y: 0, width: 600, height: 500 }, zoom: 1 }
          }
        })
      )
      const observer = vi.fn()
      const stop = observeCanvasOverlay(observer)
      dispose.push(stop)
      if (state === 'idle') {
        now.mockReturnValue(1000)
        const [id, callback] = [...frames][0]!
        frames.delete(id)
        callback(1000)
        expect(vi.getTimerCount()).toBe(1)
      }
      page.hidden = true
      page.dispatchEvent(new Event('visibilitychange'))
      const measurements = mocks.rect.mock.calls.length
      const deliveries = observer.mock.calls.length
      expect(frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      if (state === 'initial') expect(deliveries).toBe(0)
      events.dispatchEvent(new Event('pointermove'))
      vi.advanceTimersByTime(1000)
      expect(frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(mocks.rect).toHaveBeenCalledTimes(measurements)
      expect(observer).toHaveBeenCalledTimes(deliveries)
      page.hidden = false
      page.dispatchEvent(new Event('visibilitychange'))
      expect(mocks.rect).toHaveBeenCalledTimes(measurements + 1)
      expect(observer).toHaveBeenCalledTimes(deliveries + 1)
      expect(frames.size).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
      stop()
      expect(frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      page.dispatchEvent(new Event('visibilitychange'))
      events.dispatchEvent(new Event('pointermove'))
      expect(mocks.rect).toHaveBeenCalledTimes(measurements + 1)
      expect(frames.size).toBe(0)
    }
  )
})

describe('canvas popover placement', () => {
  it.each([
    ['bottom-right', { x: 40, y: 40 }, { x: 40, y: 40 }],
    ['bottom-left', { x: 400, y: 40 }, { x: 116, y: 40 }],
    ['top-right', { x: 280, y: 430 }, { x: 280, y: 346 }],
    ['top-left', { x: 400, y: 430 }, { x: 116, y: 346 }]
  ])('flips to the %s before shifting', (_, point, expected) => {
    expect(
      placeCanvasPopover(
        { ...point, width: 16, height: 16 },
        { width: 300, height: 100 },
        { width: 600, height: 500 }
      )
    ).toEqual(expected)
  })

  it('uses the largest area before shifting when no candidate fits', () => {
    // No corner fits the popup. The bottom-right has the largest available area.
    expect(
      placeCanvasPopover(
        { x: 100, y: 40, width: 16, height: 16 },
        { width: 240, height: 100 },
        { width: 300, height: 180 }
      )
    ).toEqual({ x: 52, y: 40 })
  })

  it.each([-1500, 1500])(
    'keeps an offscreen target at %s reachable inside the canvas',
    (position) => {
      const point = placeCanvasPopover(
        { x: position, y: position, width: 16, height: 16 },
        { width: 244, height: 164 },
        { width: 260, height: 180 }
      )
      expect(point).toEqual({ x: 8, y: 8 })
    }
  )
})

describe('passive canvas hover retention', () => {
  it('retains diagonal travel to the lower-right entry without enlarging the region to a rectangle', () => {
    const areas = [
      { x: 120, y: 100, width: 120, height: 360 },
      { x: 245, y: 488, width: 24, height: 24 }
    ]
    expect(canvasHoverContains({ x: 244, y: 300 }, areas)).toBe(true)
    expect(canvasHoverContains({ x: 256, y: 200 }, areas)).toBe(false)
    expect(canvasHoverContains({ x: 120, y: 100 }, areas)).toBe(true)
    expect(canvasHoverContains({ x: 257, y: 500 }, areas)).toBe(true)
    expect(canvasHoverContains({ x: 0, y: 0 }, [])).toBe(false)
  })
})
