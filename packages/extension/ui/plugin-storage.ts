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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseRecord(value: string | null): Record<string, unknown> {
  if (value === null) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed)) return parsed
  } catch {
    // Preserve the invalid record until the user explicitly resets it.
  }
  throw new CorruptPluginStorageError()
}

function readPlugins(value: unknown): PluginRecord {
  if (
    !isRecord(value) ||
    Object.entries(value).some(
      ([source, plugin]) =>
        !isRecord(plugin) ||
        plugin.source !== source ||
        typeof plugin.name !== 'string' ||
        typeof plugin.code !== 'string' ||
        (plugin.integrity !== undefined && typeof plugin.integrity !== 'string') ||
        (plugin.resolvedUrl !== undefined && typeof plugin.resolvedUrl !== 'string')
    )
  )
    throw new CorruptPluginStorageError()
  return value as PluginRecord
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
    if (stored !== null) return { plugins: readPlugins(parseRecord(stored)), legacy: false }
    const preferences = parseRecord(storage.getItem(PREFERENCE_STORAGE_KEY))
    if (Object.hasOwn(preferences, 'plugins')) {
      return { plugins: readPlugins(preferences.plugins), legacy: true }
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
