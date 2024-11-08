import { options } from '@/ui/state'
import { getCanvas, setLockAltKey, setLockMetaKey } from '@/utils'

let spacePressed = false

function pause() {
  setLockMetaKey(false)
  setLockAltKey(false)
}

function resume() {
  if (spacePressed) {
    return
  }
  setLockMetaKey(options.value.deepSelectOn)
  setLockAltKey(options.value.measureOn)
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
  if (!spacePressed && e.key === ' ') {
    spacePressed = true
    pause()
  }
}

function keyup(e: KeyboardEvent) {
  if (spacePressed && e.key === ' ') {
    spacePressed = false
    resume()
  }
}

export function useKeyLock() {
  const canvas = getCanvas()

  onMounted(() => {
    canvas.addEventListener('mouseleave', pause)
    canvas.addEventListener('mouseenter', resume)
    canvas.addEventListener('wheel', pauseMetaThenResume)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
  })

  onUnmounted(() => {
    canvas.removeEventListener('mouseleave', pause)
    canvas.removeEventListener('mouseenter', resume)
    canvas.removeEventListener('wheel', pauseMetaThenResume)
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
  })

  watch(
    () => options.value.deepSelectOn,
    () => {
      setLockMetaKey(options.value.deepSelectOn)
    }
  )
}
