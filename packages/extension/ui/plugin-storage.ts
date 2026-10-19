export interface PluginData {
  name: string
  code: string
  integrity?: string
  resolvedUrl?: string
  source: string
}

export const PLUGIN_STORAGE_KEY = 'tempad-dev-plugins'
const PREFERENCE_STORAGE_KEY = 'tempad-dev'

type PluginRecord = Record<string, PluginData>

export class CorruptPluginStorageError extends Error {
  constructor() {
    super('Stored plugin data is invalid.')
  }
}

function parseRecord(value: string | null): Record<string, unknown> {
  if (value === null) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  } catch {
    // Preserve the invalid record until the user explicitly resets it.
  }
  throw new CorruptPluginStorageError()
}

export function createPluginStorage(storage: Storage, locks: LockManager) {
  function removeLegacyBackup() {
    try {
      const preferences = parseRecord(storage.getItem(PREFERENCE_STORAGE_KEY))
      if (!Object.hasOwn(preferences, 'plugins')) return
      delete preferences.plugins
      storage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // The canonical record is already durable. Retaining its backup is safe;
      // a failed cleanup must not report the committed plugin edit as failed.
    }
  }

  function read() {
    const stored = storage.getItem(PLUGIN_STORAGE_KEY)
    if (stored !== null) return { plugins: parseRecord(stored) as PluginRecord, legacy: false }
    const preferences = parseRecord(storage.getItem(PREFERENCE_STORAGE_KEY))
    const legacy = preferences.plugins
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      return { plugins: legacy as PluginRecord, legacy: true }
    }
    return { plugins: {} as PluginRecord, legacy: false }
  }

  async function migrate() {
    return locks.request(PLUGIN_STORAGE_KEY, () => {
      const current = read()
      if (current.legacy) storage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(current.plugins))
      if (storage.getItem(PLUGIN_STORAGE_KEY) !== null) removeLegacyBackup()
    })
  }

  async function save(source: string, plugin: PluginData | null) {
    // A fresh read alone is not atomic across renderer processes. Serialize the
    // complete mutation, including legacy migration, with the origin's Web Lock.
    return locks.request(PLUGIN_STORAGE_KEY, () => {
      const current = read()
      const next = { ...current.plugins }
      if (plugin) next[source] = plugin
      else delete next[source]
      try {
        storage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(next))
      } catch (error) {
        if (plugin || !current.legacy) throw error
        // A shrinking legacy record can free quota without duplicating its code.
        const preferences = parseRecord(storage.getItem(PREFERENCE_STORAGE_KEY))
        storage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify({ ...preferences, plugins: next }))
        return
      }
      removeLegacyBackup()
    })
  }

  async function resetCorruptRecord() {
    return locks.request(PLUGIN_STORAGE_KEY, () => {
      try {
        read()
        // Another tab may have recovered the record while this action was queued.
        return false
      } catch (error) {
        if (!(error instanceof CorruptPluginStorageError)) throw error
      }
      storage.setItem(PLUGIN_STORAGE_KEY, '{}')
      removeLegacyBackup()
      return true
    })
  }

  return { read, migrate, save, resetCorruptRecord }
}
