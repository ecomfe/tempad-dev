import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogDestination, MAX_LOG_BYTES } from '../src/log-destination'

const realFs = await vi.importActual<typeof fs>('node:fs')
vi.mock('node:fs', async (load) => {
  const actual = await load<typeof fs>()
  return {
    ...actual,
    writeSync: vi.fn(actual.writeSync),
    closeSync: vi.fn(actual.closeSync),
    fstatSync: vi.fn(actual.fstatSync),
    ftruncateSync: vi.fn(actual.ftruncateSync)
  }
})

let directory: string
let path: string

beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'tempad-bounded-log-'))
  path = join(directory, 'process.log')
})

afterEach(() => {
  vi.resetAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('bounded worker log destination', () => {
  it('preserves ordinary formatted logs and closes its descriptor exactly once', async () => {
    const stream = createLogDestination(path)
    const line = '[12:34:56] INFO: 中文 🐈\n    detail: "kept"\n'
    stream.write(line)
    stream.end('Last line\n')
    await finished(stream)
    stream.destroy()
    expect(fs.readFileSync(path, 'utf8')).toBe(`${line}Last line\n`)
    expect(fs.closeSync).toHaveBeenCalledOnce()
    expect(fs.ftruncateSync).not.toHaveBeenCalled()
  })

  it('keeps an exact-limit file until the next record and rolls over repeatedly', async () => {
    const stream = createLogDestination(path)
    const full = 'x'.repeat(MAX_LOG_BYTES)
    stream.write(full)
    expect(fs.statSync(path).size).toBe(MAX_LOG_BYTES)
    expect(fs.ftruncateSync).not.toHaveBeenCalled()
    stream.write('Second record\n')
    expect(fs.readFileSync(path, 'utf8')).toMatch(/older entries discarded\.\nSecond record\n$/)
    stream.write(full)
    stream.end('Newest record\n')
    await finished(stream)
    const result = fs.readFileSync(path, 'utf8')
    expect(result).toMatch(/Log rolled over at 10 MiB.*\nNewest record\n$/)
    expect(result).not.toContain('Second record')
    expect(fs.statSync(path).size).toBeLessThanOrEqual(MAX_LOG_BYTES)
    expect(fs.ftruncateSync).toHaveBeenCalledTimes(3)
  })

  it.each(['中', '🐈'])(
    'truncates an oversized %s record at a complete UTF-8 boundary',
    async (text) => {
      const stream = createLogDestination(path)
      stream.end(`Prefix:${text.repeat(MAX_LOG_BYTES)}`)
      await finished(stream)
      const bytes = fs.readFileSync(path)
      const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      expect(bytes.length).toBeLessThanOrEqual(MAX_LOG_BYTES)
      expect(bytes.length).toBeGreaterThan(MAX_LOG_BYTES - 4)
      expect(result).toContain(`\nPrefix:${text}`)
      expect(result).toMatch(/\n\[tempad-dev\/mcp\] Oversized log entry truncated\.\n$/)
    }
  )

  it('uses the existing file size when opening an append destination', async () => {
    fs.writeFileSync(path, 'x'.repeat(MAX_LOG_BYTES + 1))
    const stream = createLogDestination(path)
    stream.end('Fresh\n')
    await finished(stream)
    expect(fs.readFileSync(path, 'utf8')).toMatch(/older entries discarded\.\nFresh\n$/)
  })

  it('completes partial writes without duplicating or dropping bytes', async () => {
    vi.mocked(fs.writeSync).mockImplementation(((
      fd: number,
      buffer: Buffer,
      offset: number,
      length: number
    ) => realFs.writeSync(fd, buffer, offset, Math.min(length, 3))) as typeof fs.writeSync)
    const stream = createLogDestination(path)
    stream.end('中文 🐈 complete\n')
    await finished(stream)
    expect(fs.readFileSync(path, 'utf8')).toBe('中文 🐈 complete\n')
    expect(vi.mocked(fs.writeSync).mock.calls.length).toBeGreaterThan(1)
  })

  it.each(['write', 'truncate', 'no progress'] as const)(
    'propagates %s failure and still closes the descriptor',
    async (failure) => {
      const error = new Error('Disk unavailable')
      if (failure === 'write') {
        vi.mocked(fs.writeSync).mockImplementation(() => {
          throw error
        })
      }
      if (failure === 'no progress') vi.mocked(fs.writeSync).mockReturnValue(0)
      if (failure === 'truncate') {
        fs.writeFileSync(path, 'x'.repeat(MAX_LOG_BYTES))
        vi.mocked(fs.ftruncateSync).mockImplementation(() => {
          throw error
        })
      }
      const stream = createLogDestination(path)
      const closed = finished(stream)
      stream.end('New record\n')
      await expect(closed).rejects.toThrow(failure === 'no progress' ? 'no progress' : error)
      expect(fs.closeSync).toHaveBeenCalledOnce()
    }
  )

  it('closes a descriptor when its initial size cannot be read', () => {
    vi.mocked(fs.fstatSync).mockImplementation(() => {
      throw new Error('Cannot stat')
    })
    expect(() => createLogDestination(path)).toThrow('Cannot stat')
    expect(fs.closeSync).toHaveBeenCalledOnce()
  })
})
