import { useEventListener, useMutationObserver } from '@vueuse/core'
import { onScopeDispose, shallowRef, watch } from 'vue'

import { layoutReady, options } from '@/ui/state'
import { getCanvas, setLockAltKey, setLockMetaKey } from '@/utils'

let spacePressed = false
let altPressed = false
let windowActive = true
let duplicateClass: string | null = null
let classSnapshot = new Set<string>()
const cursorHost = shallowRef<HTMLElement | null>(null)
const canvas = shallowRef<HTMLElement | null>(null)
const DUPLICATE_URL_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAIZElEQVR4AeyYTWxUVRTH3yD9UCEE'
function extractHotspot(cursor: string): [number, number] | null {
  const normalized = cursor.replace(/\s+/g, ' ')
  const match =
    normalized.match(/(?:-webkit-)?image-set\([^)]*\)\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i) ??
    normalized.match(/\)\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

function hasDuplicateSignature(cursor: string) {
  return cursor.includes(DUPLICATE_URL_SIGNATURE)
}

function pause() {
  setLockMetaKey(false)
  setLockAltKey(false)
}

function canLockCanvas() {
  return layoutReady.value && windowActive && !spacePressed && !!canvas.value?.matches(':hover')
}

function resume() {
  syncMetaLock()
  syncAltLock()
}

function pauseMeasure() {
  setLockAltKey(false)
}

function pauseDeepSelect() {
  setLockMetaKey(false)
}

let resuming: ReturnType<typeof setTimeout> | null = null
let pointerPause: ReturnType<typeof setTimeout> | null = null

function resetInteraction() {
  spacePressed = false
  altPressed = false
  if (resuming != null) clearTimeout(resuming)
  if (pointerPause != null) clearTimeout(pointerPause)
  resuming = null
  pointerPause = null
  pause()
  if (cursorHost.value) clearCursorCover(cursorHost.value)
}

function pauseMetaThenResume() {
  if (!windowActive || !layoutReady.value) return
  if (resuming != null) {
    clearTimeout(resuming)
  }

  setLockMetaKey(false)

  resuming = setTimeout(() => {
    resuming = null
    syncMetaLock()
  }, 200)
}

function keydown(e: KeyboardEvent) {
  if (!layoutReady.value || !windowActive) {
    return
  }
  if (!options.value.measureOn && e.key === 'Alt') {
    return
  }
  if (!altPressed && e.key === 'Alt') {
    altPressed = true
    setLockAltKey(false)
    reconcileCursor()
  }
  if (!spacePressed && e.key === ' ') {
    spacePressed = true
    pause()
    reconcileCursor()
  }
}

function keyup(e: KeyboardEvent) {
  if (!layoutReady.value) {
    return
  }
  if (altPressed && e.key === 'Alt') {
    altPressed = false
    syncAltLock()
    reconcileCursor()
  }
  if (spacePressed && e.key === ' ') {
    spacePressed = false
    resume()
    reconcileCursor()
  }
}

function syncAltLock() {
  setLockAltKey(canLockCanvas() && !altPressed && options.value.measureOn)
}

function syncMetaLock() {
  setLockMetaKey(canLockCanvas() && options.value.deepSelectOn)
}

function isDuplicateCursor(host: HTMLElement) {
  if (duplicateClass) {
    return host.classList.contains(duplicateClass)
  }
  const cursor = getComputedStyle(host).cursor
  const hotspot = extractHotspot(cursor)
  return hotspot != null && hotspot[0] === 8 && hotspot[1] === 8 && hasDuplicateSignature(cursor)
}

function learnDuplicateClass(host: HTMLElement) {
  if (duplicateClass) return
  const added = Array.from(host.classList).filter((c) => !classSnapshot.has(c))
  if (added.length === 1) {
    duplicateClass = added[0]!
  }
}

function applyCursorCover(host: HTMLElement) {
  host.dataset.tpCursorOverride = ''
}

function clearCursorCover(host: HTMLElement) {
  delete host.dataset.tpCursorOverride
}

function reconcileCursor(host?: HTMLElement | null) {
  const target = host ?? cursorHost.value
  if (!target) return
  if (
    !layoutReady.value ||
    !windowActive ||
    !options.value.measureOn ||
    altPressed ||
    spacePressed
  ) {
    clearCursorCover(target)
    classSnapshot = new Set(target.classList)
    return
  }
  if (isDuplicateCursor(target)) {
    learnDuplicateClass(target)
    applyCursorCover(target)
  } else {
    clearCursorCover(target)
  }
  classSnapshot = new Set(target.classList)
}

export function useKeyLock() {
  windowActive = document.visibilityState !== 'hidden' && document.hasFocus()
  resetInteraction()

  function deactivate() {
    windowActive = false
    resetInteraction()
  }

  function syncWindowActivity() {
    windowActive = document.visibilityState !== 'hidden' && document.hasFocus()
    if (!windowActive) {
      resetInteraction()
      return
    }
    resume()
    reconcileCursor()
  }

  function clearTargets() {
    resetInteraction()
    canvas.value = null
    cursorHost.value = null
    duplicateClass = null
    classSnapshot = new Set()
  }

  function syncTargets() {
    canvas.value = getCanvas()
    cursorHost.value = canvas.value?.parentElement?.parentElement as HTMLElement | null
    duplicateClass = null
    if (cursorHost.value) {
      classSnapshot = new Set(cursorHost.value.classList)
    } else {
      classSnapshot = new Set()
    }
  }

  watch(
    layoutReady,
    (ready) => {
      if (ready) {
        syncTargets()
        syncMetaLock()
        syncAltLock()
        reconcileCursor(cursorHost.value)
        return
      }
      clearTargets()
    },
    { immediate: true }
  )

  useEventListener(canvas, 'mouseleave', pause)
  useEventListener(canvas, 'mouseenter', resume)
  useEventListener(canvas, 'pointerdown', pauseMeasure, { capture: true })
  useEventListener(canvas, 'pointerdown', () => {
    if (pointerPause != null) clearTimeout(pointerPause)
    pointerPause = setTimeout(() => {
      pointerPause = null
      pauseDeepSelect()
    }, 0)
  })
  useEventListener('pointerup', resume, { capture: true })
  useEventListener(canvas, 'wheel', pauseMetaThenResume)
  useEventListener('keydown', keydown)
  useEventListener('keyup', keyup)
  useEventListener('blur', deactivate)
  useEventListener('focus', syncWindowActivity)
  useEventListener(document, 'visibilitychange', syncWindowActivity)
  onScopeDispose(clearTargets)

  useMutationObserver(
    cursorHost,
    () => {
      if (!options.value.measureOn) {
        if (cursorHost.value) {
          clearCursorCover(cursorHost.value)
        }
        return
      }
      reconcileCursor(cursorHost.value)
    },
    { attributes: true, attributeFilter: ['class'] }
  )

  watch(
    () => options.value.deepSelectOn,
    () => {
      if (!options.value.deepSelectOn && !options.value.measureOn) resetInteraction()
      if (!layoutReady.value) return
      syncMetaLock()
    }
  )

  watch(
    () => options.value.measureOn,
    () => {
      if (!options.value.measureOn) altPressed = false
      if (!options.value.deepSelectOn && !options.value.measureOn) resetInteraction()
      if (!layoutReady.value) return
      syncAltLock()
      reconcileCursor(cursorHost.value)
    }
  )
}
