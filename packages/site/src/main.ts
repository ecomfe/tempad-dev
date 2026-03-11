import { inject } from '@vercel/analytics'
import { createApp } from 'vue'

import App from './App.vue'
import './styles.css'

inject()

createApp(App).mount('#app')
