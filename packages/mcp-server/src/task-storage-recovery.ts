import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import lockfile from 'proper-lockfile'

import { DesignTaskStore } from './design-task-store'
import { HUB_LOCK_STALE_MS, HUB_LOCK_UPDATE_MS } from './shared'

/** Explicit offline recovery retires every unknown old task; it never reconstructs Stop history. */
export async function recoverDesignTaskStorage(directory: string): Promise<{
  generation: string
  backupDirectory: string
}> {
  const canonical = realpathSync(directory)
  const release = await lockfile.lock(canonical, {
    lockfilePath: join(canonical, '.tempad-hub-writer.lock'),
    retries: 0,
    stale: HUB_LOCK_STALE_MS,
    update: HUB_LOCK_UPDATE_MS
  })
  try {
    const path = join(canonical, 'design-tasks.json')
    const store = new DesignTaskStore(path)
    store.load()
    if (!store.recoveryError)
      throw new Error('Task storage is readable. No recovery was performed.')

    const generation = randomUUID()
    const backupDirectory = join(canonical, `design-tasks.recovery-${generation}`)
    mkdirSync(backupDirectory, { mode: 0o700 })
    for (const suffix of ['', '.corrupt', '.tmp']) {
      const source = `${path}${suffix}`
      if (existsSync(source))
        writeFileSync(join(backupDirectory, basename(source)), readFileSync(source), {
          flag: 'wx',
          mode: 0o600,
          flush: true
        })
    }

    // This marker is intentionally not a task record: older readers must block all writes.
    const snapshot = { revision: 0, current: {}, records: [{ recoveryGeneration: generation }] }
    const temporary = `${path}.recovery-${generation}.tmp`
    writeFileSync(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, path)
    return { generation, backupDirectory }
  } finally {
    await release()
  }
}
