import { REWRITE_TARGET_REGEX } from '@/rewrite/rules'
import { fetchRewrittenScript, scriptFallbackUrl } from '@/rewrite/runtime'
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

function createBlobCache(): (src: string) => Promise<BlobHandle | null> {
  const cache = new Map<string, Promise<CacheEntry | null>>()

  async function createEntry(src: string): Promise<CacheEntry | null> {
    const content = await fetchRewrittenScript(src)
    if (content === null) return null
    const blob = new Blob([content], { type: 'application/javascript; charset=utf-8' })
    return { url: URL.createObjectURL(blob), ref: 0 }
  }

  async function acquireBlobUrl(src: string): Promise<BlobHandle | null> {
    let pending = cache.get(src)
    if (!pending) {
      pending = createEntry(src)
      cache.set(src, pending)
    }
    // A failed fetch or unchanged source uses the original classic-script loader.
    const entry = await pending.catch(() => null)
    if (!entry) {
      if (cache.get(src) === pending) cache.delete(src)
      return null
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

function installScriptRewriteInterceptor(): void {
  const acquireBlobUrl = createBlobCache()
  const { appendChild, insertBefore } = Element.prototype
  const pendingScripts = new WeakSet<HTMLScriptElement>()
  let orderedInsertion: Promise<void> | undefined

  function insertScript<T extends Node>(
    parent: Element,
    node: T,
    insert: (node: Node, before: Node | null) => Node,
    before: Node | null
  ): T {
    if (!(node instanceof HTMLScriptElement) || !node.src) {
      return insert.call(parent, node, before) as T
    }
    if (pendingScripts.has(node)) return node

    const src = node.src
    const rewritable = REWRITE_TARGET_REGEX.test(src)
    const ordered = !node.async
    const previous = ordered ? orderedInsertion : undefined
    if (!rewritable && !previous) return insert.call(parent, node, before) as T

    pendingScripts.add(node)
    const prepared = rewritable ? acquireBlobUrl(src) : null
    // Fetch in parallel while preserving insertion order for script.async = false.
    const pending = Promise.all([prepared, previous])
      .then(([blob]) => {
        if (node.src !== src) {
          blob?.release()
        } else if (blob) {
          node.removeAttribute('integrity')
          node.addEventListener('load', blob.release, { once: true })
          node.addEventListener('error', blob.release, { once: true })
          node.src = blob.url
        } else if (rewritable) {
          node.src = scriptFallbackUrl(src)
        }
        insert.call(parent, node, before)
      })
      .catch((error) => {
        logger.error('Failed to insert rewritten script:', error)
        node.dispatchEvent(new Event('error'))
      })
      .finally(() => {
        pendingScripts.delete(node)
        if (orderedInsertion === pending) orderedInsertion = undefined
      })
    if (ordered) orderedInsertion = pending
    return node
  }

  Element.prototype.appendChild = function <T extends Node>(this: Element, node: T): T {
    return insertScript(this, node, appendChild, null)
  }

  Element.prototype.insertBefore = function <T extends Node>(
    this: Element,
    node: T,
    before: Node | null
  ): T {
    return insertScript(this, node, insertBefore, before)
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
