import { PLUGIN_STORAGE_KEY } from './plugin-storage'

/** Keep tab-local UI state while persisting only the fields this tab changed. */
export function createPreferenceStorage(
  storage: Storage,
  locks: LockManager,
  defaults: Record<string, unknown>,
  onError: (error: unknown) => void = console.error
) {
  // VueUse may reuse and mutate the supplied defaults when no saved record exists.
  const initial = JSON.stringify(defaults)
  let previous: Record<string, unknown> | undefined
  let queued: { value: string | null } | undefined
  const read = (value: string | null): Record<string, unknown> | undefined => {
    try {
      const parsed: unknown = JSON.parse(value ?? 'null')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    } catch {
      // The next successful write replaces malformed preferences with the local snapshot.
    }
  }
  function mutate(value: string | null, action: () => void) {
    const pending = { value }
    queued = pending
    return locks
      .request(PLUGIN_STORAGE_KEY, action)
      .catch(onError)
      .finally(() => {
        if (queued === pending) queued = undefined
      })
  }
  return {
    getItem(key: string) {
      // VueUse must see the latest queued edit, including a local reversal while
      // the lock is held. `previous` advances only after a durable write.
      if (queued) return queued.value
      // VueUse compares this with the next local value before calling setItem.
      // A remote tab's equal value must not skip acknowledging our own edit.
      if (previous) return JSON.stringify(previous)
      const value = storage.getItem(key)
      // Missing defaults belong to the baseline, not this tab's first edit.
      previous = { ...read(initial), ...read(value) }
      return value === null ? null : JSON.stringify(previous)
    },
    setItem(key: string, value: string) {
      return mutate(value, () => {
        const next = read(value) ?? {}
        const stored = storage.getItem(key)
        const persisted = read(stored)
        const merged = persisted ?? { ...next }
        if (!persisted) delete merged.plugins
        for (const field of new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])) {
          // Legacy plugin records have their own locked writer. A preference
          // watcher must never restore its tab's stale copy after a plugin edit.
          if (field === 'plugins') continue
          if (JSON.stringify(previous?.[field]) === JSON.stringify(next[field])) continue
          if (Object.hasOwn(next, field)) merged[field] = next[field]
          else delete merged[field]
        }
        const serialized = JSON.stringify(merged)
        if (stored !== serialized) storage.setItem(key, serialized)
        previous = next
      })
    },
    removeItem(key: string) {
      return mutate(null, () => {
        storage.removeItem(key)
        previous = undefined
      })
    }
  }
}
