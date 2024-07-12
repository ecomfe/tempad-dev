import { shallowRef } from 'vue'

let tick: number | null = null
const duration = 3000

const message = shallowRef('')
const shown = shallowRef(false)

export function useToast() {
  return {
    show(msg: string) {
      if (tick != null) {
        clearTimeout(tick)
      }
      message.value = msg
      shown.value = true

      tick = setTimeout(() => {
        message.value = ''
        shown.value = false
        tick = null
      }, duration)
    },
    shown,
    message
  }
}
