import { logger } from '@/utils/log'

import { fetchScriptText, loadRewriteRuntime } from './loader'
import { replaceScript, withCurrentScript } from './runtime'
import { bundledRuntime } from './transform'

const SESSION_KEY = Symbol.for('tempad-dev.rewrite-session.v1')
const SOURCE_TIMEOUT_MS = 15000

type ScriptState = {
  completion: Promise<void>
  outcome: 'pending' | 'load' | 'error'
  blocked: boolean
  dispatching: boolean
}

export function createRewriteSession(remote: boolean) {
  // Pin one runtime, including a bundled fallback, for every script in this document.
  const runtime = loadRewriteRuntime({ remote })
  const sources = new Map<string, Promise<string>>()
  const blobs = new Map<string, { pending: Promise<string>; refs: number }>()
  const scripts = new WeakMap<HTMLScriptElement, ScriptState>()
  let ordered: Promise<void> = Promise.resolve()

  function dispatch(current: HTMLScriptElement, state: ScriptState): void {
    // Error handlers may synchronously dispatch another load event on this element.
    state.dispatching = true
    try {
      current.dispatchEvent(new Event(state.outcome))
    } finally {
      state.dispatching = false
    }
  }

  function onLoad(event: Event): void {
    if (!(event.target instanceof HTMLScriptElement)) return
    const state = scripts.get(event.target)
    if (!state || state.dispatching || state.outcome === 'load') return
    // The local loader finishing is not the chunk finishing. Rspack must see registration first.
    event.stopImmediatePropagation()
    state.blocked = true
    if (state.outcome === 'error') dispatch(event.target, state)
  }
  document.addEventListener('load', onLoad, true)

  function readSource(src: string): Promise<string> {
    const existing = sources.get(src)
    if (existing) return existing
    const pending = fetchScriptText(
      src,
      { credentials: 'include', cache: 'force-cache' },
      SOURCE_TIMEOUT_MS
    ).finally(() => sources.delete(src))
    sources.set(src, pending)
    return pending
  }

  async function prepare(src: string): Promise<{ content: string; run: () => void }> {
    // Fetch the original concurrently with the runtime to avoid a second serial network wait.
    const [original, selected] = await Promise.all([readSource(src), runtime])
    try {
      const content = selected.rewrite(original, src)
      if (typeof content !== 'string') throw new Error('Rewrite runtime returned invalid source.')
      return { content, run: new Function(content) as () => void }
    } catch (error) {
      logger.warn('Rewrite failed before execution; trying bundled/original source.', error)
      if (selected !== bundledRuntime) {
        try {
          const content = bundledRuntime.rewrite(original, src)
          return { content, run: new Function(content) as () => void }
        } catch (fallbackError) {
          logger.warn('Bundled rewrite failed before execution.', fallbackError)
        }
      }
      return { content: original, run: new Function(original) as () => void }
    }
  }

  function rewriteScript(current: HTMLScriptElement): Promise<void> {
    const existing = scripts.get(current)
    if (existing) return existing.completion
    const src = current.src
    const prepared = prepare(src).catch((error: unknown) => ({ error }))
    const state: ScriptState = {
      completion: Promise.resolve(),
      outcome: 'pending',
      blocked: false,
      dispatching: false
    }
    scripts.set(current, state)
    const execute = async () => {
      const result = await prepared
      try {
        if ('error' in result) {
          logger.warn('Unable to fetch source; loading original script.', result.error)
          await replaceScript(current, src)
        } else {
          withCurrentScript(current, result.run)
        }
        state.outcome = 'load'
      } catch (error) {
        state.outcome = 'error'
        // No fallback here: execution may already have registered modules or changed the page.
        logger.error('Rewritten script failed; it will not be executed again.', error)
      }
      if (state.blocked) dispatch(current, state)
    }
    state.completion = current.async ? execute() : ordered.then(execute)
    if (!current.async) ordered = state.completion
    return state.completion
  }

  async function acquireBlobUrl(src: string): Promise<{ url: string; release: () => void }> {
    let entry = blobs.get(src)
    if (!entry) {
      entry = {
        refs: 0,
        pending: prepare(src).then(({ content }) =>
          URL.createObjectURL(
            new Blob([content], { type: 'application/javascript; charset=utf-8' })
          )
        )
      }
      blobs.set(src, entry)
    }
    entry.refs += 1
    let url: string
    try {
      url = await entry.pending
    } catch (error) {
      if (blobs.get(src) === entry) blobs.delete(src)
      throw error
    }
    let released = false
    return {
      url,
      release() {
        if (released) return
        released = true
        entry.refs -= 1
        if (entry.refs === 0) {
          URL.revokeObjectURL(url)
          if (blobs.get(src) === entry) blobs.delete(src)
        }
      }
    }
  }

  const target = runtime.then(({ targetPattern }) => new RegExp(targetPattern, 'i'))
  return {
    rewriteScript,
    acquireBlobUrl,
    async shouldRewrite(src: string): Promise<boolean> {
      if (new URL(src).searchParams.has('tempad-fallback')) return false
      return (await target).test(src)
    },
    dispose() {
      document.removeEventListener('load', onLoad, true)
    }
  }
}

export type RewriteSession = ReturnType<typeof createRewriteSession>

export function getRewriteSession(remote: boolean): RewriteSession {
  const host = window as unknown as Record<symbol, RewriteSession | undefined>
  if (!host[SESSION_KEY]) {
    Object.defineProperty(host, SESSION_KEY, { value: createRewriteSession(remote) })
  }
  return host[SESSION_KEY]!
}
