import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  resolve: vi.fn(),
  download: vi.fn(),
  cached: vi.fn(),
  install: vi.fn(),
  probe: vi.fn()
}))
vi.mock('../src/runtime-update/registry', () => ({
  resolveRelease: fake.resolve,
  downloadRelease: fake.download
}))
vi.mock('../src/runtime-update/cache', () => ({
  verifyCached: fake.cached,
  installArchive: fake.install
}))
vi.mock('../src/runtime-prototype/probe', () => ({ probeArtifact: fake.probe }))
import { stageRelease } from '../src/runtime-update/acquire'
import { sha256 } from '../src/runtime-update/package'

let root: string
beforeEach(() => {
  vi.clearAllMocks()
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-acquire-')))
  // The real verifier owns manifest validation; this isolates orchestration and failure policy.
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'dist/runtime-manifest.json'), 'verified manifest')
  const manifest = {
    entry: 'managed-runtime.mjs',
    packageVersion: '0.12.1',
    wireHash: 'wire',
    presentationHash: 'text'
  }
  const installed = { directory: root, manifest }
  fake.resolve.mockResolvedValue({ version: '0.12.1', integrity: 'sri', url: 'official' })
  fake.cached.mockReturnValue(installed)
  fake.install.mockReturnValue(installed)
  fake.download.mockResolvedValue(Buffer.from('verified archive'))
  fake.probe.mockResolvedValue({
    artifact: { entry: join(root, manifest.entry), version: '0.12.1', bundle: 'bundle' },
    wireHash: 'wire',
    presentationHash: 'text'
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

it('does not fetch an archive for current/older versions, or query at all for a checkout', async () => {
  expect(await stageRelease(root, 'latest', '0.12.1')).toBeUndefined()
  expect(fake.download).not.toHaveBeenCalled()
  fake.resolve.mockClear()
  vi.stubEnv('TEMPAD_MCP_DEV_CHECKOUT', '/missing')
  await expect(stageRelease(root, 'latest', '0.12.0')).rejects.toThrow('Checkout')
  expect(fake.resolve).not.toHaveBeenCalled()
})
it('revalidates a cached candidate and downloads only when the cache is absent', async () => {
  expect(await stageRelease(root, '0.12.1', '0.12.0')).toMatchObject({
    release: { manifestHash: sha256('verified manifest') }
  })
  expect(fake.download).not.toHaveBeenCalled()
  fake.cached.mockImplementation(() => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  await stageRelease(root, '0.12.1', '0.12.0')
  expect(fake.download).toHaveBeenCalledOnce()
  expect(fake.install).toHaveBeenCalledOnce()
})
it('never replaces corrupted evidence or accepts a false contract declaration', async () => {
  fake.cached.mockImplementationOnce(() => {
    throw new Error('hash mismatch')
  })
  await expect(stageRelease(root, 'latest', '0.12.0')).rejects.toThrow('hash mismatch')
  expect(fake.download).not.toHaveBeenCalled()
  fake.probe.mockResolvedValue({
    artifact: { version: '0.12.1' },
    wireHash: 'different',
    presentationHash: 'text'
  })
  await expect(stageRelease(root, 'latest', '0.12.0')).rejects.toThrow('declared contract')
})
