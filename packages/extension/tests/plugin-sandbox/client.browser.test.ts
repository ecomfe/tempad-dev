import { expect, it, vi } from 'vitest'

import { PluginSandboxClient } from '@/plugin-sandbox/client'
import {
  PLUGIN_SANDBOX_MESSAGE,
  PLUGIN_SANDBOX_PROTOCOL_VERSION,
  PLUGIN_SANDBOX_WORKER
} from '@/plugin-sandbox/protocol'

it('rejects a request interrupted after connection and preserves its replacement connection', async () => {
  const append = document.documentElement.append.bind(document.documentElement)
  vi.spyOn(document.documentElement, 'append').mockImplementation((...nodes) => {
    for (const node of nodes) {
      if (!(node instanceof HTMLIFrameElement)) continue
      // Exercise opaque iframe messages and real transferred ports with a small echo broker.
      node.removeAttribute('src')
      node.srcdoc = `<script>
        const message = ${JSON.stringify(PLUGIN_SANDBOX_MESSAGE)}
        const version = ${PLUGIN_SANDBOX_PROTOCOL_VERSION}
        window.addEventListener('message', (event) => {
          if (event.source !== parent || event.data?.type !== message.connect) return
          const [port] = event.ports
          port.onmessage = ({ data }) => {
            port.postMessage({ type: message.response, id: data.id, payload: data.payload })
          }
          port.start()
          port.postMessage({ type: message.connected, version })
        })
        parent.postMessage({ type: message.ready, version }, '*')
      </script>`
    }
    append(...nodes)
  })
  const client = new PluginSandboxClient(
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/plugin-sandbox.html'
  )
  let interrupted: Promise<unknown> | undefined
  try {
    await expect(client.request(PLUGIN_SANDBOX_WORKER.codegen, 'initial')).resolves.toBe('initial')
    vi.useFakeTimers()
    let failure: unknown
    interrupted = client
      .request(PLUGIN_SANDBOX_WORKER.codegen, 'discard')
      .catch((error: unknown) => {
        failure = error
      })
    client.dispose()
    await expect(client.request(PLUGIN_SANDBOX_WORKER.codegen, 'replacement')).resolves.toBe(
      'replacement'
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(failure).toMatchObject({
      message: 'Plugin sandbox connection was reset before sending the request.'
    })
    expect(vi.getTimerCount()).toBe(0)
    await expect(client.request(PLUGIN_SANDBOX_WORKER.codegen, 'still connected')).resolves.toBe(
      'still connected'
    )
  } finally {
    client.dispose()
    await interrupted
    vi.useRealTimers()
  }
})

it('rejects connecting requests and clears the handshake when the client is disposed', async () => {
  vi.useFakeTimers()
  // Keep the native iframe unmounted to represent an unanswered sandbox load.
  vi.spyOn(document.documentElement, 'append').mockImplementation(() => {})
  const createElement = vi.spyOn(document, 'createElement')
  const client = new PluginSandboxClient(
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/plugin-sandbox.html'
  )
  let failure: unknown
  const pending = client.request(PLUGIN_SANDBOX_WORKER.codegen, {}).catch((error: unknown) => {
    failure = error
  })
  const retryFailures: unknown[] = []
  const retries: Promise<unknown>[] = []
  try {
    client.dispose()
    retries.push(
      client.request(PLUGIN_SANDBOX_WORKER.codegen, {}).catch((error: unknown) => {
        retryFailures.push(error)
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(failure).toMatchObject({ message: 'Plugin sandbox client was disposed.' })
    retries.push(
      client.request(PLUGIN_SANDBOX_WORKER.codegen, {}).catch((error: unknown) => {
        retryFailures.push(error)
      })
    )
    expect(createElement.mock.calls.filter(([tag]) => tag === 'iframe')).toHaveLength(2)
    client.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(retryFailures).toEqual([
      expect.objectContaining({ message: 'Plugin sandbox client was disposed.' }),
      expect.objectContaining({ message: 'Plugin sandbox client was disposed.' })
    ])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    client.dispose()
    await vi.runAllTimersAsync()
    await pending
    await Promise.all(retries)
    vi.useRealTimers()
  }
})
