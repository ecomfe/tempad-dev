import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type CodexServerQueueState = { hasMessages: boolean } | null

/** A missing database identifies an older store; an unreadable store is never empty. */
export async function readCodexServerQueue(conversationId: string): Promise<CodexServerQueueState> {
  const path = join(
    process.env.CODEX_SQLITE_HOME || process.env.CODEX_HOME || join(homedir(), '.codex'),
    'queue_1.sqlite'
  )
  try {
    try {
      await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    // Load lazily: older supported Node releases may not expose node:sqlite. Do not
    // create a database, copy it without its WAL, or bypass the host with SQL writes.
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(path, { readOnly: true })
    try {
      database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 250')
      const row = database
        .prepare('SELECT 1 AS queued FROM queued_items WHERE thread_id = ? LIMIT 1')
        .get(conversationId)
      return { hasMessages: row !== undefined }
    } finally {
      database.close()
    }
  } catch (error) {
    throw new Error('The Codex server queue could not be checked. Comments remain saved.', {
      cause: error
    })
  }
}
