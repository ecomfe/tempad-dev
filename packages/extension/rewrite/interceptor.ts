import { logger } from '@/utils/log'

import type { RewriteSession } from './session'

import { fallbackUrl } from './runtime'

export function installScriptRewriteInterceptor(session: RewriteSession): () => void {
  const { appendChild, insertBefore } = Element.prototype
  const processed = new WeakSet<HTMLScriptElement>()
  let ordered: Promise<void> = Promise.resolve()

  function intercept(parent: Element, node: Node, before: Node | null): boolean {
    if (
      !(node instanceof HTMLScriptElement) ||
      !node.src ||
      node.noModule ||
      (node.type && !/^(?:text|application)\/javascript$/i.test(node.type)) ||
      new URL(node.src).origin !== location.origin ||
      new URL(node.src).searchParams.has('tempad-fallback') ||
      processed.has(node)
    )
      return false

    const originalType = node.getAttribute('type')
    // Rspack can still find, deduplicate and remove this element while rewriting is pending.
    node.type = 'application/x-tempad-rewrite'
    try {
      insertBefore.call(parent, node, before)
    } catch (error) {
      restoreType()
      throw error
    }
    processed.add(node)
    const src = node.src
    const prepared = (async () => {
      if (!(await session.shouldRewrite(src))) return null
      return await session.acquireBlobUrl(src)
    })().catch((error: unknown) => {
      logger.warn('Unable to rewrite async script; loading original.', error)
      node.src = fallbackUrl(src)
      return null
    })
    const run = async () => {
      const blob = await prepared
      // Rspack removes timed-out requests. Do not execute a chunk after it was cancelled.
      if (!node.isConnected) {
        blob?.release()
        return
      }
      const owner = node.parentNode!
      const next = node.nextSibling
      node.remove()
      if (blob) {
        node.removeAttribute('integrity')
        node.src = blob.url
        node.addEventListener('load', blob.release, { once: true })
        node.addEventListener('error', blob.release, { once: true })
      }
      restoreType()
      try {
        // Keep native classic-script execution, scope and load/error events for JSONP chunks.
        insertBefore.call(owner, node, next)
      } catch (error) {
        blob?.release()
        throw error
      }
    }
    const done = node.async ? run() : ordered.then(run)
    if (!node.async) ordered = done.catch(() => {})
    void done.catch(() => node.dispatchEvent(new Event('error')))
    return true

    function restoreType() {
      const script = node as HTMLScriptElement
      if (originalType === null) script.removeAttribute('type')
      else script.setAttribute('type', originalType)
    }
  }

  Element.prototype.appendChild = function <T extends Node>(this: Element, node: T): T {
    if (!intercept(this, node, null)) appendChild.call(this, node)
    return node
  }
  Element.prototype.insertBefore = function <T extends Node>(
    this: Element,
    node: T,
    before: Node | null
  ): T {
    if (!intercept(this, node, before)) insertBefore.call(this, node, before)
    return node
  }
  return () => {
    Element.prototype.appendChild = appendChild
    Element.prototype.insertBefore = insertBefore
  }
}
