import { useEventListener, useTimeoutFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

import { useToast } from './toast'

type DeepLinkGuardOptions = {
  timeout?: number
  message?: string
  fallbackDeepLink?: string
}

const DEFAULT_TIMEOUT_MS = 300
const DEFAULT_MESSAGE = 'No response detected. Please install the client first.'

/**
 * Guard a deep link attempt: if the page does not blur / hide within the timeout,
 * show a toast indicating the client might not be installed.
 */
export function useDeepLinkGuard(defaultOptions: DeepLinkGuardOptions = {}) {
  const { show } = useToast()

  let activeCleanup: (() => void) | null = null

  onScopeDispose(() => {
    if (activeCleanup) {
      activeCleanup()
    }
  })

  const guardDeepLink = (deepLink: string, options?: DeepLinkGuardOptions) => {
    // Cancel any previous pending check to avoid duplicate toasts.
    if (activeCleanup) {
      activeCleanup()
    }

    const timeout = options?.timeout ?? defaultOptions.timeout ?? DEFAULT_TIMEOUT_MS
    const message = options?.message ?? defaultOptions.message ?? DEFAULT_MESSAGE
    const fallbackDeepLink =
      options?.fallbackDeepLink ?? defaultOptions.fallbackDeepLink ?? undefined

    let cleaned = false
    let fallbackUsed = false
    const disposers: Array<() => void> = []

    const { start, stop } = useTimeoutFn(
      () => {
        cleanup()
        if (!fallbackUsed && fallbackDeepLink) {
          fallbackUsed = true
          guardDeepLink(fallbackDeepLink, { ...options, fallbackDeepLink: undefined })
          return
        }
        show(message)
      },
      timeout,
      { immediate: false }
    )

    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      stop()
      disposers.forEach((dispose) => dispose())
      disposers.length = 0
      if (activeCleanup === cleanup) {
        activeCleanup = null
      }
    }

    disposers.push(useEventListener(window, 'blur', cleanup, { once: true }))
    disposers.push(useEventListener(window, 'pagehide', cleanup, { once: true }))
    disposers.push(
      useEventListener(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          cleanup()
        }
      })
    )

    activeCleanup = cleanup
    start()
    window.open(deepLink, '_self')
  }

  return guardDeepLink
}
