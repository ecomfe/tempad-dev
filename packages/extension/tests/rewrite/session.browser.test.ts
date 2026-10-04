import { afterEach, describe, expect, it, vi } from 'vitest'

import { installScriptRewriteInterceptor } from '@/rewrite/interceptor'
import { REWRITE_RUNTIME_URL } from '@/rewrite/loader'
import { fallbackUrl, withCurrentScript } from '@/rewrite/runtime'
import { createRewriteSession } from '@/rewrite/session'

const root = '/webpack-artifacts/assets/'
const remote = `var TemPadRewriteRuntimeV1={default:{protocol:1,
  targetPattern:${JSON.stringify(root)},
  rewrite(source){return source.replaceAll('"ORIGINAL"', '"REMOTE"')}
}};`
const cleanup: Array<() => void> = []

function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function session() {
  const instance = createRewriteSession(true)
  cleanup.push(() => instance.dispose())
  return instance
}

function script(name: string, inert = true): HTMLScriptElement {
  const element = document.createElement('script')
  element.src = new URL(`${root}${name}.min.js`, location.href).href
  if (inert) element.type = 'application/x-tempad-rewrite'
  cleanup.push(() => element.remove())
  return element
}

afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  Reflect.deleteProperty(window, '__rewriteProbe')
  vi.unstubAllGlobals()
})

