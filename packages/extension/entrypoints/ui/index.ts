import 'overlayscrollbars/styles/overlayscrollbars.css'

import { configurePluginSandbox } from '@/plugin-sandbox/requester'

import './style.css'

async function mountUi(): Promise<void> {
  const sandboxUrl = window.__TEMPAD_PLUGIN_SANDBOX_URL__
  if (!sandboxUrl) {
    console.error('Plugin sandbox URL is unavailable.')
  } else {
    configurePluginSandbox(sandboxUrl)
  }

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')
}

export default defineUnlistedScript(() => {
  void mountUi().catch((error) => console.error('Failed to mount TemPad Dev UI.', error))
})
