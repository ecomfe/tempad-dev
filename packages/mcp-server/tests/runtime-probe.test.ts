import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  roots: [] as string[],
  connect: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
  fingerprint: vi.fn(),
  contract: vi.fn(),
  version: '0.11.1'
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = fake.connect
    close = fake.close
    getServerVersion = () => ({ name: 'fixture', version: fake.version })
  }
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(options: { args: string[] }) {
      fake.roots.push(options.args[2]!)
    }
    stderr = { on: () => {} }
    close = fake.close
  }
}))
vi.mock('../src/runtime-prototype/protocol', () => ({
  ControlPeer: class {
    connect = fake.connect
    close = fake.close
    request = fake.request
  },
  SocketTransport: class {}
}))
vi.mock('../src/runtime-prototype/processes', () => ({
  connectSocket: async () => ({}),
  fingerprintBundle: fake.fingerprint
}))
vi.mock('../src/stable-edge', () => ({ readRuntimeContract: fake.contract }))
import { probeArtifact } from '../src/runtime-prototype/probe'

let root: string
let entry: string
beforeEach(() => {
  vi.clearAllMocks()
  root = mkdtempSync('/tmp/tp-artifact-')
  entry = join(root, 'runtime.mjs')
  writeFileSync(entry, 'export {}')
  fake.version = '0.11.1'
  fake.fingerprint.mockReturnValue('a'.repeat(64))
  fake.connect.mockResolvedValue(undefined)
  fake.request.mockResolvedValue({ handoffVersion: 1, hubPid: 900001, supervisorPid: 900002 })
  fake.contract.mockResolvedValue({ pages: new Map([['', { tools: [] }]]), instructions: 'stable' })
  const originalKill = process.kill.bind(process)
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === 900001 || pid === 900002)
      throw Object.assign(new Error('exited'), { code: 'ESRCH' })
    return originalKill(pid, signal)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const path of [root, ...fake.roots.splice(0)]) rmSync(path, { recursive: true, force: true })
})
it('verifies the local contract and bundle and removes only a fully stopped probe', async () => {
  const result = await probeArtifact(entry)
  expect(result).toMatchObject({ artifact: { version: '0.11.1', bundle: 'a'.repeat(64) } })
  expect(result.contract).toMatch(/^[a-f0-9]{64}$/)
  expect(fake.close).toHaveBeenCalledTimes(3)
  expect(existsSync(fake.roots[0]!)).toBe(false)
})
it('rejects a bundle changed during probing', async () => {
  fake.fingerprint.mockReturnValueOnce('a'.repeat(64)).mockReturnValueOnce('b'.repeat(64))
  await expect(probeArtifact(entry)).rejects.toThrow('changed during verification')
  expect(existsSync(fake.roots[0]!)).toBe(false)
})
it('preserves evidence and the original error when child ownership is unknown', async () => {
  const failure = new Error('Initialization failed')
  fake.connect.mockRejectedValueOnce(failure)
  await expect(probeArtifact(entry)).rejects.toMatchObject({
    cause: failure,
    message: expect.stringContaining('preserve')
  })
  expect(existsSync(fake.roots[0]!)).toBe(true)
})