describe('rewrite document session', () => {
  it('fetches source in parallel, preserves currentScript, and gates loader load events', async () => {
    const runtimeResponse = gate<Response>()
    const source = 'window.__rewriteProbe={value:"ORIGINAL",url:document.currentScript.src};'
    const fetchMock = vi.fn((url: string) =>
      url === REWRITE_RUNTIME_URL ? runtimeResponse.promise : Promise.resolve(new Response(source))
    )
    vi.stubGlobal('fetch', fetchMock)
    const current = script('entry')
    document.head.appendChild(current)
    const load = vi.fn()
    current.addEventListener('load', load)
    const instance = session()
    const pending = instance.rewriteScript(current)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    current.dispatchEvent(new Event('load'))
    expect(load).not.toHaveBeenCalled()
    runtimeResponse.resolve(new Response(remote))
    await pending
    expect(load).toHaveBeenCalledTimes(1)
    expect(Reflect.get(window, '__rewriteProbe')).toEqual({ value: 'REMOTE', url: current.src })
    expect(Object.hasOwn(document, 'currentScript')).toBe(false)
    await instance.rewriteScript(current)
    expect(load).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['load', 'error'] as const)(
    'delivers %s when execution finishes before the loader load event',
    async (outcome) => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            new Response(
              url === REWRITE_RUNTIME_URL
                ? remote
                : `window.__rewriteProbe++;${outcome === 'error' ? 'throw new Error("partial")' : ''}`
            )
          )
        )
      )
      Reflect.set(window, '__rewriteProbe', 0)
      const current = script('completed')
      document.head.appendChild(current)
      const events: string[] = []
      current.addEventListener('load', (event) => events.push(event.type))
      current.addEventListener('error', (event) => {
        events.push(event.type)
        // An error handler may synchronously trigger another load event on the same element.
        if (events.length === 1) current.dispatchEvent(new Event('load'))
      })
      await session().rewriteScript(current)
      expect(events).toEqual([])
      current.dispatchEvent(new Event('load'))
      expect(events).toEqual(outcome === 'error' ? ['error', 'load'] : ['load'])
      expect(Reflect.get(window, '__rewriteProbe')).toBe(1)
    }
  )

  it.each([
    { code: remote, value: 'REMOTE' },
    { code: 'throw new Error("invalid release")', value: 'ORIGINAL' }
  ])(
    'shares the $value runtime across later scripts in the same session',
    async ({ code, value }) => {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            url === REWRITE_RUNTIME_URL ? code : 'window.__rewriteProbe.push("ORIGINAL")'
          )
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      Reflect.set(window, '__rewriteProbe', [])
      const instance = session()
      for (const name of ['first', 'later']) {
        const current = script(name)
        document.head.appendChild(current)
        await instance.rewriteScript(current)
      }
      expect(Reflect.get(window, '__rewriteProbe')).toEqual([value, value])
      expect(fetchMock.mock.calls.filter(([url]) => url === REWRITE_RUNTIME_URL)).toHaveLength(1)
    }
  )

  it('executes ordered entry scripts in encounter order despite out-of-order responses', async () => {
    const slow = gate<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === REWRITE_RUNTIME_URL) return Promise.resolve(new Response(remote))
        if (url.includes('first')) return slow.promise
        return Promise.resolve(new Response('window.__rewriteProbe.push(2)'))
      })
    )
    Reflect.set(window, '__rewriteProbe', [])
    const instance = session()
    const first = script('first')
    const second = script('second')
    first.async = second.async = false
    document.head.append(first, second)
    const a = instance.rewriteScript(first)
    const b = instance.rewriteScript(second)
    await Promise.resolve()
    slow.resolve(new Response('window.__rewriteProbe.push(1)'))
    await Promise.all([a, b])
    expect(Reflect.get(window, '__rewriteProbe')).toEqual([1, 2])
  })

  it('does not replay a source after a partial execution failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            url === REWRITE_RUNTIME_URL
              ? remote
              : 'window.__rewriteProbe++;throw new Error("partial");'
          )
        )
      )
    )
    Reflect.set(window, '__rewriteProbe', 0)
    const current = script('throwing')
    document.head.appendChild(current)
    const error = vi.fn()
    const load = vi.fn()
    current.addEventListener('error', error)
    current.addEventListener('load', load)
    const pending = session().rewriteScript(current)
    current.dispatchEvent(new Event('load'))
    await pending
    expect(Reflect.get(window, '__rewriteProbe')).toBe(1)
    expect(error).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    expect(current.isConnected).toBe(true)
  })

  it('uses bundled source when a remote transform produces invalid JavaScript', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            url === REWRITE_RUNTIME_URL
              ? remote.replace(
                  'return source.replaceAll(\'"ORIGINAL"\', \'"REMOTE"\')',
                  "return 'invalid {'"
                )
              : 'window.__rewriteProbe="ORIGINAL"'
          )
        )
      )
    )
    const current = script('invalid')
    document.head.appendChild(current)
    await session().rewriteScript(current)
    expect(Reflect.get(window, '__rewriteProbe')).toBe('ORIGINAL')
  })

  it('keeps Rspack script identity, registers the chunk before load, and cancels removed scripts', async () => {
    const slow = gate<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === REWRITE_RUNTIME_URL) return Promise.resolve(new Response(remote))
        if (url.includes('slow')) return slow.promise
        return Promise.resolve(
          new Response('window.__rewriteProbe={value:"ORIGINAL",url:document.currentScript.src};')
        )
      })
    )
    const instance = session()
    cleanup.push(installScriptRewriteInterceptor(instance))
    const current = script('chunk', false)
    current.setAttribute('data-webpack', 'figma:chunk-1')
    const loaded = gate<unknown>()
    current.onload = (event) => {
      loaded.resolve({ value: Reflect.get(window, '__rewriteProbe'), target: event.target })
    }
    document.head.appendChild(current)
    expect(document.querySelector('script[data-webpack="figma:chunk-1"]')).toBe(current)
    expect(current.getAttribute('src')).toBe(current.src)
    const result = await loaded.promise
    expect(result).toEqual({ value: { value: 'REMOTE', url: current.src }, target: current })
    expect(current.src.startsWith('blob:')).toBe(true)

    const removed = script('slow', false)
    const onLoad = vi.fn()
    removed.onload = onLoad
    document.head.appendChild(removed)
    await vi.waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(removed.src, expect.anything())
    )
    removed.remove()
    slow.resolve(new Response('window.__rewriteProbe="LATE"'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onLoad).not.toHaveBeenCalled()
    expect(Reflect.get(window, '__rewriteProbe')).not.toBe('LATE')
  })

  it('restores nested currentScript descriptors and preserves existing fallback query parameters', () => {
    const a = script('a')
    const b = script('b')
    withCurrentScript(a, () => {
      expect(document.currentScript).toBe(a)
      withCurrentScript(b, () => expect(document.currentScript).toBe(b))
      expect(document.currentScript).toBe(a)
    })
    expect(Object.hasOwn(document, 'currentScript')).toBe(false)
    expect(fallbackUrl('https://www.figma.com/app.js?x=1#part')).toBe(
      'https://www.figma.com/app.js?x=1&tempad-fallback=1#part'
    )
  })
})
