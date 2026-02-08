import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import waitFor from 'p-wait-for'
import { computed, watch } from 'vue'

import { layoutReady, runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'
import { logger } from '@/utils/log'

const LAYOUT_CHECK_INTERVAL = 500
const FIGMA_READY_TIMEOUT = 1000
const FIGMA_RECOVER_INTERVAL = 3000

function isLayoutReady() {
  return getCanvas() != null && getLeftPanel() != null
}

export function useFigmaAvailability() {
  const visibility = useDocumentVisibility()
  const canCheck = computed(() => layoutReady.value && visibility.value === 'visible')
  const isFigmaReady = () => window.figma?.currentPage != null
  let checkToken = 0

  const setMode = (mode: 'standard' | 'unavailable') => {
    const modeChanged = runtimeMode.value !== mode
    runtimeMode.value = mode
    if (!modeChanged) return
    if (mode === 'standard') {
      logger.log('`window.figma` is now available. TemPad Dev is ready.')
    } else {
      logger.log('`window.figma` is not available. TemPad Dev is currently unavailable.')
    }
  }

  useIntervalFn(
    () => {
      const ready = isLayoutReady()
      if (ready !== layoutReady.value) {
        layoutReady.value = ready
      }
    },
    LAYOUT_CHECK_INTERVAL,
    { immediate: true }
  )

  const { pause: stopRecover, resume: startRecover } = useIntervalFn(
    () => {
      if (!canCheck.value) {
        stopRecover()
        return
      }
      const ok = isFigmaReady()
      setMode(ok ? 'standard' : 'unavailable')
      if (ok) stopRecover()
    },
    FIGMA_RECOVER_INTERVAL,
    { immediate: false }
  )

  const runCheck = async () => {
    const token = (checkToken += 1)
    if (!canCheck.value) return
    const ok = await waitFor(isFigmaReady, { timeout: FIGMA_READY_TIMEOUT }).then(
      () => true,
      () => false
    )
    if (token !== checkToken || !canCheck.value) return
    setMode(ok ? 'standard' : 'unavailable')
    if (ok) stopRecover()
    else startRecover()
  }

  watch(
    canCheck,
    (ready) => {
      if (!ready) {
        checkToken += 1
        stopRecover()
        return
      }
      void runCheck()
    },
    { immediate: true }
  )
}
