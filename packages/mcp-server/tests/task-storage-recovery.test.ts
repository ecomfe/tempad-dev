import type * as Fs from 'node:fs'

import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const faults = vi.hoisted(() => ({ write: '', replace: false }))
vi.mock('node:fs', async (load) => {
  const fs = await load<typeof Fs>()
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof Fs.writeFileSync>) => {
      const path = String(args[0])
      if (
        faults.write &&
        (faults.write === 'backup'
          ? path.includes('design-tasks.recovery-')
          : path.includes('.json.recovery-'))
      )
        throw new Error('Simulated write failure')
      return fs.writeFileSync(...args)
    },
    renameSync: (...args: Parameters<typeof Fs.renameSync>) => {
      if (faults.replace && String(args[0]).includes('.json.recovery-'))
        throw new Error('Simulated replacement failure')
      return fs.renameSync(...args)
    }
  }
})

import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'

import { DesignTaskStore } from '../src/design-task-store'
import { DesignTasks } from '../src/design-tasks'
import { recoverDesignTaskStorage } from '../src/task-storage-recovery'

afterEach(() => {
  faults.write = ''
  faults.replace = false
})

function fixture() {
  // The package setup points this parent at its disposable per-worker runtime.
  const directory = mkdtempSync(join(process.env.TEMPAD_MCP_RUNTIME_DIR!, 'recovery-'))
  const path = join(directory, 'design-tasks.json')
  writeFileSync(path, '{unknown Stop history')
  writeFileSync(`${path}.corrupt`, '{earlier unknown Stop history')
  writeFileSync(`${path}.tmp`, 'unverified older snapshot')
  return { directory, path }
}

describe('explicit offline task storage recovery', () => {
  it('preserves all original bytes and atomically installs a durable generation', async () => {
    const { directory, path } = fixture()
    const result = await recoverDesignTaskStorage(directory)
    expect(readFileSync(join(result.backupDirectory, 'design-tasks.json'), 'utf8')).toBe(
      '{unknown Stop history'
    )
    expect(readFileSync(join(result.backupDirectory, 'design-tasks.json.corrupt'), 'utf8')).toBe(
      '{earlier unknown Stop history'
    )
    expect(readFileSync(join(result.backupDirectory, 'design-tasks.json.tmp'), 'utf8')).toBe(
      'unverified older snapshot'
    )
    expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe('{earlier unknown Stop history')
    if (process.platform !== 'win32') {
      expect(statSync(result.backupDirectory).mode & 0o777).toBe(0o700)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    const store = new DesignTaskStore(path)
    const snapshot = store.load()!
    expect(snapshot).toEqual({
      revision: 0,
      current: {},
      records: [],
      recoveryGeneration: result.generation
    })
    store.save(snapshot)
    expect(new DesignTaskStore(path).load()).toEqual(snapshot)
    expect(JSON.parse(readFileSync(path, 'utf8')).records).toEqual([
      { recoveryGeneration: result.generation }
    ])
    // Freeze the pre-recovery reader's file-isolation fallback (c1bfaf9e).
    // A record with no identifiable file globally fences that reader, not just one file.
    const oldFileFence = z.object({
      task: z.object({ target: z.object({ fileKey: z.string().min(1) }) })
    })
    expect(oldFileFence.safeParse(JSON.parse(readFileSync(path, 'utf8')).records[0]).success).toBe(
      false
    )

    const tasks = new DesignTasks({ store, createId: () => 'fresh-task', now: () => 1000 })
    tasks.restore()
    const target = {
      fileKey: 'unknown',
      fileName: 'Unknown',
      sessionId: 'session',
      pageId: 'page',
      busy: false
    }
    expect(() => tasks.checkOperation('owner', target, undefined, true)).toThrow('new task')
    expect(() => tasks.begin('owner', 'extension', target, 'Fresh', 'request')).toThrow(
      result.generation
    )
    const record = tasks.begin(
      'owner',
      'extension',
      target,
      'Fresh',
      'request',
      undefined,
      undefined,
      undefined,
      result.generation
    )
    tasks.stop(record.task.taskId, 'cancelled')
    const restarted = new DesignTasks({
      store: new DesignTaskStore(path),
      createId: () => 'unused',
      now: () => 1000
    })
    restarted.restore()
    expect(restarted.find(record.task.taskId)?.task.status).toBe('cancelled')
    expect(() =>
      restarted.checkOperation('owner', { ...target, fileKey: 'other-unknown' }, undefined, true)
    ).toThrow('new task')
    await expect(recoverDesignTaskStorage(directory)).rejects.toThrow('readable')
    expect(
      readdirSync(directory).filter((name) => name.startsWith('design-tasks.recovery-'))
    ).toHaveLength(1)
  })

  it('cannot run while another Hub or recovery owns the state writer lock', async () => {
    const { directory, path } = fixture()
    const release = await lockfile.lock(directory, {
      lockfilePath: join(directory, '.tempad-hub-writer.lock'),
      retries: 0
    })
    try {
      await expect(recoverDesignTaskStorage(directory)).rejects.toMatchObject({ code: 'ELOCKED' })
      expect(readFileSync(path, 'utf8')).toBe('{unknown Stop history')
      expect(readdirSync(directory).some((name) => name.startsWith('design-tasks.recovery-'))).toBe(
        false
      )
    } finally {
      await release()
    }
    await expect(recoverDesignTaskStorage(directory)).resolves.toHaveProperty('generation')
  })

  it.each(['backup', 'temporary', 'replace'] as const)(
    'keeps the recovery fence on %s failure',
    async (stage) => {
      const { directory, path } = fixture()
      if (stage === 'replace') faults.replace = true
      else faults.write = stage
      await expect(recoverDesignTaskStorage(directory)).rejects.toThrow('Simulated')
      expect(readFileSync(path, 'utf8')).toBe('{unknown Stop history')
      expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe('{earlier unknown Stop history')
      const failed = new DesignTaskStore(path)
      expect(failed.load()).toBeUndefined()
      expect(failed.recoveryError).toContain('Stop fences')
      faults.write = ''
      faults.replace = false
      await expect(recoverDesignTaskStorage(directory)).resolves.toHaveProperty('generation')
    }
  )

  it('retires the preceding generation when a recovered snapshot is damaged again', async () => {
    const { directory, path } = fixture()
    const first = await recoverDesignTaskStorage(directory)
    writeFileSync(path, '{damaged new generation')
    const second = await recoverDesignTaskStorage(directory)
    expect(second.generation).not.toBe(first.generation)
    expect(readFileSync(join(first.backupDirectory, 'design-tasks.json'), 'utf8')).toBe(
      '{unknown Stop history'
    )
    expect(readFileSync(join(second.backupDirectory, 'design-tasks.json'), 'utf8')).toBe(
      '{damaged new generation'
    )
    expect(new DesignTaskStore(path).load()?.recoveryGeneration).toBe(second.generation)
  })

  it.each([
    {
      records: [{ recoveryGeneration: 'not-a-uuid', task: { target: { fileKey: 'misleading' } } }]
    },
    {
      records: [
        { recoveryGeneration: '00000000-0000-4000-8000-000000000001' },
        { recoveryGeneration: '00000000-0000-4000-8000-000000000002' }
      ]
    }
  ])('fails closed for malformed or ambiguous recovery markers', ({ records }) => {
    const { path } = fixture()
    writeFileSync(path, JSON.stringify({ revision: 0, current: {}, records }))
    const store = new DesignTaskStore(path)
    expect(store.load()).toBeUndefined()
    expect(store.recoveryError).toContain('Stop fences')
  })
})
