import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { expect, it } from 'vitest'

import { skillPreviewPlugin } from '../vite.config'

it('loads both complete skill packages through Vite development import analysis', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [skillPreviewPlugin()],
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null, hmr: false }
  })

  try {
    for (const path of [
      '../../../skill/SKILL.md',
      '../../../agent-plugins/tempad-dev/skills/figma-canvas-authoring/SKILL.md'
    ]) {
      const entry = fileURLToPath(new URL(path, import.meta.url))
      const result = await server.transformRequest(`/@fs${entry}?skill-preview`)
      expect(result?.code).toContain('export default')
      expect(result?.code).toContain('"entry":"SKILL.md"')
      expect(result?.code).toContain('references/')
      expect(result?.code).toContain('"source":')
    }
  } finally {
    await server.close()
  }
})
