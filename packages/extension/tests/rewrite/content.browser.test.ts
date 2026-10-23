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

function createScript(): HTMLScriptElement {
  const script = document.createElement('script')
  // Keep loading under test control while exercising native DOM insertion and Blob URLs.
  script.type = 'application/json'
  script.src = 'https://www.figma.com/webpack-artifacts/assets/shared.min.js'
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
    response.resolve(new Response('/* shared chunk */'))
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
    fetch.mockResolvedValueOnce(new Response('/* available now */'))
    vi.stubGlobal('fetch', fetch)
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const first = createScript()
    const original = first.src
    first.integrity = 'sha256-original'
    document.head.appendChild(first)
    await vi.waitFor(() => expect(first.isConnected).toBe(true))

    expect(first.src).toBe(original)
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
})
