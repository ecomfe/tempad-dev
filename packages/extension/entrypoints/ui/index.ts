import 'overlayscrollbars/styles/overlayscrollbars.css'

import './style.css'

export default defineUnlistedScript(async () => {
  import('./prism')

  const App = (await import('./App.vue')).default

  createApp(App).mount('tempad')
})
