import { afterEach, expect, it, vi } from 'vitest'

import { observeCanvasOverlay } from '@/mcp/canvas-overlay'

let stop: (() => void) | undefined
let host: HTMLElement | undefined
afterEach(() => {
  stop?.()
  host?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reuses tooltip membership while still measuring visibility, geometry and DOM changes', async () => {
  host = document.createElement('div')
  host.id = 'fullscreen-root'
  host.innerHTML =
    '<div class="gpu-view-content"><canvas style="width:600px;height:400px"></canvas></div>'
  document.body.append(host)
  vi.stubGlobal('figma', {
    fileKey: 'fixture',
    currentPage: { id: 'page', selection: [] },
    viewport: { bounds: { x: 0, y: 0, width: 600, height: 400 }, zoom: 1 }
  })
  let frame!: FrameRequestCallback
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const query = vi.spyOn(document, 'querySelectorAll')
  const receive = vi.fn()
  stop = observeCanvasOverlay(receive)
  const scans = () =>
    query.mock.calls.filter(([selector]) => selector === '[role="tooltip"]').length
  expect(scans()).toBe(1)
  for (let i = 0; i < 20; i++) frame(i)
  expect(scans()).toBe(1)

  const tooltip = document.createElement('div')
  tooltip.role = 'tooltip'
  Object.assign(tooltip.style, {
    position: 'fixed',
    left: '30px',
    top: '40px',
    width: '80px',
    height: '20px'
  })
  host.append(tooltip)
  await Promise.resolve()
  frame(21)
  expect(receive.mock.lastCall?.[0].tooltips).toEqual([{ x: 30, y: 40, width: 80, height: 20 }])
  const discovered = scans()
  tooltip.style.left = '50px'
  await Promise.resolve()
  frame(22)
  expect(receive.mock.lastCall?.[0].tooltips[0].x).toBe(50)
  expect(scans()).toBe(discovered)
  tooltip.style.opacity = '0'
  frame(23)
  expect(receive.mock.lastCall?.[0].tooltips).toEqual([])
  tooltip.style.opacity = '1'
  tooltip.role = 'presentation'
  await Promise.resolve()
  frame(24)
  expect(receive.mock.lastCall?.[0].tooltips).toEqual([])
  tooltip.role = 'tooltip'
  await Promise.resolve()
  frame(25)
  expect(receive.mock.lastCall?.[0].tooltips).toHaveLength(1)
  tooltip.remove()
  await Promise.resolve()
  frame(26)
  expect(receive.mock.lastCall?.[0].tooltips).toEqual([])
  const beforeResubscribe = scans()
  stop()
  stop = observeCanvasOverlay(receive)
  expect(scans()).toBe(beforeResubscribe + 1)
  expect(receive.mock.lastCall?.[0].tooltips).toEqual([])
})

it('wakes idle overlays before descendant activity stops propagating and removes capture listeners', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  vi.stubGlobal('figma', {
    fileKey: 'file-a',
    currentPage: { id: 'page-a', selection: [] },
    viewport: { bounds: { x: 0, y: 0, width: 600, height: 500 }, zoom: 1 }
  })
  host = document.createElement('div')
  host.id = 'fullscreen-root'
  host.innerHTML =
    '<div class="gpu-view-content"><canvas style="width:600px;height:500px"></canvas></div>'
  const target = document.createElement('button')
  host.append(target)
  document.body.append(host)
  const stopPropagation = vi.fn((event: Event) => event.stopPropagation())
  target.addEventListener('pointermove', stopPropagation)
  const observer = vi.fn()
  stop = observeCanvasOverlay(observer)
  expect(observer).toHaveBeenCalledOnce()
  now.mockReturnValue(1000)
  const [id, callback] = [...frames][0]!
  frames.delete(id)
  callback(1000)
  expect(frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(1)
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  expect(stopPropagation).toHaveBeenCalledOnce()
  expect(frames.size).toBe(1)
  expect(vi.getTimerCount()).toBe(0)
  stop()
  expect(frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  now.mockClear()
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  expect(frames.size).toBe(0)
  expect(now).not.toHaveBeenCalled()
})
