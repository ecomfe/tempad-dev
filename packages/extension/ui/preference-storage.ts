/** Keep tab-local UI state while persisting only the fields this tab changed. */
export function createPreferenceStorage(storage: Storage) {
  let previous: Record<string, unknown> | undefined
  const read = (value: string | null): Record<string, unknown> | undefined => {
    try {
      const parsed: unknown = JSON.parse(value ?? 'null')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    } catch {
      // The next successful write replaces malformed preferences with the local snapshot.
    }
  }
  return {
    getItem(key: string) {
      // VueUse compares this with the next local value before calling setItem.
      // A remote tab's equal value must not skip acknowledging our own edit.
      if (previous) return JSON.stringify(previous)
      const value = storage.getItem(key)
      previous = read(value) ?? {}
      return value === null ? null : JSON.stringify(previous)
    },
    setItem(key: string, value: string) {
      const next = read(value) ?? {}
      const stored = storage.getItem(key)
      const merged = read(stored) ?? { ...next }
      for (const field of new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])) {
        if (JSON.stringify(previous?.[field]) === JSON.stringify(next[field])) continue
        if (Object.hasOwn(next, field)) merged[field] = next[field]
        else delete merged[field]
      }
      const serialized = JSON.stringify(merged)
      if (stored !== serialized) storage.setItem(key, serialized)
      previous = next
    },
    removeItem(key: string) {
      storage.removeItem(key)
      previous = undefined
    }
  }
}
