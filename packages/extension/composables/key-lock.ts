import { useEventListener, useMutationObserver } from '@vueuse/core'

import { options } from '@/ui/state'
import { getCanvas, setLockAltKey, setLockMetaKey } from '@/utils'

let spacePressed = false
let altPressed = false
let duplicateClass: string | null = null
let classSnapshot = new Set<string>()
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

function resume() {
  if (spacePressed) {
    return
  }
  setLockMetaKey(options.value.deepSelectOn)
  syncAltLock()
}

function pauseMeasure() {
  setLockAltKey(false)
}

function resumeMeasure() {
  syncAltLock()
}

let resuming: number | null = null
function pauseMetaThenResume() {
  if (resuming != null) {
    clearTimeout(resuming)
  }

  setLockMetaKey(false)

  resuming = setTimeout(() => {
    resuming = null
    if (!spacePressed) {
      setLockMetaKey(options.value.deepSelectOn)
    }
  }, 200)
}

function keydown(e: KeyboardEvent) {
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
  }
}

function keyup(e: KeyboardEvent) {
  if (!options.value.measureOn && e.key === 'Alt') {
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
  }
}

function syncAltLock() {
  setLockAltKey(!altPressed && options.value.measureOn)
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
    duplicateClass = added[0]
  }
}

function applyCursorCover(host: HTMLElement) {
  host.dataset.tpCursorOverride = ''
}

function clearCursorCover(host: HTMLElement) {
  delete host.dataset.tpCursorOverride
}

function reconcileCursor(host?: HTMLElement | null) {
  const target = host ?? cursorHost
  if (!target) return
  if (!options.value.measureOn || altPressed) {
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

let cursorHost: HTMLElement | null = null

export function useKeyLock() {
  const canvas = getCanvas()
  cursorHost = canvas?.parentElement?.parentElement as HTMLElement | null
  if (cursorHost) {
    classSnapshot = new Set(cursorHost.classList)
  }

  useEventListener(canvas, 'mouseleave', pause)
  useEventListener(canvas, 'mouseenter', resume)
  useEventListener(canvas, 'pointerdown', pauseMeasure, { capture: true })
  useEventListener('pointerup', resumeMeasure, { capture: true })
  useEventListener(canvas, 'wheel', pauseMetaThenResume)
  useEventListener('keydown', keydown)
  useEventListener('keyup', keyup)

  if (cursorHost) {
    useMutationObserver(
      cursorHost,
      () => {
        if (!options.value.measureOn) {
          clearCursorCover(cursorHost!)
          return
        }
        reconcileCursor(cursorHost)
      },
      { attributes: true, attributeFilter: ['class'] }
    )
  }

  reconcileCursor(cursorHost)

  watch(
    () => options.value.deepSelectOn,
    () => {
      setLockMetaKey(options.value.deepSelectOn)
    }
  )

  watch(
    () => options.value.measureOn,
    () => {
      syncAltLock()
      reconcileCursor(cursorHost)
    }
  )
}
