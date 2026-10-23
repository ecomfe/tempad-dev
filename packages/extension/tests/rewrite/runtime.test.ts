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

import { rewriteCurrentScript } from '@/rewrite/runtime'

class MockHTMLScriptElement {
  src: string
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
    const src = 'https://example.com/app.js'
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

    await rewriteCurrentScript([
      { markers: ['x'], replacements: [{ pattern: 'x', replacer: 'y' }] }
    ])

    expect(fetchMock).toHaveBeenCalledWith(src)
    expect(mocks.applyGroups).toHaveBeenCalledWith('console.log("original");', [
      { markers: ['x'], replacements: [{ pattern: 'x', replacer: 'y' }] }
    ])
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

    await rewriteCurrentScript([])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.applyGroups).not.toHaveBeenCalled()
  })

  it('exits early when current script has no src', async () => {
    const { document } = setupRuntimeContext('https://example.com/placeholder.js')
    document.currentScript = new MockHTMLScriptElement('')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await rewriteCurrentScript([])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.applyGroups).not.toHaveBeenCalled()
  })

  it('handles unchanged rewrites and restores an own currentScript without a prototype descriptor', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(MockDocument.prototype, 'currentScript')
    Reflect.deleteProperty(MockDocument.prototype, 'currentScript')

    try {
      const src = 'https://example.com/unchanged.js'
      const { document, current } = setupRuntimeContext(src)
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('console.log("same");')
      })
      vi.stubGlobal('fetch', fetchMock)
      mocks.applyGroups.mockReturnValue({
        content: 'globalThis.__rewriteExecuted = "ok";',
        changed: false
      })

      await rewriteCurrentScript([])

      expect(mocks.logger.log).not.toHaveBeenCalled()
      expect((globalThis as { __rewriteExecuted?: string }).__rewriteExecuted).toBe('ok')
      expect(document.currentScript).toBe(current)
      expect(Object.hasOwn(document, 'currentScript')).toBe(true)
    } finally {
      if (descriptor) {
        Object.defineProperty(MockDocument.prototype, 'currentScript', descriptor)
      }
    }
  })

  it.each([
    { own: false, throws: false },
    { own: false, throws: true },
    { own: true, throws: false },
    { own: true, throws: true }
  ])(
    'restores the currentScript descriptor (own=$own, throws=$throws)',
    async ({ own, throws }) => {
      const src = 'https://example.com/owned.js'
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
        content: throws ? 'throw new Error("script failed")' : '',
        changed: false
      })

      await rewriteCurrentScript([])

      expect(Object.getOwnPropertyDescriptor(document, 'currentScript')).toEqual(original)
      expect(current?.replacedWithNode === null).toBe(!throws)
    }
  )

  it.each([403, 503])('falls back without evaluating an HTTP %s response body', async (status) => {
    const src = 'https://example.com/unavailable.js'
    const { current } = setupRuntimeContext(src)
    const text = vi.fn().mockResolvedValue('globalThis.__rewriteExecuted = "error response";')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text }))
    mocks.applyGroups.mockReturnValue({ content: '', changed: false })

    await rewriteCurrentScript([])

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
    const src = 'https://example.com/runtime.js'
    const { current } = setupRuntimeContext(src)
    const error = new Error('network failed')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))

    await rewriteCurrentScript([])

    expect(mocks.logger.error).toHaveBeenCalledWith(error)
    expect(current?.replacedWithNode).toBeInstanceOf(MockHTMLScriptElement)
    expect(current?.replacedWithNode?.src).toBe(`${src}?fallback`)
    expect(current?.replacedWithNode?.defer).toBe(true)
  })
})
