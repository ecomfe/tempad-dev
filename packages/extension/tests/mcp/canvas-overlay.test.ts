import { afterEach, describe, expect, it, vi } from 'vitest'

import { canvasHoverContains, observeCanvasOverlay, placeCanvasPopover } from '@/mcp/canvas-overlay'

const mocks = vi.hoisted(() => ({
  rect: vi.fn(() => ({ left: 10, top: 20, width: 600, height: 500 }))
}))
vi.mock('@/utils/figma', () => ({ getCanvas: () => ({ getBoundingClientRect: mocks.rect }) }))
const dispose: Array<() => void> = []
afterEach(() => {
  dispose.splice(0).forEach((stop) => stop())
  vi.unstubAllGlobals()
})

describe('shared canvas overlay frame', () => {
  it('measures once per frame for task status and annotation observers, and stops only after the last subscriber', () => {
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
    vi.stubGlobal('window', { figma: api })
    vi.stubGlobal('document', { querySelectorAll: () => [] })
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
    stopFailing()
    stopStatus()
    expect(cancel).not.toHaveBeenCalled()
    stopAnnotations()
    expect(cancel).toHaveBeenCalledOnce()
  })
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
