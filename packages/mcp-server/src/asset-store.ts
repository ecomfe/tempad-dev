import { existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { AssetRecord } from './types'

import { getHashFromAssetFilename } from './asset-utils'
import { ASSET_DIR, ensureDir, ensureFile, log } from './shared'

const INDEX_FILENAME = 'assets.json'
const DEFAULT_INDEX_PATH = join(ASSET_DIR, INDEX_FILENAME)

export interface AssetStoreOptions {
  indexPath?: string
}

export interface AssetStore {
  list(): AssetRecord[]
  has(hash: string): boolean
  get(hash: string): AssetRecord | undefined
  getMany(hashes: string[]): AssetRecord[]
  upsert(
    input: Omit<AssetRecord, 'uploadedAt' | 'lastAccess'> &
      Partial<Pick<AssetRecord, 'uploadedAt' | 'lastAccess'>>
  ): AssetRecord
  touch(hash: string): AssetRecord | undefined
  remove(hash: string, opts?: { removeFile?: boolean }): void
  reconcile(): void
  flush(): void
}

function readIndex(indexPath: string): AssetRecord[] {
  if (!existsSync(indexPath)) return []
  try {
    const raw = readFileSync(indexPath, 'utf8').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AssetRecord[]) : []
  } catch (error) {
    log.warn({ error, indexPath }, 'Failed to read asset catalog; starting fresh.')
    return []
  }
}

function writeIndex(indexPath: string, values: AssetRecord[]): void {
  const payload = JSON.stringify(values, null, 2)
  writeFileSync(indexPath, payload, 'utf8')
}

export function createAssetStore(options: AssetStoreOptions = {}): AssetStore {
  ensureDir(ASSET_DIR)
  const indexPath = options.indexPath ?? DEFAULT_INDEX_PATH
  ensureFile(indexPath)
  const records = new Map<string, AssetRecord>()
  let persistTimer: NodeJS.Timeout | null = null

  function loadExisting(): void {
    const list = readIndex(indexPath)
    for (const record of list) {
      if (record?.hash && record?.filePath) {
        records.set(record.hash, record)
      }
    }
  }

  function persist(): void {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      writeIndex(indexPath, [...records.values()])
    }, 5000)
    if (typeof persistTimer.unref === 'function') {
      persistTimer.unref()
    }
  }

  function flush(): void {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    writeIndex(indexPath, [...records.values()])
  }

  function list(): AssetRecord[] {
    return [...records.values()]
  }

  function has(hash: string): boolean {
    return records.has(hash)
  }

  function get(hash: string): AssetRecord | undefined {
    return records.get(hash)
  }

  function getMany(hashes: string[]): AssetRecord[] {
    return hashes
      .map((hash) => records.get(hash))
      .filter((record): record is AssetRecord => !!record)
  }

  function upsert(
    input: Omit<AssetRecord, 'uploadedAt' | 'lastAccess'> &
      Partial<Pick<AssetRecord, 'uploadedAt' | 'lastAccess'>>
  ): AssetRecord {
    const now = Date.now()
    const record: AssetRecord = {
      ...input,
      uploadedAt: input.uploadedAt ?? now,
      lastAccess: input.lastAccess ?? now
    }
    records.set(record.hash, record)
    persist()
    return record
  }

  function touch(hash: string): AssetRecord | undefined {
    const existing = records.get(hash)
    if (!existing) return undefined
    existing.lastAccess = Date.now()
    persist()
    return existing
  }

  function remove(hash: string, { removeFile = true } = {}): void {
    const record = records.get(hash)
    if (!record) return
    records.delete(hash)
    persist()

    if (removeFile) {
      try {
        rmSync(record.filePath, { force: true })
      } catch (error) {
        log.warn({ hash, error }, 'Failed to remove asset file on delete.')
      }
    }
  }

  function reconcile(): void {
    let changed = false
    for (const [hash, record] of records) {
      if (!existsSync(record.filePath)) {
        records.delete(hash)
        changed = true
      }
    }

    try {
      const files = readdirSync(ASSET_DIR)
      const now = Date.now()
      for (const file of files) {
        if (file === INDEX_FILENAME) continue

        // Cleanup stale tmp files (> 1 hour)
        if (file.includes('.tmp.')) {
          try {
            const filePath = join(ASSET_DIR, file)
            const stat = statSync(filePath)
            if (now - stat.mtimeMs > 3600 * 1000) {
              rmSync(filePath, { force: true })
              log.info({ file }, 'Cleaned up stale temp file.')
            }
          } catch (e) {
            // Ignore errors during cleanup
            log.debug({ error: e, file }, 'Failed to cleanup stale temp file.')
          }
          continue
        }

        const hash = getHashFromAssetFilename(file)
        if (!hash) continue

        if (!records.has(hash)) {
          const filePath = join(ASSET_DIR, file)
          try {
            const stat = statSync(filePath)
            records.set(hash, {
              hash,
              filePath,
              mimeType: 'application/octet-stream',
              size: stat.size,
              uploadedAt: stat.birthtimeMs,
              lastAccess: stat.atimeMs
            })
            changed = true
            log.info({ hash }, 'Recovered orphan asset file.')
          } catch (e) {
            log.warn({ error: e, file }, 'Failed to stat orphan file.')
          }
        }
      }
    } catch (error) {
      log.warn({ error }, 'Failed to scan asset directory for orphans.')
    }

    if (changed) flush()
  }

  loadExisting()
  reconcile()

  return {
    list,
    has,
    get,
    getMany,
    upsert,
    touch,
    remove,
    reconcile,
    flush
  }
}
