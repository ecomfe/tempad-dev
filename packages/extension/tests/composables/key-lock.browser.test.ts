import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'

vi.mock('@/ui/state', async () => {
  const { shallowRef } = await import('vue')
  return {
    layoutReady: shallowRef(true),
    options: shallowRef({ deepSelectOn: true, measureOn: true })
  }
})
vi.mock('@/utils', () => ({
  getCanvas: vi.fn(),
  setLockAltKey: vi.fn(),
  setLockMetaKey: vi.fn()
}))

import { useKeyLock } from '@/composables/key-lock'
import { layoutReady, options } from '@/ui/state'
import { getCanvas, setLockAltKey, setLockMetaKey } from '@/utils'

import { mount, unmountAll } from '../components/mount'

let canvas: HTMLElement
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const host = document.createElement('div')
  const parent = host.appendChild(document.createElement('div'))
  canvas = parent.appendChild(document.createElement('div'))
  document.body.append(host)
  vi.spyOn(canvas, 'matches').mockReturnValue(true)
  vi.mocked(getCanvas).mockReturnValue(canvas)
  layoutReady.value = true
  options.value = { deepSelectOn: true, measureOn: true } as typeof options.value
  mount(
    defineComponent({
      setup() {
        useKeyLock()
        return () => null
      }
    })
  )
})
afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('clears a lost Space keyup on blur and restores both locks on focus', async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
  expect(setLockMetaKey).toHaveBeenLastCalledWith(false)
  const cursorHost = canvas.parentElement!.parentElement!
  cursorHost.dataset.tpCursorOverride = ''
  window.dispatchEvent(new Event('blur'))
  expect(cursorHost.dataset.tpCursorOverride).toBeUndefined()
  window.dispatchEvent(new Event('focus'))
  canvas.dispatchEvent(new MouseEvent('mouseenter'))
  await nextTick()
  expect(setLockMetaKey).toHaveBeenLastCalledWith(true)
  expect(setLockAltKey).toHaveBeenLastCalledWith(true)
})

it('clears a lost Alt keyup when hidden and waits for focus before restoring measurement', async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))
  expect(setLockAltKey).toHaveBeenLastCalledWith(false)
  vi.mocked(document.hasFocus).mockReturnValue(false)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(setLockAltKey).toHaveBeenLastCalledWith(false)
  vi.mocked(document.hasFocus).mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  await nextTick()
  expect(setLockAltKey).toHaveBeenLastCalledWith(true)
})

it('resets pressed keys when the layout or measurement mode is disabled', async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))
  options.value = { ...options.value, measureOn: false }
  await nextTick()
  options.value = { ...options.value, measureOn: true }
  await nextTick()
  expect(setLockAltKey).toHaveBeenLastCalledWith(true)

  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
  layoutReady.value = false
  await nextTick()
  layoutReady.value = true
  await nextTick()
  canvas.dispatchEvent(new MouseEvent('mouseleave'))
  canvas.dispatchEvent(new MouseEvent('mouseenter'))
  expect(setLockAltKey).toHaveBeenLastCalledWith(true)
  expect(setLockMetaKey).toHaveBeenLastCalledWith(true)
})

it('does not restore locks from pending timers or preference changes while inactive', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  canvas.dispatchEvent(new WheelEvent('wheel'))
  canvas.dispatchEvent(new PointerEvent('pointerdown'))
  window.dispatchEvent(new Event('blur'))
  options.value = { ...options.value, deepSelectOn: false, measureOn: false }
  await nextTick()
  options.value = { ...options.value, deepSelectOn: true, measureOn: true }
  await nextTick()
  await vi.advanceTimersByTimeAsync(200)
  expect(setLockAltKey).toHaveBeenLastCalledWith(false)
  expect(setLockMetaKey).toHaveBeenLastCalledWith(false)
})

it('cancels pending pointer and wheel callbacks when disposed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  canvas.dispatchEvent(new PointerEvent('pointerdown'))
  canvas.dispatchEvent(new WheelEvent('wheel'))
  unmountAll()
  expect(setLockAltKey).toHaveBeenLastCalledWith(false)
  expect(setLockMetaKey).toHaveBeenLastCalledWith(false)
  vi.mocked(setLockAltKey).mockClear()
  vi.mocked(setLockMetaKey).mockClear()
  await vi.advanceTimersByTimeAsync(200)
  expect(setLockAltKey).not.toHaveBeenCalled()
  expect(setLockMetaKey).not.toHaveBeenCalled()
})
