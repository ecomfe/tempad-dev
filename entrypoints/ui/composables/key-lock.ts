import { onMounted, onUnmounted, watch } from 'vue'
import { options } from '../state'
import { setLockAltKey, setLockMetaKey } from '../utils'

function pause() {
  setLockMetaKey(false)
  setLockAltKey(false)
}

function resume() {
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
    setLockMetaKey(options.value.deepSelectOn)
  }, 200)
}

export function useKeyLock(canvas: HTMLElement) {
  onMounted(() => {
    canvas.addEventListener('mouseleave', pause)
    canvas.addEventListener('mouseenter', resume)
    canvas.addEventListener('wheel', pauseMetaThenResume)
  })

  onUnmounted(() => {
    canvas.removeEventListener('mouseleave', pause)
    canvas.removeEventListener('mouseenter', resume)
    canvas.removeEventListener('wheel', pauseMetaThenResume)
  })

  watch(
    () => options.value.deepSelectOn,
    () => {
      setLockMetaKey(options.value.deepSelectOn)
    }
  )
}
