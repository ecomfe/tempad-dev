import type { Group } from '@/types/rewrite'

import { logger } from '../utils/log'
import { fetchScriptText } from './loader'
import { rewriteSource } from './transform'

function getCurrentScript(): HTMLScriptElement | null {
  const current = document.currentScript
  if (!(current instanceof HTMLScriptElement) || !current.src) {
    return null
  }
  return current
}

export function replaceScript(
  current: HTMLScriptElement,
  src: string,
  timeoutMs = 15000
): Promise<void> {
  const script = document.createElement('script')
  for (const { name, value } of current.attributes) {
    if (
      !['src', 'integrity', 'onload', 'onerror'].includes(name) &&
      !(name === 'type' && value === 'application/x-tempad-rewrite')
    ) {
      script.setAttribute(name, value)
    }
  }
  script.src = fallbackUrl(src)
  script.async = false
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onLoad = () => finish()
    const onError = () => finish(new Error(`Unable to load ${src}`))
    const timer = setTimeout(() => {
      script.remove()
      finish(new Error(`Original script request timed out: ${src}`))
    }, timeoutMs)
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    current.replaceWith(script)
  })
}

export function fallbackUrl(src: string): string {
  const url = new URL(src)
  url.searchParams.set('tempad-fallback', '1')
  return url.href
}

export function withCurrentScript(current: HTMLScriptElement, run: () => void): void {
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

export async function rewriteCurrentScript(groups: Group[]): Promise<void> {
  const current = getCurrentScript()
  if (!current) {
    return
  }

  const src = current.src

  let run: () => void
  try {
    const original = await fetchScriptText(
      src,
      { credentials: 'include', cache: 'force-cache' },
      15000
    )
    run = new Function(rewriteSource(original, groups)) as () => void
  } catch (error) {
    logger.error(error)
    await replaceScript(current, src)
    return
  }
  // Never replay the original after execution has begun: it may have mutated the page.
  try {
    withCurrentScript(current, run)
  } catch (error) {
    logger.error('Rewritten script failed during execution.', error)
  }
}
