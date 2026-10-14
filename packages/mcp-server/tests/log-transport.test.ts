import { closeSync, mkdtempSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { afterEach, expect, it, vi } from 'vitest'

import logTransport from '../src/log-transport'

vi.mock('node:fs', async (load) => {
  const actual = await load<typeof import('node:fs')>()
  return { ...actual, closeSync: vi.fn(actual.closeSync), writeSync: vi.fn(actual.writeSync) }
})

afterEach(() => vi.resetAllMocks())

it('formats a record and finishes only after the destination has closed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tempad-pretty-log-'))
  const path = join(directory, 'formatted.log')
  try {
    const stream = logTransport({ destination: path, translateTime: 'SYS:HH:MM:ss' })
    stream.end(
      `${JSON.stringify({ level: 30, time: 0, msg: 'Final message', detail: '中文 🐈' })}\n`
    )
    await finished(stream)
    expect(stream.closed).toBe(true)
    expect(closeSync).toHaveBeenCalledOnce()
    const text = readFileSync(path, 'utf8')
    expect(text).toMatch(/INFO: Final message\n/)
    expect(text).toContain('detail: "中文 🐈"')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each(['write', 'end'] as const)(
  'propagates a destination %s failure through pretty and closes its fd',
  async (operation) => {
    const directory = mkdtempSync(join(tmpdir(), 'tempad-pretty-log-error-'))
    const path = join(directory, 'failed.log')
    try {
      const error = Object.assign(new Error('Disk full'), { code: 'ENOSPC' })
      vi.mocked(writeSync).mockImplementation(() => {
        throw error
      })
      const stream = logTransport({ destination: path, translateTime: 'SYS:HH:MM:ss' })
      const closed = finished(stream)
      const errors: Error[] = []
      stream.on('error', (failure) => errors.push(failure))
      stream[operation](`${JSON.stringify({ level: 30, time: 0, msg: 'Cannot write' })}\n`)
      await expect(closed).rejects.toBe(error)
      expect(stream.closed).toBe(true)
      expect(errors).toEqual([error])
      expect(closeSync).toHaveBeenCalledOnce()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
