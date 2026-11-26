import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeAppendChild = Element.prototype.appendChild
const nativeInsertBefore = Element.prototype.insertBefore
let install: () => void

beforeAll(async () => {
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition)
  const entrypoint = await import('@/entrypoints/rewrite.content')
  install = entrypoint.default.main as () => void
  vi.unstubAllGlobals()
})

beforeEach(() => install())

afterEach(() => {
  Element.prototype.appendChild = nativeAppendChild
  Element.prototype.insertBefore = nativeInsertBefore
  document.querySelectorAll('[data-rewrite-test]').forEach((node) => node.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = 'https://www.figma.com/webpack-artifacts/assets/'

function createScript(name = 'shared.min.js'): HTMLScriptElement {
  const script = document.createElement('script')
  // Keep loading under test control while exercising native DOM insertion and Blob URLs.
  script.type = 'application/json'
  script.src = base + name
  script.dataset.rewriteTest = ''
  return script
}

describe('dynamic script rewriting', () => {
  it('shares an in-flight rewrite and releases its Blob only after every script settles', async () => {
    const response = Promise.withResolvers<Response>()
    const fetch = vi.fn().mockReturnValue(response.promise)
    vi.stubGlobal('fetch', fetch)
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const first = createScript()
    const second = createScript()
    document.head.appendChild(first)
    document.head.appendChild(second)
    response.resolve(new Response('window.shared = node.appModel.isReadOnly'))
    await vi.waitFor(() => expect(first.isConnected && second.isConnected).toBe(true))

    expect(fetch).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    expect(first.src).toBe(second.src)
    expect(first.src).toMatch(/^blob:/)
    first.dispatchEvent(new Event('load'))
    first.dispatchEvent(new Event('error'))
    expect(revoke).not.toHaveBeenCalled()
    second.dispatchEvent(new Event('error'))
    expect(revoke).toHaveBeenCalledExactlyOnceWith(first.src)
  })

  it('retains the original script on HTTP failure and retries the source on its next insertion', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
    fetch.mockResolvedValueOnce(new Response('window.retry = node.appModel.isReadOnly'))
    vi.stubGlobal('fetch', fetch)
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const first = createScript()
    const original = first.src
    first.integrity = 'sha256-original'
    document.head.appendChild(first)
    await vi.waitFor(() => expect(first.isConnected).toBe(true))

    expect(first.src).toBe(`${original}?fallback`)
    expect(first.integrity).toBe('sha256-original')
    expect(create).not.toHaveBeenCalled()
    const retry = createScript()
    document.head.appendChild(retry)
    await vi.waitFor(() => expect(retry.isConnected).toBe(true))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(retry.src).toMatch(/^blob:/)
    retry.dispatchEvent(new Event('load'))
    expect(revoke).toHaveBeenCalledExactlyOnceWith(retry.src)
  })

  it('leaves unchanged and query-qualified scripts on the native loader', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('var unchanged = true;'))
    vi.stubGlobal('fetch', fetch)
    const create = vi.spyOn(URL, 'createObjectURL')
    const unchanged = createScript()
    unchanged.integrity = 'sha256-original'
    const qualified = createScript('shared.min.js?key=value')
    document.head.appendChild(unchanged)
    document.head.appendChild(qualified)

    expect(qualified.isConnected).toBe(true)
    await vi.waitFor(() => expect(unchanged.isConnected).toBe(true))
    expect(qualified.src).toBe(`${base}shared.min.js?key=value`)
    expect(unchanged.src).toBe(`${base}shared.min.js?fallback`)
    expect(unchanged.integrity).toBe('sha256-original')
    expect(fetch).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })

  it('preserves ordered insertion through rewritten and native scripts', async () => {
    const firstResponse = Promise.withResolvers<Response>()
    const secondPrepared = Promise.withResolvers<void>()
    const fetch = vi.fn().mockReturnValueOnce(firstResponse.promise)
    fetch.mockResolvedValueOnce(new Response('window.second = node.appModel.isReadOnly'))
    vi.stubGlobal('fetch', fetch)
    const create = URL.createObjectURL.bind(URL)
    vi.spyOn(URL, 'createObjectURL').mockImplementationOnce((blob) => {
      secondPrepared.resolve()
      return create(blob)
    })
    const scripts = ['first.min.js', 'second.min.js', 'native.min.js?keep'].map(createScript)
    for (const script of scripts) {
      script.async = false
      document.head.appendChild(script)
    }

    await secondPrepared.promise
    expect(scripts.map(({ isConnected }) => isConnected)).toEqual([false, false, false])
    firstResponse.resolve(new Response('window.first = node.appModel.isReadOnly'))
    await vi.waitFor(() => {
      expect([...document.querySelectorAll('[data-rewrite-test]')]).toEqual(scripts)
    })
    for (const script of scripts) script.dispatchEvent(new Event('load'))
  })
})
