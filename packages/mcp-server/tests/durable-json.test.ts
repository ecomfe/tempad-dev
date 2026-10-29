import { describe, expect, it, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  openSync: vi.fn(() => 7),
  fsyncSync: vi.fn(),
  closeSync: vi.fn()
}))
vi.mock('node:fs', () => io)
import { writeDurableJson } from '../src/durable-json'
beforeEach(() => vi.resetAllMocks())

describe('durable snapshots', () => {
  it('flushes the file, renames, then syncs the directory', () => {
    writeDurableJson('/private/state.json', { revision: 2 })
    expect(io.writeFileSync).toHaveBeenCalledWith('/private/state.json.tmp', '{"revision":2}', {
      mode: 0o600,
      flush: true
    })
    expect(io.renameSync).toHaveBeenCalledWith('/private/state.json.tmp', '/private/state.json')
    if (process.platform !== 'win32') {
      expect(io.openSync).toHaveBeenCalledWith('/private', 'r')
      expect(io.fsyncSync.mock.invocationCallOrder[0]).toBeGreaterThan(
        io.renameSync.mock.invocationCallOrder[0]!
      )
      expect(io.closeSync).toHaveBeenCalledWith(7)
    }
  })
  it('propagates write and post-rename failures without restoring stale state', () => {
    io.writeFileSync.mockImplementationOnce(() => {
      throw new Error('ENOSPC')
    })
    expect(() => writeDurableJson('/state.json', {})).toThrow('ENOSPC')
    expect(io.renameSync).not.toHaveBeenCalled()
    if (process.platform !== 'win32') {
      io.fsyncSync.mockImplementationOnce(() => {
        throw new Error('EIO')
      })
      expect(() => writeDurableJson('/state.json', {})).toThrow('EIO')
      expect(io.renameSync).toHaveBeenCalledOnce()
      expect(io.closeSync).toHaveBeenCalledWith(7)
    }
  })
})
