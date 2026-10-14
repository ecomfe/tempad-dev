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

  const prismTask = import('./prism')
    .then(({ loadPrismLanguages }) => loadPrismLanguages())
    .catch((error) => {
      console.error('Failed to load Prism languages.', error)
    })

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')

  void prismTask
}

export default defineUnlistedScript(() => {
  void mountUi().catch((error) => console.error('Failed to mount TemPad Dev UI.', error))
})
