import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (load) => {
  const fs = await load<typeof import('node:fs')>()
  return {
    ...fs,
    writeFileSync: vi.fn(fs.writeFileSync),
    renameSync: vi.fn(fs.renameSync),
    rmSync: vi.fn(fs.rmSync)
  }
})

import { createHubRuntimeIdentity, writeHubRuntimeIdentity } from '../src/runtime-identity'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
afterEach(() => {
  vi.mocked(writeFileSync).mockReset().mockImplementation(fs.writeFileSync)
  vi.mocked(renameSync).mockReset().mockImplementation(fs.renameSync)
  vi.mocked(rmSync).mockReset().mockImplementation(fs.rmSync)
})

it.each(['write', 'rename', 'cleanup'] as const)(
  'preserves the previous identity and original error after %s failure',
  (stage) => {
    const directory = mkdtempSync(join(tmpdir(), 'tempad-identity-io-'))
    const path = join(directory, 'hub-runtime.json')
    fs.writeFileSync(path, 'previous identity')
    const identity = createHubRuntimeIdentity(path, '1', { processId: 42 })
    const temporary = `${path}.42.tmp`
    const error = Object.assign(new Error('Identity IO failed'), { code: 'EIO' })
    if (stage === 'rename')
      vi.mocked(renameSync).mockImplementationOnce(() => {
        throw error
      })
    else
      vi.mocked(writeFileSync).mockImplementationOnce((...args) => {
        fs.writeFileSync(...args)
        throw error
      })
    if (stage === 'cleanup')
      vi.mocked(rmSync).mockImplementationOnce(() => {
        throw new Error('Cleanup failed')
      })
    try {
      expect(() => writeHubRuntimeIdentity(path, identity)).toThrow(error)
      expect(readFileSync(path, 'utf8')).toBe('previous identity')
      expect(existsSync(temporary)).toBe(stage === 'cleanup')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
