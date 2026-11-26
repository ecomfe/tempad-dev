import { logger } from '../utils/log'
import { GROUPS } from './config'
import { REWRITE_TARGET_REGEX } from './rules'
import { applyGroups } from './shared'

export async function fetchRewrittenScript(src: string): Promise<string | null> {
  const response = await fetch(src, { credentials: 'include', cache: 'force-cache' })
  if (!response.ok) throw new Error(`Script request failed with HTTP ${response.status}: ${src}`)
  const original = await response.text()
  const { content } = applyGroups(original, GROUPS)
  // The main-world content script preserves window.figma through its setter.
  const rewritten = content.replaceAll('delete window.figma', 'window.figma = undefined')
  if (rewritten === original) return null
  logger.log(`Rewrote script: ${src}`)
  return rewritten
}

export function scriptFallbackUrl(src: string): string {
  const url = new URL(src)
  // The packaged DNR redirect only matches URLs without a query.
  url.search += url.search ? '&fallback' : '?fallback'
  return url.href
}

function withCurrentScript(current: HTMLScriptElement, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'currentScript')

  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get() {
      return current
    }
  })

  try {
    run()
  } finally {
    if (descriptor) {
      Object.defineProperty(document, 'currentScript', descriptor)
    } else {
      Reflect.deleteProperty(document, 'currentScript')
    }
  }
}

export async function rewriteCurrentScript(): Promise<void> {
  const current = document.currentScript
  if (!(current instanceof HTMLScriptElement) || !REWRITE_TARGET_REGEX.test(current.src)) return
  const src = current.src
  let started = false

  try {
    const content = await fetchRewrittenScript(src)
    if (content !== null) {
      const execute = new Function(content)
      withCurrentScript(current, () => {
        started = true
        execute()
      })
      return
    }
  } catch (error) {
    logger.error(error)
    // Top-level side effects may already have run before the exception.
    if (started) return
  }

  const script = document.createElement('script')
  script.async = current.async
  script.defer = true
  script.src = scriptFallbackUrl(src)
  current.replaceWith(script)
}
