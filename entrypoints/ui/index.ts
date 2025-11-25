import 'overlayscrollbars/styles/overlayscrollbars.css'
import waitFor from 'p-wait-for'

import { runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'

import './style.css'

export default defineUnlistedScript(async () => {
  import('./prism')

  await waitFor(() => getCanvas() != null && getLeftPanel() != null)
  try {
    await waitFor(() => window.figma?.currentPage != null, { timeout: 1000 })
  } catch {
    runtimeMode.value = 'unavailable'
    console.log(
      '[tempad-dev] `window.figma` and `window.DebuggingHelpers.logSelected` are both not available. You need to duplicate to draft to use TemPad Dev.'
    )
  }

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')
})
