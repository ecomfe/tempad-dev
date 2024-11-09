import 'overlayscrollbars/styles/overlayscrollbars.css'
import { isQuirksMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'
import waitFor from 'p-wait-for'

import './style.css'

export default defineUnlistedScript(async () => {
  import('./prism')

  await waitFor(() => getCanvas() != null && getLeftPanel() != null)
  try {
    await waitFor(() => window.figma != null, { timeout: 1000 })
  } catch (e) {
    isQuirksMode.value = true
    console.log('[tempad-dev] `window.figma` is not available. Start to enter quirks mode.')
  }

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')
})
