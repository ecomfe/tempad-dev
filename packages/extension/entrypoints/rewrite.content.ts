import rules from '@/public/rules/figma.json'
import { GROUPS } from '@/rewrite/config'
import { applyGroups, RULES_URL, REWRITE_RULE_ID } from '@/rewrite/shared'
import { logger } from '@/utils/log'

import type { BlobHandle, CacheEntry, Rules } from '../types/rewrite'

export default defineContentScript({
  matches: ['https://www.figma.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    function extractRegexFilter(source: Rules): RegExp | null {
      try {
        const rule = source.find((r) => r.id === REWRITE_RULE_ID)
        return rule?.condition?.regexFilter ? new RegExp(rule.condition.regexFilter, 'i') : null
      } catch {
        return null
      }
    }

    async function loadRemoteRegex(url: string): Promise<RegExp | null> {
      try {
        const resp = await fetch(url, { credentials: 'omit', cache: 'no-cache' })
        if (!resp.ok) {
          return null
        }
        return extractRegexFilter(await resp.json())
      } catch {
        return null
      }
    }
    let targetRegex: RegExp | null = extractRegexFilter(rules as Rules)

    loadRemoteRegex(RULES_URL).then((remoteRegex) => {
      if (remoteRegex) {
        targetRegex = remoteRegex
        logger.log('Loaded remote rewrite rules.')
      } else {
        logger.warn('Failed to fetch rewrite rules; using bundled rules.')
      }
    })

    const { appendChild, insertBefore } = Element.prototype

    const processedScripts = new WeakSet<HTMLScriptElement>()

    const blobCache = new Map<string, CacheEntry>()

    function shouldRewrite(url: string): boolean {
      return !!targetRegex && targetRegex.test(url)
    }

    function isRewritableScript(node: Node): node is HTMLScriptElement {
      return (
        node instanceof HTMLScriptElement && typeof node.src === 'string' && node.src.length > 0
      )
    }

    function releaseBlobUrl(src: string, usedUrl: string): void {
      const entry = blobCache.get(src)
      if (!entry || entry.url !== usedUrl) return
      entry.ref -= 1
      if (entry.ref <= 0) {
        try {
          URL.revokeObjectURL(entry.url)
        } catch {
          // noop
        }
        blobCache.delete(src)
      }
    }

    async function acquireBlobUrl(src: string): Promise<BlobHandle> {
      const existing = blobCache.get(src)
      if (existing) {
        existing.ref += 1
        return { url: existing.url, release: () => releaseBlobUrl(src, existing.url) }
      }

      const resp = await fetch(src, { credentials: 'include', cache: 'force-cache' })
      const originalText = await resp.text()
      const { content, changed } = applyGroups(originalText, GROUPS)

      if (changed) {
        logger.log(`Rewrote async script: ${src}`)
      }

      const blob = new Blob([content], { type: 'application/javascript; charset=utf-8' })
      const url = URL.createObjectURL(blob)
      blobCache.set(src, { url, ref: 1 })
      return { url, release: () => releaseBlobUrl(src, url) }
    }

    function normalizedInsert(parent: Element, node: Node, before: Node | null): void {
      if (before) insertBefore.call(parent, node, before)
      else appendChild.call(parent, node)
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

      if (!shouldRewrite(script.src)) {
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

    const newAppendChild: typeof Element.prototype.appendChild = function <T extends Node>(
      this: Element,
      node: T
    ): T {
      if (isRewritableScript(node)) {
        void rewriteAndInsert(this, node, null)
        return node
      }
      appendChild.call(this, node)
      return node
    }

    const newInsertBefore: typeof Element.prototype.insertBefore = function <T extends Node>(
      this: Element,
      node: T,
      before: Node | null
    ): T {
      if (isRewritableScript(node)) {
        void rewriteAndInsert(this, node, before)
        return node
      }
      insertBefore.call(this, node, before)
      return node
    }

    Element.prototype.appendChild = newAppendChild
    Element.prototype.insertBefore = newInsertBefore
  }
})
