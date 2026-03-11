import 'overlayscrollbars/styles/overlayscrollbars.css'

import './style.css'

export default defineUnlistedScript(async () => {
  const prismTask = import('./prism')
    .then(({ loadPrismLanguages }) => loadPrismLanguages())
    .catch((error) => {
      console.error('Failed to load Prism languages.', error)
    })

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')

  void prismTask
})
