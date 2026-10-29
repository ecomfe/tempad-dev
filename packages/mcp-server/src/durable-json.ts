import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The caller owns the directory's writer lock. Never restore an old snapshot. */
export function writeDurableJson(path: string, value: unknown): void {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flush: true })
  renameSync(temporary, path)
  if (process.platform === 'win32') return
  const directory = openSync(dirname(path), 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}
