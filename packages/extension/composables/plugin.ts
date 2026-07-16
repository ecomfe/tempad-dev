import { shallowRef } from 'vue'

import SNAPSHOT_PLUGINS from '@/plugins/available-plugins.json'
import { codegen } from '@/utils'

import { useToast } from './toast'

export const REGISTERED_PLUGIN_SOURCE_RE = /^@[a-z\d_-]+(?:\/[a-z\d_-]+)*$/
export const MAX_PLUGIN_SOURCE_BYTES = 512 * 1024
const MAX_PLUGIN_REGISTRY_BYTES = 128 * 1024

// The live registry preserves the existing ability to add @name plugins without an extension release.
// Its entries are treated as discovery metadata; fetched plugin code is sandboxed and snapshotted.
const REGISTRY_URL =
  'https://raw.githubusercontent.com/ecomfe/tempad-dev/refs/heads/main/packages/extension/plugins/available-plugins.json'

type RegistryEntry = { name: string; url: string }

async function getRegisteredPluginSource(source: string, signal?: AbortSignal): Promise<string> {
  const name = source.slice(1)
  let pluginList: RegistryEntry[]
  try {
    pluginList = await fetchRegistry(signal)
  } catch (error) {
    if (signal?.aborted) throw error
    pluginList = validateRegistry(SNAPSHOT_PLUGINS)
  }
  const plugin = pluginList.find((entry) => entry.name === name)
  if (!plugin) {
    throw new Error(`"${name}" is not a registered plugin.`)
  }
  return plugin.url
}

async function fetchRegistry(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const response = await fetch(REGISTRY_URL, { cache: 'no-cache', signal })
  ensureSuccessfulResponse(response)
  const text = await readBoundedText(response, MAX_PLUGIN_REGISTRY_BYTES)
  return validateRegistry(JSON.parse(text))
}

function validateRegistry(value: unknown): RegistryEntry[] {
  if (!Array.isArray(value)) throw new Error('Plugin registry is invalid.')

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      !REGISTERED_PLUGIN_SOURCE_RE.test(`@${entry.name}`) ||
      typeof entry.url !== 'string'
    ) {
      throw new Error('Plugin registry is invalid.')
    }
    validatePluginUrl(entry.url, false)
    return { name: entry.name, url: entry.url }
  })
}

export type PluginData = {
  code: string
  integrity: string
  pluginName: string
  resolvedUrl: string
  source: string // can be a URL or a registered plugin name like `@{plugin-name}`
}

export function usePluginInstall() {
  const { show } = useToast()

  const validity = shallowRef('')
  const installing = shallowRef(false)
  let controller: AbortController | null = null

  function cancel() {
    controller?.abort()
    controller = null
    installing.value = false
  }

  async function install(src: string, isUpdate = false) {
    if (installing.value) {
      return null
    }

    const currentController = new AbortController()
    controller = currentController
    const { signal } = currentController
    const isCurrent = () => controller === currentController && !signal.aborted

    installing.value = true

    try {
      const url = REGISTERED_PLUGIN_SOURCE_RE.test(src)
        ? await getRegisteredPluginSource(src, signal)
        : src
      if (!isCurrent()) return null

      const requestedUrl = validatePluginUrl(url)
      const allowLoopbackRedirect =
        requestedUrl.protocol === 'http:' && isLoopbackHost(requestedUrl.hostname)

      const response = await fetch(url, { cache: 'no-cache', signal })
      if (!isCurrent()) return null
      ensureSuccessfulResponse(response)
      validatePluginUrl(response.url || url, allowLoopbackRedirect)
      ensureScriptLikeResponse(response)

      const code = await readBoundedText(response, MAX_PLUGIN_SOURCE_BYTES)
      if (!isCurrent()) return null
      const integrity = await sha256(code)
      if (!isCurrent()) return null

      try {
        const { pluginName } = await codegen(
          {},
          null,
          { useRem: false, rootFontSize: 12, scale: 1 },
          code
        )
        if (!isCurrent()) return null
        if (!pluginName) {
          validity.value = 'The plugin name must not be empty.'
          return null
        }
        validity.value = ''
        show(`Plugin "${pluginName}" ${isUpdate ? 'updated' : 'installed'} successfully.`)
        return {
          code,
          integrity,
          pluginName,
          resolvedUrl: response.url || url,
          source: src
        }
      } catch (error) {
        if (isCurrent()) {
          validity.value = `Failed to evaluate the code: ${errorMessage(error, 'Unknown error')}`
        }
        return null
      }
    } catch (error) {
      if (isCurrent()) {
        validity.value = `Failed to fetch the script content: ${errorMessage(error, 'Network error')}`
      }
      return null
    } finally {
      if (controller === currentController) {
        controller = null
        installing.value = false
      }
    }
  }

  return {
    validity,
    installing,
    cancel,
    install
  }
}

export function isAllowedPluginSource(value: string): boolean {
  if (REGISTERED_PLUGIN_SOURCE_RE.test(value)) return true
  try {
    validatePluginUrl(value)
    return true
  } catch {
    return false
  }
}

function validatePluginUrl(value: string, allowLoopbackHttp = true): URL {
  const url = new URL(value)
  if (url.username || url.password) {
    throw new Error('Plugin URLs must not contain credentials.')
  }
  if (url.protocol === 'https:') return url
  if (allowLoopbackHttp && url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url
  throw new Error('Plugin URLs must use HTTPS (HTTP is allowed only for local development).')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function ensureSuccessfulResponse(response: Response): void {
  if (response.status !== 200) {
    throw new Error(`${response.status}: ${response.statusText || 'Request failed'}`)
  }
}

function ensureScriptLikeResponse(response: Response): void {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (contentType?.includes('text/html') || contentType?.includes('application/xhtml')) {
    throw new Error('Plugin URL returned an HTML document instead of JavaScript.')
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  const tooLarge = () => new Error(`Plugin content exceeds the ${maxBytes / 1024} KiB limit.`)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw tooLarge()
  }

  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw tooLarge()
    }
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw tooLarge()
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `sha256:${hex}`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
