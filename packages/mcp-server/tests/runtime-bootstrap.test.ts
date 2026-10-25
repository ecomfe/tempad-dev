import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  edge: vi.fn(),
  connect: vi.fn(),
  request: vi.fn(),
  retain: vi.fn(),
  question: vi.fn(),
  close: vi.fn(),
  recovery: vi.fn(),
  profile: { kind: 'release' }
}))
vi.mock('../src/runtime-prototype/edge', () => ({ startPrototypeEdge: fake.edge }))
vi.mock('../src/runtime-update/artifact', async (original) => ({
  ...(await original<typeof import('../src/runtime-update/artifact')>()),
  retainBundledPackage: fake.retain
}))
vi.mock('../src/runtime-prototype/processes', async (original) => ({
  ...(await original<typeof import('../src/runtime-prototype/processes')>()),
  connectSocket: fake.connect,
  supervisorConnection: async () => ({}),
  fingerprintBundle: () => 'a'.repeat(64)
}))
vi.mock('../src/runtime-prototype/protocol', async (original) => ({
  ...(await original<typeof import('../src/runtime-prototype/protocol')>()),
  ControlPeer: class {
    connect = async () => {}
    request = fake.request
    close = fake.close
  },
  SocketTransport: class {}
}))
vi.mock('../src/shared', async (original) => ({
  ...(await original<typeof import('../src/shared')>()),
  RUNTIME_PROFILE: fake.profile,
  resolveStateDir: () => {
    const directory = process.env.TEMPAD_MCP_STATE_DIR!
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    return realpathSync(directory)
  },
  endLogging: () => {}
}))
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: fake.question, close: fake.close })
}))
vi.mock('../src/runtime-recovery', () => ({ runRuntimeRecovery: fake.recovery }))

import { maybeManagedRuntime } from '../src/runtime-update/bootstrap'
import { ASSET_DIR, LOG_DIR, RUNTIME_DIR, resolveStateDir } from '../src/shared'

const root = join(resolveStateDir(), 'runtime')
const packageDir = join(resolveStateDir(), 'package')
const configPath = join(root, 'prototype.json')
const manifest = {
  version: 1,
  guidanceEpoch: 1,
  guidanceReview: {
    version: '0.12.0',
    sourceHash: 'a'.repeat(64),
    decision: 'initial',
    baseline: { version: '0.11.0', integrity: `sha512-${'a'.repeat(86)}==` },
    rationale: 'First release with a reviewed guidance epoch.'
  },
  controlProtocols: [1],
  state: { family: 'tempad', reads: [1], writes: 1 },
  extension: { protocols: [13, 15], legacy: true },
  hookProtocol: 2,
  name: '@tempad-dev/mcp',
  packageVersion: '0.12.0',
  entry: 'dist/managed-runtime.mjs',
  node: '^22 || ^24 || >=26',
  platforms: ['darwin', 'linux', 'win32'],
  wireHash: 'b'.repeat(64),
  presentationHash: 'c'.repeat(64),
  lockHash: 'd'.repeat(64),
  files: {}
}
beforeEach(() => {
  vi.clearAllMocks()
  fake.profile.kind = 'release'
  fake.connect.mockRejectedValue(Object.assign(new Error('absent'), { code: 'ENOENT' }))
  fake.retain.mockReturnValue({
    entry: join(packageDir, manifest.entry),
    version: '0.12.0',
    bundle: '',
    release: { directory: packageDir, manifestHash: 'a'.repeat(64) }
  })
  fake.request.mockResolvedValue({})
  mkdirSync(join(packageDir, 'dist'), { recursive: true, mode: 0o700 })
  writeFileSync(join(packageDir, 'dist/runtime-manifest.json'), JSON.stringify(manifest))
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  vi.spyOn(process.stdin, 'destroy').mockReturnValue(process.stdin)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
  rmSync(packageDir, { recursive: true, force: true })
})

it('keeps status, opt-out and checkout launches from enrolling', async () => {
  expect(await maybeManagedRuntime(['--runtime-update-status'], packageDir)).toBe(true)
  expect(await maybeManagedRuntime(['--runtime-status'], packageDir)).toBe(false)
  expect(await maybeManagedRuntime(['--resolve-runtime-block'], packageDir)).toBe(false)
  await expect(maybeManagedRuntime(['--recover-runtime'], packageDir)).rejects.toThrow(
    'No managed runtime'
  )
  expect(await maybeManagedRuntime(['--runtime-updates=off'], packageDir)).toBe(false)
  expect(existsSync(configPath)).toBe(false)
  expect(fake.retain).not.toHaveBeenCalled()
  fake.profile.kind = 'checkout'
  expect(await maybeManagedRuntime([], packageDir)).toBe(false)
  await expect(maybeManagedRuntime(['--check-runtime-update'], packageDir)).rejects.toThrow(
    'Checkout'
  )
})

it('automatically enrolls verified releases but never guesses an unverified local build', async () => {
  const path = join(packageDir, 'dist/runtime-manifest.json')
  rmSync(path)
  expect(await maybeManagedRuntime([], packageDir)).toBe(false)
  expect(fake.connect).not.toHaveBeenCalled()
  expect(fake.retain).not.toHaveBeenCalled()
  writeFileSync(path, JSON.stringify(manifest))
  expect(await maybeManagedRuntime([], packageDir)).toBe(true)
  expect(fake.edge).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ policy: 'stable' })
  )
})

