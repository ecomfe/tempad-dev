import waitFor from 'p-wait-for'
import { createApp } from 'vue'
import App from './App.vue'
import { getCanvas, getObjectsPanel } from './utils'

import './style.css'
export default defineUnlistedScript(async () => {
  await waitFor(() => window.figma != null && getCanvas() != null && getObjectsPanel() != null)

  createApp(App).mount('tempad')
})
