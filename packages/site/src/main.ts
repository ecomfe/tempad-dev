import { inject } from '@vercel/analytics'
import { createApp, createSSRApp } from 'vue'

import App from './App.vue'
import './styles.css'

inject()

const root = document.querySelector<HTMLElement>('#app')!
const app = root.hasChildNodes() ? createSSRApp(App) : createApp(App)
app.mount(root)