it('enrolls once and gives every subsequent policy the same directories and owner', async () => {
  expect(await maybeManagedRuntime(['--runtime-updates=stable'], packageDir)).toBe(true)
  const saved = JSON.parse(readFileSync(configPath, 'utf8'))
  expect(saved.directories).toEqual({
    runtime: RUNTIME_DIR,
    state: resolveStateDir(),
    assets: ASSET_DIR,
    log: LOG_DIR
  })
  await maybeManagedRuntime([], packageDir)
  await maybeManagedRuntime(['--runtime-updates=off'], packageDir)
  await maybeManagedRuntime(['--runtime-updates=pinned'], packageDir)
  expect(fake.retain).toHaveBeenCalledTimes(1)
  expect(fake.edge.mock.calls.map((call) => call[1].policy)).toEqual([
    'stable',
    'stable',
    'off',
    'pinned'
  ])
  expect(fake.edge.mock.calls.every((call) => call[0].secret === saved.secret)).toBe(true)
})

it('never replaces an existing legacy owner or guesses a missing release build', async () => {
  const destroy = vi.fn()
  fake.connect.mockResolvedValue({ destroy })
  expect(await maybeManagedRuntime([], packageDir)).toBe(false)
  expect(await maybeManagedRuntime(['--runtime-updates=stable'], packageDir)).toBe(false)
  await expect(maybeManagedRuntime(['--check-runtime-update'], packageDir)).rejects.toThrow(
    'legacy Hub'
  )
  await expect(maybeManagedRuntime(['--runtime-updates=pinned'], packageDir)).rejects.toThrow(
    'legacy Hub'
  )
  expect(destroy).toHaveBeenCalledTimes(4)
  expect(existsSync(configPath)).toBe(false)
  rmSync(join(packageDir, 'dist/runtime-manifest.json'))
  await expect(maybeManagedRuntime(['--runtime-updates=stable'], packageDir)).rejects.toThrow(
    'no online fallback'
  )
})

it.each(['EPIPEUNPROTECTED', 'EPIPEUNTRUSTED'])(
  'explains the one-time Windows legacy restart for %s without trusting the pipe',
  async (code) => {
    const failure = Object.assign(new Error('ACL does not grant private user access'), { code })
    fake.connect.mockRejectedValue(failure)
    for (const args of [[], ['--check-runtime-update']]) {
      const attempt = maybeManagedRuntime(args, packageDir)
      await expect(attempt).rejects.toThrow(
        'Close/restart all TemPad MCP connections once to replace a legacy Hub'
      )
      await expect(attempt).rejects.toMatchObject({ cause: failure })
    }
    expect(existsSync(configPath)).toBe(false)
    expect(fake.retain).not.toHaveBeenCalled()
    expect(fake.edge).not.toHaveBeenCalled()
  }
)

it('preserves corrupt metadata and refuses changed directories rather than starting a second owner', async () => {
  await maybeManagedRuntime(['--runtime-updates=stable'], packageDir)
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  writeFileSync(
    configPath,
    JSON.stringify({ ...config, directories: { ...config.directories, assets: '/different' } })
  )
  await expect(maybeManagedRuntime([], packageDir)).rejects.toThrow('directories differ')
  writeFileSync(configPath, 'broken')
  await expect(maybeManagedRuntime([], packageDir)).rejects.toThrow()
  expect(readFileSync(configPath, 'utf8')).toBe('broken')
  expect(fake.retain).toHaveBeenCalledOnce()
})

it('checks without activation and requires a terminal confirmation of the staged integrity', async () => {
  await maybeManagedRuntime(['--check-runtime-update'], packageDir)
  expect(fake.request).toHaveBeenCalledWith(
    { method: 'tempad/runtime-check', params: { version: 'latest' } },
    expect.anything(),
    expect.anything()
  )
  const candidate = { version: '0.12.1', release: { integrity: 'exact-integrity' } }
  fake.request.mockResolvedValue({ candidate })
  await expect(maybeManagedRuntime(['--update-runtime', '0.12.1'], packageDir)).rejects.toThrow(
    'interactive'
  )
  vi.stubGlobal('process', {
    ...process,
    stdin: { isTTY: true, destroy: vi.fn() },
    stdout: { isTTY: true, write: vi.fn() }
  })
  fake.question.mockResolvedValue('no')
  await expect(maybeManagedRuntime(['--update-runtime', '0.12.1'], packageDir)).rejects.toThrow(
    'cancelled'
  )
  expect(fake.request.mock.calls.some((call) => call[0].method === 'tempad/runtime-activate')).toBe(
    false
  )
  fake.question.mockResolvedValue('update 0.12.1')
  await maybeManagedRuntime(['--update-runtime', '0.12.1'], packageDir)
  expect(fake.request).toHaveBeenLastCalledWith(
    {
      method: 'tempad/runtime-activate',
      params: { version: '0.12.1', integrity: 'exact-integrity' }
    },
    expect.anything(),
    expect.anything()
  )
  expect(fake.question).toHaveBeenCalledWith(expect.stringContaining('exact-integrity'))
  fake.request.mockResolvedValue({})
  await expect(maybeManagedRuntime(['--update-runtime', '0.12.1'], packageDir)).rejects.toThrow(
    'not staged'
  )
})

it('routes status and recovery through the existing owner without downloading', async () => {
  await maybeManagedRuntime(['--runtime-updates=stable'], packageDir)
  for (const command of [
    '--runtime-update-status',
    '--runtime-status',
    '--resolve-runtime-block',
    '--recover-runtime'
  ])
    await maybeManagedRuntime([command], packageDir)
  expect(fake.recovery).toHaveBeenCalledTimes(2)
  expect(fake.request.mock.calls.some((call) => call[0].method === 'tempad/runtime-check')).toBe(
    false
  )
  expect(await maybeManagedRuntime(['--recover-task-storage'], packageDir)).toBe(false)
})
