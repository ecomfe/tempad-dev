import 'overlayscrollbars/styles/overlayscrollbars.css'
import { runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'
import waitFor from 'p-wait-for'

import './style.css'

export default defineUnlistedScript(async () => {
  import('./prism')

  await waitFor(() => getCanvas() != null && getLeftPanel() != null)
  try {
    await waitFor(() => window.figma != null, { timeout: 1000 })
  } catch (e) {
    if (window.DebuggingHelpers.logSelected) {
      runtimeMode.value = 'quirks'
      console.log('[tempad-dev] `window.figma` is not available. Start to enter quirks mode.')
    } else {
      runtimeMode.value = 'unavailable'
      console.log(
        '[tempad-dev] `window.figma` and `window.DebuggingHelpers.logSelected` are both not available. You need to duplicate to draft to use TemPad Dev.'
      )
    }
  }

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')
})
