import 'overlayscrollbars/styles/overlayscrollbars.css'
import './style.css'

import waitFor from 'p-wait-for'
import { isQuirksMode } from './state'
import { getCanvas, getLeftPanel } from './utils'

export default defineUnlistedScript(async () => {
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
