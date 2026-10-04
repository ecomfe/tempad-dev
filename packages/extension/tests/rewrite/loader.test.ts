import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchScriptText, loadRewriteRuntime, REWRITE_RUNTIME_URL } from '@/rewrite/loader'
import { bundledRuntime } from '@/rewrite/transform'

const validCode = `var TemPadRewriteRuntimeV1 = { default: {
  protocol: 1, targetPattern: 'chunk', rewrite: source => source + ';'
} };`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('rewrite runtime loading', () => {
  it('loads a validated runtime and honors HTTP caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(validCode))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = await loadRewriteRuntime()
    expect(runtime.rewrite('source', 'url')).toBe('source;')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      REWRITE_RUNTIME_URL,
      expect.objectContaining({
        cache: 'default',
        credentials: 'omit',
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('does not fetch remote code in development', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await loadRewriteRuntime({ remote: false })).toBe(bundledRuntime)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'throw new Error("initialization failed")',
    'this is not javascript',
    'var TemPadRewriteRuntimeV1 = {default:null}',
    validCode.replace('protocol: 1', 'protocol: 2'),
    validCode.replace("targetPattern: 'chunk'", "targetPattern: '['"),
    validCode.replace('rewrite: source => source', 'rewrite: 42'),
    ' '.repeat(1024 * 1024 + 1)
  ])('uses the bundled runtime for invalid releases (%#)', async (code) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(code))
    vi.stubGlobal('fetch', fetchMock)
    expect(await loadRewriteRuntime()).toBe(bundledRuntime)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back for a missing or unreachable release', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('missing', { status: 404 }))
        .mockRejectedValueOnce(new Error('offline'))
    )
    expect(await loadRewriteRuntime()).toBe(bundledRuntime)
    expect(await loadRewriteRuntime()).toBe(bundledRuntime)
  })

  it('bounds body reads, aborts, and never evaluates a late response', async () => {
    vi.useFakeTimers()
    let release!: (value: string) => void
    const body = new Promise<string>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => body })
    vi.stubGlobal('fetch', fetchMock)
    const evaluated = vi.fn()
    vi.stubGlobal('__rewriteRuntimeEvaluated', evaluated)
    const pending = loadRewriteRuntime({ timeoutMs: 20 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toBe(bundledRuntime)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    release(`globalThis.__rewriteRuntimeEvaluated();${validCode}`)
    await Promise.resolve()
    expect(await pending).toBe(bundledRuntime)
    expect(evaluated).not.toHaveBeenCalled()
  })

  it('rejects failed source requests before reading the error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('html', { status: 500 })))
    await expect(fetchScriptText('https://example.test/source', {}, 100)).rejects.toThrow('500')
  })
})
