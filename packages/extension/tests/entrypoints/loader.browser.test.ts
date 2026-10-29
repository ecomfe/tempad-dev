import { afterEach, beforeAll, expect, it, vi } from 'vitest'

let load: () => void
let injected: HTMLScriptElement | undefined

beforeAll(async () => {
  vi.stubGlobal('defineUnlistedScript', (main: () => void) => ({ main }))
  const entrypoint = await import('@/entrypoints/loader')
  load = entrypoint.default.main
  vi.unstubAllGlobals()
})

afterEach(() => {
  injected?.remove()
  Reflect.deleteProperty(globalThis, '__tempadLoaderProbe')
  vi.unstubAllGlobals()
})

it('executes the inline UI bundle and removes its script without waiting for a load event', async () => {
  const loader = document.createElement('script')
  loader.dataset.entry = 'chrome-extension://loader-fixture/ui.js'
  vi.spyOn(document, 'currentScript', 'get').mockReturnValueOnce(loader)
  const fetch = vi.fn().mockResolvedValue(
    new Response(`
      globalThis.__tempadLoaderProbe = {
        script: document.currentScript,
        sandbox: globalThis.__TEMPAD_PLUGIN_SANDBOX_URL__
      };
    `)
  )
  vi.stubGlobal('fetch', fetch)

  load()
  await vi.waitFor(() => expect(Reflect.get(globalThis, '__tempadLoaderProbe')).toBeDefined())
  const result = Reflect.get(globalThis, '__tempadLoaderProbe')
  injected = result.script
  expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL(loader.dataset.entry))
  expect(result.sandbox).toBe('chrome-extension://loader-fixture/plugin-sandbox.html')
  expect(injected).toBeInstanceOf(HTMLScriptElement)
  expect(injected?.isConnected).toBe(false)
})
