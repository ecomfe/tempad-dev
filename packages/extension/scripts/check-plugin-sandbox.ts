import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import type { PluginSandboxResponse } from '../plugin-sandbox/protocol'

import { PLUGIN_SANDBOX_LIMITS } from '../plugin-sandbox/limits'
import {
  PLUGIN_SANDBOX_MESSAGE,
  PLUGIN_SANDBOX_PROTOCOL_VERSION,
  PLUGIN_SANDBOX_WORKER
} from '../plugin-sandbox/protocol'

type GeneratedManifest = {
  content_security_policy?: { sandbox?: string }
  sandbox?: { pages?: string[] }
  web_accessible_resources?: Array<{ matches?: string[]; resources?: string[] }>
}

type CapabilityResult = {
  available: boolean
  allowed: boolean
  errorName?: string
}

type CapabilityProbeResult = {
  origin: string
  locationOrigin: string
  globals: {
    broadcastChannel: string
    browser: string
    chromeRuntime: string
    crypto: string
    document: string
    eventSource: string
    navigator: string
    postMessage: string
    worker: string
    xmlHttpRequest: string
  }
  eventSource: CapabilityResult
  fetch: CapabilityResult
  indexedDb: CapabilityResult
  cacheStorage: CapabilityResult
  nestedWorker: CapabilityResult
  websocket: CapabilityResult
  xmlHttpRequest: CapabilityResult
  importScripts: CapabilityResult
}

const extensionDir = fileURLToPath(new URL('../.output/chrome-mv3/', import.meta.url))

