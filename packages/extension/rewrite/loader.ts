import { logger } from '@/utils/log'

import type { RewriteRuntime } from './transform'

import { bundledRuntime, REWRITE_RUNTIME_PROTOCOL } from './transform'

export const REWRITE_RUNTIME_URL = 'https://ecomfe.github.io/tempad-dev/figma-runtime-v1.js'
export const RUNTIME_TIMEOUT_MS = 1500
const MAX_RUNTIME_LENGTH = 1024 * 1024

export async function fetchScriptText(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal })
        if (!response.ok) throw new Error(`Script request failed (${response.status}): ${url}`)
        return await response.text()
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Script request timed out: ${url}`))
          controller.abort()
        }, timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function loadRewriteRuntime({
  remote = true,
  timeoutMs = RUNTIME_TIMEOUT_MS
}: { remote?: boolean; timeoutMs?: number } = {}): Promise<RewriteRuntime> {
  if (!remote) return bundledRuntime
  try {
    // Honor HTTP freshness/revalidation across page loads. Never bust the cache per script.
    const code = await fetchScriptText(
      REWRITE_RUNTIME_URL,
      { credentials: 'omit', cache: 'default' },
      timeoutMs
    )
    if (code.length > MAX_RUNTIME_LENGTH) throw new Error('Rewrite runtime is too large.')
    const runtime: unknown = new Function(
      `${code}\n;return TemPadRewriteRuntimeV1.default;\n//# sourceURL=${REWRITE_RUNTIME_URL}`
    )()
    if (
      !runtime ||
      typeof runtime !== 'object' ||
      !('protocol' in runtime) ||
      runtime.protocol !== REWRITE_RUNTIME_PROTOCOL ||
      !('targetPattern' in runtime) ||
      typeof runtime.targetPattern !== 'string' ||
      !('rewrite' in runtime) ||
      typeof runtime.rewrite !== 'function'
    ) {
      throw new Error('Incompatible rewrite runtime.')
    }
    new RegExp(runtime.targetPattern, 'i')
    return runtime as RewriteRuntime
  } catch (error) {
    logger.warn('Remote rewrite runtime unavailable; using bundled runtime.', error)
    return bundledRuntime
  }
}
