import 'overlayscrollbars/styles/overlayscrollbars.css'
import waitFor from 'p-wait-for'

import { runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'

import './style.css'

export default defineUnlistedScript(async () => {
  import('./prism')

  const FIGMA_READY_TIMEOUT = 1000
  const FIGMA_RECOVER_INTERVAL = 3000

  async function ensureFigmaReady(timeout?: number): Promise<boolean> {
    try {
      await waitFor(() => window.figma?.currentPage != null, timeout ? { timeout } : undefined)
      return true
    } catch {
      return false
    }
  }

  await waitFor(() => getCanvas() != null && getLeftPanel() != null)
  const ready = await ensureFigmaReady(FIGMA_READY_TIMEOUT)
  if (!ready) {
    runtimeMode.value = 'unavailable'
    console.log(
      '[tempad-dev] `window.figma` is not available. TemPad Dev is currently unavailable.'
    )

    const tryRecover = async () => {
      if (runtimeMode.value !== 'unavailable') return false
      const ok = await ensureFigmaReady()
      if (ok) {
        runtimeMode.value = 'standard'
        console.log('[tempad-dev] `window.figma` is now available. TemPad Dev is ready.')
        return true
      }
      return false
    }

    const recovery = window.setInterval(async () => {
      const ok = await tryRecover()
      if (ok) clearInterval(recovery)
    }, FIGMA_RECOVER_INTERVAL)

    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        await tryRecover()
      }
    }

    const handleFocus = async () => {
      await tryRecover()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
  }

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')
})
