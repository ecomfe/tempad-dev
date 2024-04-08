import waitFor from 'p-wait-for'
import { createApp } from 'vue'
import App from './App.vue'
import { isQuirksMode } from './state'
import { getCanvas, getLeftPanel } from './utils'

import './style.css'
export default defineUnlistedScript(async () => {
  await waitFor(() => getCanvas() != null && getLeftPanel() != null)
  try {
    await waitFor(() => window.figma != null, { timeout: 1000 })
  } catch (e) {
    isQuirksMode.value = true
    console.log('[tempad-dev] `window.figma` is not available. Start to enter quirks mode.')
  }

  createApp(App).mount('tempad')
})
