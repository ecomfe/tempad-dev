import { readFile, writeFile } from 'node:fs/promises'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import App from '../src/App.vue'

const content = await renderToString(createSSRApp(App))
const html = await readFile('dist/index.html', 'utf8')
await writeFile(
  'dist/index.html',
  html.replace('<div id="app"></div>', () => `<div id="app">${content}</div>`)
)
