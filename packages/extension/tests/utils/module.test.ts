import { afterEach, describe, expect, it, vi } from 'vitest'

import { assertPluginModuleIsSelfContained, evaluate } from '@/utils/module'

describe('utils/module', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('evaluates code from object URL and always revokes the generated URL', async () => {
    const dataUrl = 'data:text/javascript;base64,ZXhwb3J0IGNvbnN0IGV2YWx1YXRlZCA9IDQyOw=='

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(dataUrl)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const mod = await evaluate('export const evaluated = 42;')

    expect(mod.evaluated).toBe(42)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blobArg] = createObjectURL.mock.calls[0]
    expect(blobArg).toBeInstanceOf(Blob)
    if (!(blobArg instanceof Blob)) {
      throw new Error('Expected Blob payload for URL.createObjectURL.')
    }
    expect(await blobArg.text()).toBe('export const evaluated = 42;')
    expect(revokeObjectURL).toHaveBeenCalledWith(dataUrl)
  })

  it('revokes the object URL when module evaluation fails', async () => {
    const dataUrl = `data:text/javascript,throw%20new%20Error('module-failed')%3B%23${Date.now()}`
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(dataUrl)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await expect(evaluate('throw new Error("module-failed")')).rejects.toBeInstanceOf(Error)
    expect(revokeObjectURL).toHaveBeenCalledWith(dataUrl)
  })

  it('rejects static, dynamic, and re-export module loading syntax', () => {
    const blocked = [
      'import value from "./value.js"; export default value',
      'const value = import("https://example.com/plugin.js")',
      'const value = import(sourceExpression)',
      'const value = import /* comment */ ("https://example.com/plugin.js")',
      'const value = `${import("https://example.com/plugin.js")}`',
      'let n = 1; n++ / import("https://example.com/plugin.js") / 2',
      'let n = 1; n-- / import("https://example.com/plugin.js") / 2',
      'import json from "./value.json" with { type: "json" }',
      'import source module from "./value.wasm"',
      'const module = import.source("./value.wasm")',
      'export { value } from "./value.js"',
      'export * from "./value.js"'
    ]

    for (const code of blocked) {
      expect(() => assertPluginModuleIsSelfContained(code)).toThrow(
        'External module loading is not allowed in plugins.'
      )
    }
  })

  it('allows ordinary exports, import.meta, comments, strings, and property names', () => {
    const allowed = [
      'export default { name: "plugin" }',
      'export const plugin = { code: {} }',
      'const url = import.meta.url; export default url',
      '// import("not-code")\nexport default {}',
      'const message = "import(\\"not-code\\")"; export default message',
      'const loader = object.import; export default loader'
    ]

    for (const code of allowed) {
      expect(() => assertPluginModuleIsSelfContained(code)).not.toThrow()
    }
  })

  it('allows import text in regular expression literals', () => {
    expect(() =>
      assertPluginModuleIsSelfContained(`
        const staticPattern = /import value from ['"]module['"]/g
        const dynamicPattern = /import\\(['"]module['"]\\)/
        export default { staticPattern, dynamicPattern }
      `)
    ).not.toThrow()
  })

  it('fails closed when module syntax cannot be lexed', () => {
    expect(() => assertPluginModuleIsSelfContained('const pattern = /unterminated')).toThrow(
      'Plugin module syntax could not be validated.'
    )
  })
})
