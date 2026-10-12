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
  const cache = new Map<string, CacheEntry>()

  function releaseBlobUrl(src: string, usedUrl: string): void {
    const entry = cache.get(src)
    if (!entry || entry.url !== usedUrl) {
      return
    }

    entry.ref -= 1
    if (entry.ref > 0) {
      return
    }

    try {
      URL.revokeObjectURL(entry.url)
    } catch {
      // noop
    }

    cache.delete(src)
  }

  async function acquireBlobUrl(src: string): Promise<BlobHandle> {
    const existing = cache.get(src)
    if (existing) {
      existing.ref += 1
      return { url: existing.url, release: () => releaseBlobUrl(src, existing.url) }
    }

    const response = await fetch(src, { credentials: 'include', cache: 'force-cache' })
    const originalText = await response.text()
    const { content, changed } = applyGroups(originalText, GROUPS)

    if (changed) {
      logger.log(`Rewrote async script: ${src}`)
    }

    const blob = new Blob([content], { type: 'application/javascript; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    cache.set(src, { url, ref: 1 })
    return { url, release: () => releaseBlobUrl(src, url) }
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
      rewriteAndInsert(this, node, null)
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
      rewriteAndInsert(this, node, before)
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