async function main(): Promise<void> {
  verifyManifest(await readManifest())

  const networkProbe = await startNetworkProbe()
  const profileDir = await mkdtemp(path.join(tmpdir(), 'tempad-plugin-sandbox-'))
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  })

  try {
    const extensionId = await resolveExtensionId(context)
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/plugin-sandbox.html`)

    const pageCapabilities = await page.evaluate(() => ({
      origin: globalThis.origin,
      chromeRuntime: typeof Reflect.get(
        (Reflect.get(globalThis, 'chrome') as object | undefined) ?? {},
        'runtime'
      )
    }))
    assert.equal(pageCapabilities.origin, 'null', 'Sandbox page must have an opaque origin.')
    assert.equal(
      pageCapabilities.chromeRuntime,
      'undefined',
      'Sandbox page must not expose extension APIs.'
    )

    await page.evaluate('globalThis.__name = (target) => target')
    const result = await page.evaluate(
      async ({ capabilityPluginCode, httpUrl, maxPayloadBytes, message, version, workers }) => {
        const channel = new MessageChannel()
        const pending = new Map<number, (value: PluginSandboxResponse) => void>()
        let resolveConnected!: () => void
        const connected = new Promise<void>((resolve) => {
          resolveConnected = resolve
        })

        channel.port1.onmessage = ({ data }: MessageEvent<Record<string, unknown>>) => {
          if (data?.type === message.connected && data.version === version) {
            resolveConnected()
            return
          }
          if (typeof data?.id !== 'number') return
          pending.get(data.id)?.(data as PluginSandboxResponse)
        }
        channel.port1.start()
        window.postMessage({ type: message.connect, version }, '*', [channel.port2])
        await connected

        const request = (id: number, payload: unknown, worker: string = workers.codegen) =>
          new Promise<PluginSandboxResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id)
              reject(new Error(`Sandbox request ${id} timed out.`))
            }, 7000)
            pending.set(id, (value) => {
              clearTimeout(timer)
              pending.delete(id)
              resolve(value)
            })
            channel.port1.postMessage({ id, type: message.request, worker, payload })
          })

        const capability = await request(1, {
          pluginCode: capabilityPluginCode,
          style: { color: 'red' },
          options: { useRem: false, rootFontSize: 16, scale: 1 }
        })
        const validJob = {
          style: {},
          options: { useRem: false, rootFontSize: 16, scale: 1 }
        }
        const validPayload = {
          ...validJob,
          pluginCode: 'export default { name: "sandbox-protocol-probe", code: {} }'
        }
        const valid = await request(2, validPayload)
        const oversized = await request(3, 'x'.repeat(maxPayloadBytes + 1))
        const invalidWorker = await request(4, validPayload, 'unknown-worker')
        const timedOut = await request(5, {
          ...validPayload,
          pluginCode: 'while (true) {}\nexport default { name: "never-reached", code: {} }'
        })
        const recovered = await request(6, validPayload)
        const polluted = await request(7, {
          ...validPayload,
          style: { color: 'red' },
          pluginCode: `
              Object.prototype.__tempadSandboxPollution = 'leaked'
              export default {
                name: 'prototype-polluter',
                code: { css: { transform({ code }) { return code } }, js: false }
              }
            `
        })
        const pollutionProbe = await request(8, {
          ...validPayload,
          style: { color: 'red' },
          pluginCode: `
              export default {
                name: 'prototype-probe',
                code: {
                  css: {
                    transform() {
                      return Object.prototype.__tempadSandboxPollution || 'clean'
                    }
                  },
                  js: false
                }
              }
            `
        })
        const hiddenImport = await request(9, {
          ...validPayload,
          pluginCode: `
              let n = 1
              n++ / import(${JSON.stringify(httpUrl)}) / 2
              export default { name: 'hidden-import', code: {} }
            `
        })
        const oversizedOutput = await request(10, {
          ...validPayload,
          style: { color: 'red' },
          pluginCode: `
              export default {
                name: 'oversized-output',
                code: {
                  css: { transform() { return 'x'.repeat(${maxPayloadBytes + 1}) } },
                  js: false
                }
              }
            `
        })
        const recoveredAfterOversizedOutput = await request(11, validPayload)
        const statefulBatchPayload = {
          pluginCode: `
            let calls = 0
            export default {
              name: 'stateful-batch-probe',
              code: {
                css: { transform() { calls += 1; return String(calls) } },
                js: false
              }
            }
          `,
          jobs: [
            { ...validJob, style: { color: 'red' } },
            { ...validJob, style: { color: 'blue' } }
          ]
        }
        const statefulBatch = await request(12, statefulBatchPayload)
        const isolatedBatch = await request(13, statefulBatchPayload)

        channel.port1.close()
        return {
          capability,
          hiddenImport,
          isolatedBatch,
          invalidWorker,
          oversized,
          oversizedOutput,
          polluted,
          pollutionProbe,
          recovered,
          recoveredAfterOversizedOutput,
          statefulBatch,
          timedOut,
          valid
        }
      },
      {
        capabilityPluginCode: createCapabilityProbePlugin(
          networkProbe.httpUrl,
          networkProbe.websocketUrl
        ),
        httpUrl: networkProbe.httpUrl,
        maxPayloadBytes: PLUGIN_SANDBOX_LIMITS.maxPayloadBytes,
        message: PLUGIN_SANDBOX_MESSAGE,
        version: PLUGIN_SANDBOX_PROTOCOL_VERSION,
        workers: PLUGIN_SANDBOX_WORKER
      }
    )

    verifyProbeResult(readCapabilityResult(result.capability))
    verifyProtocolResult(result)
    assert.equal(
      networkProbe.attempts(),
      0,
      'Sandboxed plugin Worker reached the loopback network probe.'
    )

    await verifyFigmaEmbedding(context, extensionId)
  } finally {
    await context.close()
    await networkProbe.close()
    await rm(profileDir, { force: true, recursive: true })
  }

  console.log('[plugin-sandbox-check] Opaque-origin capability and broker lifecycle probes passed.')
}

async function readManifest(): Promise<GeneratedManifest> {
  return JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'))
}

function verifyManifest(manifest: GeneratedManifest): void {
  assert.ok(
    manifest.sandbox?.pages?.includes('plugin-sandbox.html'),
    'Generated manifest is missing the plugin sandbox page.'
  )

  const policy = manifest.content_security_policy?.sandbox ?? ''
  assert.match(policy, /(?:^|;)\s*sandbox allow-scripts(?:;|$)/)
  assert.doesNotMatch(policy, /allow-same-origin/)
  assert.match(policy, /(?:^|;)\s*default-src 'none'(?:;|$)/)
  assert.match(policy, /(?:^|;)\s*connect-src 'none'(?:;|$)/)
  assert.match(policy, /(?:^|;)\s*worker-src blob:(?:;|$)/)

  const figmaResources = manifest.web_accessible_resources?.find((entry) =>
    entry.matches?.includes('https://www.figma.com/*')
  )?.resources
  assert.ok(figmaResources?.includes('/plugin-sandbox.html'))
  assert.ok(figmaResources?.includes('/chunks/plugin-sandbox-*.js'))
}

function readCapabilityResult(response: PluginSandboxResponse): CapabilityProbeResult {
  const code = readCssCode(response)
  assert.ok(code, 'Capability probe plugin did not return its result code block.')
  return JSON.parse(code) as CapabilityProbeResult
}

function verifyProbeResult(result: CapabilityProbeResult): void {
  assert.equal(result.origin, 'null', 'Plugin Worker must have an opaque origin.')
  assert.equal(result.locationOrigin, 'null', 'Plugin Worker location must be opaque.')
  assert.equal(result.globals.browser, 'undefined')
  assert.equal(result.globals.chromeRuntime, 'undefined')
  assert.equal(result.globals.document, 'undefined')
  assert.equal(result.globals.postMessage, 'undefined')

  for (const [name, capability] of Object.entries({
    eventSource: result.eventSource,
    fetch: result.fetch,
    indexedDb: result.indexedDb,
    cacheStorage: result.cacheStorage,
    nestedWorker: result.nestedWorker,
    websocket: result.websocket,
    xmlHttpRequest: result.xmlHttpRequest,
    importScripts: result.importScripts
  })) {
    assert.equal(capability.allowed, false, `Sandbox unexpectedly allowed ${name}.`)
  }
}

function createCapabilityProbePlugin(httpUrl: string, websocketUrl: string): string {
  return `
const httpUrl = ${JSON.stringify(httpUrl)}
const websocketUrl = ${JSON.stringify(websocketUrl)}
const allowed = () => ({ available: true, allowed: true })
const unavailable = () => ({ available: false, allowed: false })
const blocked = (error) => ({
  available: true,
  allowed: false,
  ...(error && typeof error.name === 'string' ? { errorName: error.name } : {})
})
async function testFetch() {
  if (typeof fetch !== 'function') return unavailable()
  try {
    await fetch(httpUrl, { cache: 'no-store', mode: 'no-cors' })
    return allowed()
  } catch (error) {
    return blocked(error)
  }
}
async function testIndexedDb() {
  if (typeof indexedDB !== 'object') return unavailable()
  try {
    const request = indexedDB.open('tempad-plugin-sandbox-probe')
    return await new Promise((resolve) => {
      request.onerror = () => resolve(blocked(request.error))
      request.onsuccess = () => {
        request.result.close()
        indexedDB.deleteDatabase('tempad-plugin-sandbox-probe')
        resolve(allowed())
      }
    })
  } catch (error) {
    return blocked(error)
  }
}
async function testCacheStorage() {
  const storage = Reflect.get(globalThis, 'caches')
  if (!storage) return unavailable()
  try {
    await storage.open('tempad-plugin-sandbox-probe')
    await storage.delete('tempad-plugin-sandbox-probe')
    return allowed()
  } catch (error) {
    return blocked(error)
  }
}
async function testWebSocket() {
  if (typeof WebSocket !== 'function') return unavailable()
  try {
    const socket = new WebSocket(websocketUrl)
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.close()
        resolve(allowed())
      }, 250)
      socket.onerror = (event) => {
        clearTimeout(timer)
        resolve(blocked(event))
      }
      socket.onopen = () => {
        clearTimeout(timer)
        socket.close()
        resolve(allowed())
      }
    })
  } catch (error) {
    return blocked(error)
  }
}
async function testXmlHttpRequest() {
  const XMLHttpRequest = Reflect.get(globalThis, 'XMLHttpRequest')
  if (typeof XMLHttpRequest !== 'function') return unavailable()
  try {
    const request = new XMLHttpRequest()
    request.timeout = 250
    return await new Promise((resolve) => {
      request.onload = () => resolve(allowed())
      request.onerror = (event) => resolve(blocked(event))
      request.ontimeout = (event) => resolve(blocked(event))
      request.open('GET', httpUrl)
      request.send()
    })
  } catch (error) {
    return blocked(error)
  }
}
async function testEventSource() {
  const EventSource = Reflect.get(globalThis, 'EventSource')
  if (typeof EventSource !== 'function') return unavailable()
  try {
    const source = new EventSource(httpUrl)
    return await new Promise((resolve) => {
      source.onopen = () => {
        source.close()
        resolve(allowed())
      }
      source.onerror = (event) => {
        source.close()
        resolve(blocked(event))
      }
    })
  } catch (error) {
    return blocked(error)
  }
}
async function testNestedWorker() {
  const Worker = Reflect.get(globalThis, 'Worker')
  if (typeof Worker !== 'function') return unavailable()
  let url
  try {
    const source = ${JSON.stringify(
      `fetch(${JSON.stringify(httpUrl)})\n` +
        `.then(() => postMessage({ available: true, allowed: true }))\n` +
        `.catch((error) => postMessage({ available: true, allowed: false, errorName: error?.name }))`
    )}
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const worker = new Worker(url)
    return await new Promise((resolve) => {
      worker.onmessage = ({ data }) => {
        worker.terminate()
        URL.revokeObjectURL(url)
        resolve(data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        URL.revokeObjectURL(url)
        resolve(blocked(event))
      }
    })
  } catch (error) {
    if (url) URL.revokeObjectURL(url)
    return blocked(error)
  }
}
function testImportScripts() {
  const load = Reflect.get(globalThis, 'importScripts')
  if (typeof load !== 'function') return unavailable()
  try {
    load.call(globalThis, httpUrl)
    return allowed()
  } catch (error) {
    return blocked(error)
  }
}
const capability = {
  origin: globalThis.origin,
  locationOrigin: globalThis.location.origin,
  globals: {
    browser: typeof Reflect.get(globalThis, 'browser'),
    chromeRuntime: typeof Reflect.get(Reflect.get(globalThis, 'chrome') || {}, 'runtime'),
    document: typeof Reflect.get(globalThis, 'document'),
    worker: typeof Reflect.get(globalThis, 'Worker'),
    broadcastChannel: typeof Reflect.get(globalThis, 'BroadcastChannel'),
    xmlHttpRequest: typeof Reflect.get(globalThis, 'XMLHttpRequest'),
    eventSource: typeof Reflect.get(globalThis, 'EventSource'),
    crypto: typeof Reflect.get(globalThis, 'crypto'),
    navigator: typeof Reflect.get(globalThis, 'navigator'),
    postMessage: typeof Reflect.get(globalThis, 'postMessage')
  },
  eventSource: await testEventSource(),
  fetch: await testFetch(),
  indexedDb: await testIndexedDb(),
  cacheStorage: await testCacheStorage(),
  nestedWorker: await testNestedWorker(),
  websocket: await testWebSocket(),
  xmlHttpRequest: await testXmlHttpRequest(),
  importScripts: testImportScripts()
}
export default {
  name: 'sandbox-capability-probe',
  code: {
    css: { transform() { return JSON.stringify(capability) } },
    js: false
  }
}
`
}

function verifyProtocolResult(result: {
  hiddenImport: PluginSandboxResponse
  isolatedBatch: PluginSandboxResponse
  invalidWorker: PluginSandboxResponse
  oversized: PluginSandboxResponse
  oversizedOutput: PluginSandboxResponse
  polluted: PluginSandboxResponse
  pollutionProbe: PluginSandboxResponse
  recovered: PluginSandboxResponse
  recoveredAfterOversizedOutput: PluginSandboxResponse
  statefulBatch: PluginSandboxResponse
  timedOut: PluginSandboxResponse
  valid: PluginSandboxResponse
}): void {
  assert.ok('payload' in result.valid)
  assert.equal(
    (result.valid.payload as { pluginName?: string }).pluginName,
    'sandbox-protocol-probe'
  )
  assert.equal(result.oversized.error?.code, 'payload-too-large')
  assert.equal(result.invalidWorker.error?.code, 'protocol-error')
  assert.equal(result.timedOut.error?.code, 'timeout')
  assert.equal(result.hiddenImport.error?.code, 'worker-error')
  assert.equal(result.oversizedOutput.error?.code, 'payload-too-large')
  assert.ok('payload' in result.polluted)
  assert.equal(readCssCode(result.pollutionProbe), 'clean')
  assert.deepEqual(readBatchCssCodes(result.statefulBatch), ['1', '2'])
  assert.deepEqual(
    readBatchCssCodes(result.isolatedBatch),
    ['1', '2'],
    'Plugin batch state leaked into the next fresh Worker.'
  )
  assert.ok(
    'payload' in result.recovered,
    'Broker did not recover after terminating a timed-out Worker.'
  )
  assert.ok(
    'payload' in result.recoveredAfterOversizedOutput,
    'Broker did not recover after rejecting an oversized Worker response.'
  )
}

function readCssCode(response: PluginSandboxResponse): string | undefined {
  if (!('payload' in response)) return undefined
  const payload = response.payload as {
    codeBlocks?: Array<{ code?: string; name?: string }>
  }
  return payload.codeBlocks?.find(({ name }) => name === 'css')?.code
}

function readBatchCssCodes(response: PluginSandboxResponse): Array<string | undefined> {
  if (!('payload' in response)) return []
  const payload = response.payload as {
    results?: Array<{ codeBlocks?: Array<{ code?: string; name?: string }> }>
  }
  return (
    payload.results?.map((result) => result.codeBlocks?.find(({ name }) => name === 'css')?.code) ??
    []
  )
}

async function verifyFigmaEmbedding(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  extensionId: string
): Promise<void> {
  const page = await context.newPage()
  const hostUrl = 'https://www.figma.com/__tempad_plugin_sandbox_probe__'
  await page.route(hostUrl, (route) =>
    route.fulfill({
      body: '<!doctype html><title>TemPad sandbox host probe</title>',
      contentType: 'text/html'
    })
  )
  await page.goto(hostUrl)
  await page.evaluate('globalThis.__name = (target) => target')

  const response = await page.evaluate(
    async ({ message, sandboxUrl, version, worker }) => {
      const iframe = document.createElement('iframe')
      iframe.hidden = true
      iframe.sandbox.add('allow-scripts')
      iframe.src = sandboxUrl

      return await new Promise<PluginSandboxResponse>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Embedded sandbox timed out.')), 7000)
        const onReady = (event: MessageEvent) => {
          if (event.source !== iframe.contentWindow || event.origin !== 'null') return
          if (event.data?.type !== message.ready || event.data?.version !== version) return
          window.removeEventListener('message', onReady)

          const channel = new MessageChannel()
          channel.port1.onmessage = ({ data }: MessageEvent<Record<string, unknown>>) => {
            if (data?.type === message.connected) {
              channel.port1.postMessage({
                id: 1,
                type: message.request,
                worker,
                payload: {
                  pluginCode: 'export default { name: "embedded-sandbox-probe", code: {} }',
                  style: {},
                  options: { useRem: false, rootFontSize: 16, scale: 1 }
                }
              })
              return
            }
            if (data?.type !== message.response || data.id !== 1) return
            clearTimeout(timer)
            channel.port1.close()
            iframe.remove()
            resolve(data as PluginSandboxResponse)
          }
          channel.port1.start()
          iframe.contentWindow?.postMessage({ type: message.connect, version }, '*', [
            channel.port2
          ])
        }

        window.addEventListener('message', onReady)
        document.documentElement.append(iframe)
      })
    },
    {
      message: PLUGIN_SANDBOX_MESSAGE,
      sandboxUrl: `chrome-extension://${extensionId}/plugin-sandbox.html`,
      version: PLUGIN_SANDBOX_PROTOCOL_VERSION,
      worker: PLUGIN_SANDBOX_WORKER.codegen
    }
  )

  assert.ok('payload' in response, 'Figma-origin page could not use the sandbox broker.')
  assert.equal((response.payload as { pluginName?: string }).pluginName, 'embedded-sandbox-probe')
  await page.close()
}

async function resolveExtensionId(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>
): Promise<string> {
  const serviceWorker =
    context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://')) ??
    (await context.waitForEvent('serviceworker', { timeout: 10_000 }))
  const extensionId = new URL(serviceWorker.url()).host
  assert.ok(extensionId, 'Unable to resolve the unpacked extension id.')
  return extensionId
}

async function startNetworkProbe(): Promise<{
  httpUrl: string
  websocketUrl: string
  attempts: () => number
  close: () => Promise<void>
}> {
  let attempts = 0
  const server = createServer((_request, response) => {
    attempts += 1
    response.writeHead(204)
    response.end()
  })
  server.on('upgrade', (_request, socket) => {
    attempts += 1
    socket.destroy()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const authority = `127.0.0.1:${address.port}`
  return {
    httpUrl: `http://${authority}/probe.js`,
    websocketUrl: `ws://${authority}/probe`,
    attempts: () => attempts,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
