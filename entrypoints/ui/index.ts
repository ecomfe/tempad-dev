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
    const panelEl = () => document.getElementById('tempad')

    const tryRecover = async () => {
      const el = panelEl()
      const available = await ensureFigmaReady()
      if (available) {
        runtimeMode.value = 'standard'
        if (el) el.style.display = ''
        console.log('[tempad-dev] `window.figma` is now available. TemPad Dev is ready.')
        return true
      }
      if (el && document.visibilityState === 'hidden') el.style.display = 'none'
      return false
    }

    const recovery = window.setInterval(async () => {
      const ok = await tryRecover()
      if (ok) clearInterval(recovery)
    }, FIGMA_RECOVER_INTERVAL)

    const handleVisibility = async () => {
      const el = panelEl()
      if (!el) return
      if (document.visibilityState === 'hidden') {
        if (runtimeMode.value === 'unavailable') el.style.display = 'none'
        return
      }
      el.style.display = ''
      await tryRecover()
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
