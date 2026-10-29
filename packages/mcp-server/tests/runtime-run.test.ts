import { randomUUID } from 'node:crypto'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createPrivateTempDirectory } from '../src/runtime-platform'

const fake = vi.hoisted(() => ({
  hub: vi.fn(),
  supervisor: vi.fn(),
  edge: vi.fn(),
  request: vi.fn(),
  recovery: vi.fn(),
  config: {} as Record<string, unknown>
}))
vi.mock('../src/hub-runtime', () => ({ startHub: fake.hub }))
vi.mock('../src/runtime-prototype/supervisor', () => ({ startSupervisor: fake.supervisor }))
vi.mock('../src/runtime-prototype/edge', () => ({ startPrototypeEdge: fake.edge }))
vi.mock('../src/shared', () => ({ endLogging: () => {} }))
vi.mock('../src/runtime-prototype/processes', () => ({
  prototypeConfig: (root: string) => ({ ...fake.config, root }),
  hubSocketPath: (root: string, runtime = join(root, 'run')) => join(runtime, 'runtime-hub.sock'),
  supervisorConnection: async () => ({}),
  connectSocket: async () => ({})
}))
vi.mock('../src/runtime-prototype/protocol', () => ({
  ControlPeer: class {
    connect = async () => {}
    request = fake.request
    close = async () => {}
  },
  SocketTransport: class {}
}))
vi.mock('../src/runtime-recovery', () => ({ runRuntimeRecovery: fake.recovery }))
import { runRuntime } from '../src/runtime-prototype/run'

let root: string
beforeEach(() => {
  vi.clearAllMocks()
  root = createPrivateTempDirectory('tp-run-')
  fake.config = { version: 1, entry: '/fixture.mjs', bundle: 'a'.repeat(64), secret: randomUUID() }
  fake.request.mockResolvedValue({ status: 'okay' })
  fake.hub.mockResolvedValue(undefined)
  vi.stubGlobal('process', {
    ...process,
    argv: ['node', '/fixture.mjs', '--root', root],
    env: { ...process.env, SystemRoot: process.env.SystemRoot },
    stdin: { destroy: vi.fn() },
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})
it('confines standalone probes and dispatches only supported roles', async () => {
  await runRuntime('/fixture.mjs')
  expect(fake.edge).toHaveBeenCalledOnce()
  expect(process.env.TEMPAD_MCP_STATE_DIR).toBe(join(root, 'state'))
  process.argv.push('--role', 'supervisor')
  await runRuntime('/fixture.mjs')
  expect(fake.supervisor).toHaveBeenCalledWith(expect.objectContaining({ root }))
  process.argv[5] = 'unexpected'
  await expect(runRuntime('/fixture.mjs')).rejects.toThrow('Use runtime-prototype')
})
it('restores release directories before starting a paused replacement Hub', async () => {
  const directories = {
    runtime: '/fixture/run',
    state: '/fixture/state',
    assets: '/fixture/assets',
    log: '/fixture/log'
  }
  fake.config = {
    ...fake.config,
    directories,
    release: { directory: '/fixture', manifestHash: 'b'.repeat(64) }
  }
  writeFileSync(join(root, 'prototype.json'), JSON.stringify(fake.config), { mode: 0o600 })
  process.argv.push('--role', 'hub')
  await runRuntime('/fixture.mjs')
  expect(process.env.TEMPAD_MCP_ASSET_DIR).toBe(directories.assets)
  expect(fake.hub).toHaveBeenCalledWith({
    entryPath: '/fixture.mjs',
    prototype: {
      root,
      secret: fake.config.secret,
      socketPath: join(directories.runtime, 'runtime-hub.sock'),
      paused: true,
      release: true
    }
  })
  fake.hub.mockRejectedValue(new Error('listener failed'))
  await runRuntime('/fixture.mjs')
  expect(process.exitCode).toBe(1)
  expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('listener failed'))
})
it('rejects checkout and untrusted roots before starting a child', async () => {
  process.env.TEMPAD_MCP_DEV_CHECKOUT = '/checkout'
  await expect(runRuntime('/fixture.mjs')).rejects.toThrow('without checkout')
  delete process.env.TEMPAD_MCP_DEV_CHECKOUT
  if (process.platform !== 'win32') {
    chmodSync(root, 0o755)
    await expect(runRuntime('/fixture.mjs')).rejects.toThrow('untrusted')
  }
  expect(fake.edge).not.toHaveBeenCalled()
})
it('routes local switch, diagnostics and execution recovery through private controls', async () => {
  for (const args of [
    ['--status'],
    ['--recover-runtime'],
    ['--switch', '/next.mjs'],
    ['--runtime-status'],
    ['--resolve-runtime-block', 'id']
  ]) {
    process.argv = ['node', '/fixture.mjs', '--root', root, ...args]
    await runRuntime('/fixture.mjs')
  }
  expect(fake.request.mock.calls.map((call) => call[0].method)).toEqual([
    'tempad/runtime-status',
    'tempad/runtime-recover',
    'tempad/runtime-update'
  ])
  expect(fake.recovery).toHaveBeenCalledTimes(2)
})
