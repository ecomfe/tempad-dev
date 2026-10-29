import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { expect, it } from 'vitest'

it.each([
  ['vite.config.ts', 'client'],
  ['vitest.config.ts', 'ssr']
] as const)(
  'resolves shared source through %s without reading a previous build',
  async (config, environment) => {
    const server = await createServer({
      configFile: fileURLToPath(new URL(`../${config}`, import.meta.url)),
      root: fileURLToPath(new URL('../', import.meta.url)),
      appType: 'custom',
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, watch: null, hmr: false }
    })

    try {
      const resolver = server.environments[environment]!.pluginContainer
      const importer = fileURLToPath(new URL('../src/content/landing.ts', import.meta.url))
      expect((await resolver.resolveId('@tempad-dev/shared', importer))?.id).toBe(
        fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url))
      )
      expect((await resolver.resolveId('@tempad-dev/shared/ui', importer))?.id).toBe(
        fileURLToPath(new URL('../../shared/src/ui/index.ts', import.meta.url))
      )
    } finally {
      await server.close()
    }
  }
)
