import { shallowRef } from 'vue'

let tick: number | null = null
const duration = 3000

const message = shallowRef('')
const shown = shallowRef(false)

export function useToast() {
  function hide () {
    message.value = ''
    shown.value = false
    if (tick != null) {
      clearTimeout(tick)
      tick = null
    }
  }

  return {
    show(msg: string) {
      if (tick != null) {
        clearTimeout(tick)
      }
      message.value = msg
      shown.value = true

      tick = setTimeout(hide, duration)
    },
    hide,
    shown,
    message
  }
}
