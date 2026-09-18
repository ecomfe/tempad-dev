import { inject } from '@vercel/analytics'
import { createApp } from 'vue'

import App from './App.vue'
import 'overlayscrollbars/styles/overlayscrollbars.css'

import './styles.css'

inject()

createApp(App).mount('#app')
