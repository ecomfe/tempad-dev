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

  it('handles unchanged rewrites and restores currentScript without a prototype descriptor', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(MockDocument.prototype, 'currentScript')
    Reflect.deleteProperty(MockDocument.prototype, 'currentScript')

    try {
      const src = 'https://example.com/unchanged.js'
      const { document } = setupRuntimeContext(src)
      const fetchMock = vi.fn().mockResolvedValue({
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
      expect(Reflect.has(document, 'currentScript')).toBe(false)
    } finally {
      if (descriptor) {
        Object.defineProperty(MockDocument.prototype, 'currentScript', descriptor)
      }
    }
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
