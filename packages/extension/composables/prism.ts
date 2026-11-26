import { createSharedComposable, useIntervalFn } from '@vueuse/core'
import { shallowRef } from 'vue'

let languages: Promise<void> | undefined

export const usePrismLanguages = createSharedComposable(() => {
  const ready = shallowRef(false)
  const { pause } = useIntervalFn(check, 100)
  check()
  return ready

  function check() {
    if (!window.Prism) return
    pause()
    const base = window.__TEMPAD_PLUGIN_SANDBOX_URL__
    if (!base) return
    const url = new URL('/prism.js', base)
    if (url.protocol !== 'chrome-extension:') return
    languages ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = url.href
      script.onload = () => {
        script.remove()
        resolve()
      }
      script.onerror = () => {
        script.remove()
        reject(new Error('Failed to load Prism languages.'))
      }
      document.head.append(script)
    })
    void languages.then(
      () => {
        ready.value = true
      },
      (error) => {
        languages = undefined
        console.error(error)
      }
    )
  }
})
