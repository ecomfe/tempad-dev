import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyGroups: vi.fn(),
  logger: {
    log: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/rewrite/shared', () => ({
  applyGroups: mocks.applyGroups
}))

vi.mock('@/utils/log', () => ({
  logger: mocks.logger
}))

import { GROUPS } from '@/rewrite/config'
import { rewriteCurrentScript } from '@/rewrite/runtime'

const base = 'https://www.figma.com/webpack-artifacts/assets/'

class MockHTMLScriptElement {
  src: string
  async = false
  defer = false
  replacedWithNode: MockHTMLScriptElement | null = null

  constructor(src = '') {
    this.src = src
  }

  replaceWith(node: MockHTMLScriptElement) {
    this.replacedWithNode = node
  }
}

class MockDocument {
  declare currentScript: MockHTMLScriptElement | null
  _currentScript: MockHTMLScriptElement | null = null
  createdScripts: MockHTMLScriptElement[] = []

  createElement(tag: string) {
    if (tag !== 'script') {
      throw new Error(`Unsupported tag: ${tag}`)
    }
    const script = new MockHTMLScriptElement()
    this.createdScripts.push(script)
    return script
  }
}

Object.defineProperty(MockDocument.prototype, 'currentScript', {
  configurable: true,
  get(this: MockDocument) {
    return this._currentScript
  },
  set(this: MockDocument, value: MockHTMLScriptElement | null) {
    this._currentScript = value
  }
})

function setupRuntimeContext(src?: string) {
  const document = new MockDocument()
  const current = src ? new MockHTMLScriptElement(src) : null
  document.currentScript = current

  vi.stubGlobal('Document', MockDocument)
  vi.stubGlobal('HTMLScriptElement', MockHTMLScriptElement)
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', { figma: { ready: true } })

  return { document, current }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis, '__rewriteExecuted')
  vi.resetModules()
})

describe('rewrite/runtime rewriteCurrentScript', () => {
  it('rewrites and evaluates current script content when rewriting succeeds', async () => {
    const src = `${base}app.min.js`
    const { document, current } = setupRuntimeContext(src)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('console.log("original");')
    })
    vi.stubGlobal('fetch', fetchMock)

    mocks.applyGroups.mockReturnValue({
      content:
        'delete window.figma;globalThis.__rewriteExecuted = document.currentScript?.src ?? "missing";',
      changed: true
    })

    await rewriteCurrentScript()

    expect(fetchMock).toHaveBeenCalledWith(src, { credentials: 'include', cache: 'force-cache' })
    expect(mocks.applyGroups).toHaveBeenCalledWith('console.log("original");', GROUPS)
    expect(mocks.logger.log).toHaveBeenCalledWith(`Rewrote script: ${src}`)
    expect((globalThis as { window: { figma?: unknown } }).window.figma).toBeUndefined()
    expect((globalThis as { __rewriteExecuted?: string }).__rewriteExecuted).toBe(src)
    expect(document.currentScript).toBe(current)
    expect(Object.hasOwn(document, 'currentScript')).toBe(false)
    expect(current?.replacedWithNode).toBeNull()
  })

  it('exits early when there is no current script to rewrite', async () => {
    setupRuntimeContext()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await rewriteCurrentScript()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.applyGroups).not.toHaveBeenCalled()
  })

  it('exits early when current script has no src', async () => {
    const { document } = setupRuntimeContext('https://example.com/placeholder.js')
    document.currentScript = new MockHTMLScriptElement('')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await rewriteCurrentScript()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.applyGroups).not.toHaveBeenCalled()
  })

  it('leaves an already-qualified or unrelated source alone', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const src of [`${base}app.min.js?already=qualified`, 'https://example.com/app.min.js']) {
      const { current } = setupRuntimeContext(src)
      await rewriteCurrentScript()
      expect(current?.replacedWithNode).toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads an unchanged source as a native script to preserve top-level declarations', async () => {
    const src = `${base}unchanged.min.js`
    const { current } = setupRuntimeContext(src)
    const content = 'globalThis.__rewriteExecuted = "executed";'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(content)))
    mocks.applyGroups.mockReturnValue({ content })

    await rewriteCurrentScript()

    expect(mocks.logger.log).not.toHaveBeenCalled()
    expect((globalThis as { __rewriteExecuted?: string }).__rewriteExecuted).toBeUndefined()
    expect(current?.replacedWithNode?.src).toBe(`${src}?fallback`)
  })

  it.each([
    { own: false, throws: false },
    { own: false, throws: true },
    { own: true, throws: false },
    { own: true, throws: true }
  ])(
    'restores the currentScript descriptor (own=$own, throws=$throws)',
    async ({ own, throws }) => {
      const src = `${base}owned.min.js`
      const { document, current } = setupRuntimeContext(src)
      if (own)
        Object.defineProperty(document, 'currentScript', {
          value: current,
          writable: false,
          enumerable: true,
          configurable: true
        })
      const original = Object.getOwnPropertyDescriptor(document, 'currentScript')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }))
      mocks.applyGroups.mockReturnValue({
        content:
          'globalThis.__rewriteExecuted = "once";' +
          (throws ? 'throw new Error("script failed")' : '')
      })

      await rewriteCurrentScript()

      expect(Object.getOwnPropertyDescriptor(document, 'currentScript')).toEqual(original)
      expect((globalThis as { __rewriteExecuted?: string }).__rewriteExecuted).toBe('once')
      expect(current?.replacedWithNode).toBeNull()
      expect(mocks.logger.error).toHaveBeenCalledTimes(throws ? 1 : 0)
    }
  )

  it.each([403, 503])('falls back without evaluating an HTTP %s response body', async (status) => {
    const src = `${base}unavailable.min.js`
    const { current } = setupRuntimeContext(src)
    const text = vi.fn().mockResolvedValue('globalThis.__rewriteExecuted = "error response";')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text }))
    mocks.applyGroups.mockReturnValue({ content: '', changed: false })

    await rewriteCurrentScript()

    expect(mocks.applyGroups).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect((globalThis as { __rewriteExecuted?: string }).__rewriteExecuted).toBeUndefined()
    expect(current?.replacedWithNode?.src).toBe(`${src}?fallback`)
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(String(status))
      })
    )
  })

  it('falls back to loading original script when rewrite fails', async () => {
    const src = `${base}runtime.min.js`
    const { current } = setupRuntimeContext(src)
    const error = new Error('network failed')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))

    await rewriteCurrentScript()

    expect(mocks.logger.error).toHaveBeenCalledWith(error)
    expect(current?.replacedWithNode).toBeInstanceOf(MockHTMLScriptElement)
    expect(current?.replacedWithNode?.src).toBe(`${src}?fallback`)
    expect(current?.replacedWithNode?.defer).toBe(true)
  })

  it('falls back when the rewritten source does not compile', async () => {
    const src = `${base}invalid.min.js`
    const { current } = setupRuntimeContext(src)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('var works = true;')))
    mocks.applyGroups.mockReturnValue({ content: 'var = true;' })

    await rewriteCurrentScript()

    expect(current?.replacedWithNode?.src).toBe(`${src}?fallback`)
    expect(mocks.logger.error).toHaveBeenCalledWith(expect.any(SyntaxError))
  })
})
