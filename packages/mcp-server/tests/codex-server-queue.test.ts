import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readCodexServerQueue } from '../src/agent-clients/codex-server-queue'

let directory: string
let database: DatabaseSync | undefined
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tempad-server-queue-'))
  vi.stubEnv('CODEX_HOME', directory)
})
afterEach(async () => {
  database?.close()
  database = undefined
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

function createDatabase() {
  database = new DatabaseSync(join(directory, 'queue_1.sqlite'))
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE queued_items (id TEXT PRIMARY KEY, thread_id TEXT, payload_json TEXT);
  `)
  return database
}

describe('Codex server queue observation', () => {
  it('distinguishes an absent database without creating one', async () => {
    expect(await readCodexServerQueue('thread-a')).toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('preserves inspection errors instead of treating an invalid home as an absent database', async () => {
    const path = join(directory, 'not-a-directory')
    await writeFile(path, 'preserved')
    vi.stubEnv('CODEX_HOME', path)
    await expect(readCodexServerQueue('thread-a')).rejects.toMatchObject({
      message: 'The Codex server queue could not be checked. Comments remain saved.',
      cause: { code: 'ENOTDIR' }
    })
    expect(await readFile(path, 'utf8')).toBe('preserved')
  })

  it('reads committed WAL changes for only the requested conversation and observes consumption', async () => {
    const writer = createDatabase()
    writer.prepare('INSERT INTO queued_items VALUES (?, ?, ?)').run('one', 'thread-a', '{}')
    expect(await readCodexServerQueue('thread-a')).toEqual({ hasMessages: true })
    expect(await readCodexServerQueue('thread-b')).toEqual({ hasMessages: false })
    expect(writer.prepare('SELECT count(*) AS count FROM queued_items').get()).toMatchObject({
      count: 1
    })
    writer.prepare('DELETE FROM queued_items WHERE thread_id = ?').run('thread-a')
    expect(await readCodexServerQueue('thread-a')).toEqual({ hasMessages: false })
  })

  it('does not observe an uncommitted admission', async () => {
    const writer = createDatabase()
    writer.exec('BEGIN IMMEDIATE')
    writer.prepare('INSERT INTO queued_items VALUES (?, ?, ?)').run('one', 'thread-a', '{}')
    expect(await readCodexServerQueue('thread-a')).toEqual({ hasMessages: false })
    writer.exec('COMMIT')
    expect(await readCodexServerQueue('thread-a')).toEqual({ hasMessages: true })
  })

  it('honors the native SQLite directory override', async () => {
    createDatabase()
      .prepare('INSERT INTO queued_items VALUES (?, ?, ?)')
      .run('one', 'thread-a', '{}')
    vi.stubEnv('CODEX_SQLITE_HOME', directory)
    vi.stubEnv('CODEX_HOME', join(directory, 'unused-home'))
    expect(await readCodexServerQueue('thread-a')).toEqual({ hasMessages: true })
  })

  it('does not treat an unknown schema as an empty queue or create a replacement table', async () => {
    database = new DatabaseSync(join(directory, 'queue_1.sqlite'))
    database.exec('CREATE TABLE future_queue (id TEXT)')
    await expect(readCodexServerQueue('thread-a')).rejects.toThrow('could not be checked')
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([
      { name: 'future_queue' }
    ])
  })

  it('preserves an unreadable database and reports unknown state', async () => {
    const path = join(directory, 'queue_1.sqlite')
    await writeFile(path, 'invalid database')
    await expect(readCodexServerQueue('thread-a')).rejects.toThrow('could not be checked')
    expect(await readFile(path, 'utf8')).toBe('invalid database')
  })
})
