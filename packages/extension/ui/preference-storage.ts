/** Keep tab-local UI state while persisting only the fields this tab changed. */
export function createPreferenceStorage(storage: Storage) {
  let previous: Record<string, unknown> | undefined
  const read = (value: string | null): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(value ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  }
  return {
    getItem(key: string) {
      const value = storage.getItem(key)
      previous ??= read(value)
      return value
    },
    setItem(key: string, value: string) {
      const next = read(value)
      const stored = storage.getItem(key)
      const merged = stored === null ? { ...next } : read(stored)
      for (const field of new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])) {
        if (JSON.stringify(previous?.[field]) === JSON.stringify(next[field])) continue
        if (Object.hasOwn(next, field)) merged[field] = next[field]
        else delete merged[field]
      }
      storage.setItem(key, JSON.stringify(merged))
      previous = next
    },
    removeItem(key: string) {
      storage.removeItem(key)
      previous = undefined
    }
  }
}
