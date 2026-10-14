import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pruneExpiredLogs } from '../src/log-retention'

vi.mock('node:fs', async (load) => {
  const actual = await load<typeof import('node:fs')>()
  return {
    ...actual,
    unlinkSync: vi.fn(actual.unlinkSync),
    readdirSync: vi.fn(actual.readdirSync),
    lstatSync: vi.fn(actual.lstatSync)
  }
})

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 13)
let directory: string

function logFile(pid: number, ageDays = 7): string {
  const path = join(directory, `mcp-2026-10-01T00-00-00-000Z-${pid}.log`)
  fs.writeFileSync(path, 'retained diagnostic evidence')
  fs.utimesSync(path, new Date(now - ageDays * DAY), new Date(now - ageDays * DAY))
  return path
}

beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'tempad-log-retention-'))
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('Process exited'), { code: 'ESRCH' })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('expired process logs', () => {
  it('removes only exited-process logs at the seven-day last-write boundary', () => {
    const expired = logFile(101)
    const recent = logFile(102, 7 - 1 / DAY)
    const current = logFile(process.pid, 100)
    expect(pruneExpiredLogs(directory, now)).toBe(1)
    expect(fs.existsSync(expired)).toBe(false)
    expect(fs.readFileSync(recent, 'utf8')).toBe('retained diagnostic evidence')
    expect(fs.existsSync(current)).toBe(true)
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(101, 0)
  })

  it('keeps live or unprobeable processes even when their log timestamp is old', () => {
    const live = logFile(101, 30)
    const inaccessible = logFile(102, 30)
    vi.mocked(process.kill).mockImplementation((pid) => {
      if (pid === 101) return true
      throw Object.assign(new Error('Not permitted'), { code: 'EPERM' })
    })
    expect(pruneExpiredLogs(directory, now)).toBe(0)
    expect(fs.existsSync(live)).toBe(true)
    expect(fs.existsSync(inaccessible)).toBe(true)
  })

  it('ignores unknown files, invalid PIDs and directories', () => {
    for (const name of [
      'notes.log',
      'mcp-old-101.log',
      'mcp-2026-10-01T00-00-00-000Z-9999999999999999.log'
    ])
      fs.writeFileSync(join(directory, name), 'keep')
    fs.mkdirSync(join(directory, 'mcp-2026-10-01T00-00-00-000Z-101.log'))
    expect(pruneExpiredLogs(directory, now)).toBe(0)
    expect(fs.readdirSync(directory)).toHaveLength(4)
    expect(process.kill).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('never follows or removes a matching symlink', () => {
    const target = join(directory, 'external.log')
    fs.writeFileSync(target, 'keep')
    const link = join(directory, 'mcp-2026-10-01T00-00-00-000Z-101.log')
    fs.symlinkSync(target, link)
    expect(pruneExpiredLogs(directory, now)).toBe(0)
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('keep')
    expect(process.kill).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('keeps logs owned by another user', () => {
    const path = logFile(101)
    const stat = fs.lstatSync(path)
    stat.uid++
    vi.mocked(fs.lstatSync).mockReturnValueOnce(stat)
    expect(pruneExpiredLogs(directory, now)).toBe(0)
    expect(fs.existsSync(path)).toBe(true)
    expect(process.kill).not.toHaveBeenCalled()
  })

  it('continues after an unlink failure and tolerates an unavailable directory', () => {
    const blocked = logFile(101)
    const removable = logFile(102)
    const unlink = vi.mocked(fs.unlinkSync).getMockImplementation()!
    vi.mocked(fs.unlinkSync).mockImplementation((path) => {
      if (path === blocked) throw Object.assign(new Error('Busy'), { code: 'EBUSY' })
      unlink(path)
    })
    expect(pruneExpiredLogs(directory, now)).toBe(1)
    expect(fs.existsSync(blocked)).toBe(true)
    expect(fs.existsSync(removable)).toBe(false)
    expect(pruneExpiredLogs(join(directory, 'missing'), now)).toBe(0)
  })
})
