import { lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const LOG_NAME = /^mcp-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-([1-9]\d*)\.log$/

/** Best-effort housekeeping: never remove a log a running process may still own. */
export function pruneExpiredLogs(directory: string, now = Date.now()): number {
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    const match = LOG_NAME.exec(name)
    if (!match) continue
    const pid = Number(match[1])
    if (!Number.isSafeInteger(pid) || pid > 2147483647 || pid === process.pid) continue
    try {
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (process.platform !== 'win32' && stat.uid !== process.getuid?.()) ||
        stat.mtimeMs > now - RETENTION_MS
      )
        continue
      try {
        process.kill(pid, 0)
        continue
      } catch (error) {
        // EPERM and platform-specific probe failures do not establish that a
        // process has exited. PID reuse deliberately favors keeping the log.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue
      }
      unlinkSync(path)
      removed++
    } catch {
      // Concurrent cleanup, antivirus and storage failures must not block MCP.
    }
  }
  return removed
}
