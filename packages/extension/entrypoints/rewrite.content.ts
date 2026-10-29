import { GROUPS } from '@/rewrite/config'
import { REWRITE_TARGET_REGEX } from '@/rewrite/rules'
import { applyGroups } from '@/rewrite/shared'
import { logger } from '@/utils/log'

import type { BlobHandle, CacheEntry } from '../types/rewrite'

function preserveWindowFigma(): void {
  let figma: Window['figma'] | undefined = undefined
  Reflect.defineProperty(window, 'figma', {
    set(val) {
      if (val === undefined) {
        return
      }

      figma = val
    },
    get() {
      return figma
    }
  })
}

function createBlobCache(): (src: string) => Promise<BlobHandle> {
  const cache = new Map<string, Promise<CacheEntry>>()

  async function createEntry(src: string): Promise<CacheEntry> {
    const response = await fetch(src, { credentials: 'include', cache: 'force-cache' })
    if (!response.ok) throw new Error(`Script request failed with HTTP ${response.status}: ${src}`)
    const originalText = await response.text()
    const { content, changed } = applyGroups(originalText, GROUPS)

    if (changed) {
      logger.log(`Rewrote async script: ${src}`)
    }

    const blob = new Blob([content], { type: 'application/javascript; charset=utf-8' })
    return { url: URL.createObjectURL(blob), ref: 0 }
  }

  async function acquireBlobUrl(src: string): Promise<BlobHandle> {
    let pending = cache.get(src)
    if (!pending) {
      pending = createEntry(src)
      cache.set(src, pending)
    }
    let entry: CacheEntry
    try {
      entry = await pending
    } catch (error) {
      if (cache.get(src) === pending) cache.delete(src)
      throw error
    }
    entry.ref += 1
    let released = false
    return {
      url: entry.url,
      release: () => {
        if (released) return
        released = true
        entry.ref -= 1
        if (entry.ref > 0) return
        try {
          URL.revokeObjectURL(entry.url)
        } catch {
          // noop
        }
        if (cache.get(src) === pending) cache.delete(src)
      }
    }
  }

  return acquireBlobUrl
}

function isRewritableScript(node: Node): node is HTMLScriptElement {
  return node instanceof HTMLScriptElement && node.src.length > 0
}

function installScriptRewriteInterceptor(): void {
  const acquireBlobUrl = createBlobCache()
  const { appendChild, insertBefore } = Element.prototype
  const processedScripts = new WeakSet<HTMLScriptElement>()

  function normalizedInsert(parent: Element, node: Node, before: Node | null): void {
    if (before) {
      insertBefore.call(parent, node, before)
    } else {
      appendChild.call(parent, node)
    }
  }

  async function rewriteAndInsert(
    parent: Element,
    script: HTMLScriptElement,
    before: Node | null
  ): Promise<void> {
    if (processedScripts.has(script)) {
      normalizedInsert(parent, script, before)
      return
    }
    processedScripts.add(script)

    if (!REWRITE_TARGET_REGEX.test(script.src)) {
      normalizedInsert(parent, script, before)
      return
    }

    try {
      const { url, release } = await acquireBlobUrl(script.src)
      script.removeAttribute('integrity')
      script.addEventListener('load', release, { once: true })
      script.addEventListener('error', release, { once: true })
      script.src = url
    } catch {
      // noop
    }

    normalizedInsert(parent, script, before)
  }

  Element.prototype.appendChild = function <T extends Node>(this: Element, node: T): T {
    if (isRewritableScript(node)) {
      void rewriteAndInsert(this, node, null).catch((error) => {
        logger.error('Failed to insert rewritten script:', error)
        node.dispatchEvent(new Event('error'))
      })
      return node
    }

    appendChild.call(this, node)
    return node
  }

  Element.prototype.insertBefore = function <T extends Node>(
    this: Element,
    node: T,
    before: Node | null
  ): T {
    if (isRewritableScript(node)) {
      void rewriteAndInsert(this, node, before).catch((error) => {
        logger.error('Failed to insert rewritten script:', error)
        node.dispatchEvent(new Event('error'))
      })
      return node
    }

    insertBefore.call(this, node, before)
    return node
  }
}

export default defineContentScript({
  matches: ['https://www.figma.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    preserveWindowFigma()
    installScriptRewriteInterceptor()
  }
})
