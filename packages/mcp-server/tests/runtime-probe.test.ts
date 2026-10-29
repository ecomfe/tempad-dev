import { rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  roots: [] as string[],
  connect: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
  fingerprint: vi.fn(),
  contract: vi.fn(),
  stderr: vi.fn(),
  delay: vi.fn(),
  version: '0.11.1'
}))
vi.mock('node:timers/promises', () => ({ setTimeout: fake.delay }))
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
    stderr = { on: fake.stderr }
    close = fake.close
  }
}))
vi.mock('../src/runtime-prototype/protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/runtime-prototype/protocol')>()),
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
vi.mock('../src/stable-edge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/stable-edge')>()),
  readRuntimeContract: fake.contract
}))
import { createPrivateTempDirectory } from '../src/runtime-platform'
import { probeArtifact } from '../src/runtime-prototype/probe'

let root: string
let entry: string
beforeEach(() => {
  vi.clearAllMocks()
  root = createPrivateTempDirectory('tp-artifact-')
  entry = join(root, 'runtime.mjs')
  writeFileSync(entry, 'export {}')
  fake.version = '0.11.1'
  fake.fingerprint.mockReturnValue('a'.repeat(64))
  fake.connect.mockResolvedValue(undefined)
  fake.delay.mockResolvedValue(undefined)
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
  vi.useRealTimers()
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
it('allows initial attachment beyond 15 seconds within the production recovery budget', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  fake.connect.mockImplementationOnce(
    (_transport, { timeout }: { timeout: number }) =>
      new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Initialize timed out')), timeout)
        setTimeout(() => {
          clearTimeout(deadline)
          resolve()
        }, 16_000)
      })
  )
  const probe = probeArtifact(entry)
  const completed = expect(probe).resolves.toMatchObject({ artifact: { version: '0.11.1' } })
  await vi.advanceTimersByTimeAsync(16_000)
  await completed
  expect(existsSync(fake.roots[0]!)).toBe(false)
})
it('keeps an unresponsive initialization bounded and forwards its private diagnostics', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const failure = new Error('Initialize timed out')
  fake.connect.mockImplementationOnce(
    (_transport, { timeout }: { timeout: number }) =>
      new Promise<void>((_resolve, reject) => {
        fake.stderr.mock.calls[0]![1](Buffer.from('private probe startup'))
        setTimeout(() => reject(failure), timeout)
      })
  )
  const probe = probeArtifact(entry)
  const failed = expect(probe).rejects.toMatchObject({
    cause: failure,
    diagnostic: {
      phase: 'initialize',
      elapsedMs: 95_000,
      stderr: 'private probe startup'
    }
  })
  await vi.advanceTimersByTimeAsync(95_000)
  await failed
  expect(fake.request).not.toHaveBeenCalled()
  expect(existsSync(join(fake.roots[0]!, 'probe-failure.json'))).toBe(true)
  expect(fake.close).toHaveBeenCalledTimes(3)
})
it('rejects a bundle changed during probing', async () => {
  fake.fingerprint.mockReturnValueOnce('a'.repeat(64)).mockReturnValueOnce('b'.repeat(64))
  await expect(probeArtifact(entry)).rejects.toThrow('changed during verification')
  expect(existsSync(fake.roots[0]!)).toBe(false)
})
it('preserves evidence and the original error when child ownership is unknown', async () => {
  const failure = new Error('Initialization failed')
  fake.connect.mockImplementationOnce(async () => {
    const receive = fake.stderr.mock.calls[0]![1]
    receive(Buffer.alloc(20_000, 'x'))
    receive(Buffer.from('final stderr'))
    throw failure
  })
  await expect(probeArtifact(entry)).rejects.toMatchObject({
    cause: failure,
    message: expect.stringContaining('ownership is unknown after initialize failed'),
    diagnostic: {
      phase: 'initialize',
      stderr: expect.stringContaining('final stderr')
    }
  })
  expect(existsSync(fake.roots[0]!)).toBe(true)
  const diagnostic = JSON.parse(readFileSync(join(fake.roots[0]!, 'probe-failure.json'), 'utf8'))
  expect(diagnostic).toMatchObject({
    phase: 'initialize',
    failure: expect.stringContaining('Initialization failed'),
    stderr: expect.stringContaining('final stderr')
  })
  expect(Buffer.byteLength(diagnostic.stderr)).toBeLessThanOrEqual(16_384)
  expect(diagnostic).not.toHaveProperty('pids')
  expect(fake.delay).not.toHaveBeenCalled()
})
it('distinguishes known processes that remain alive from startup ownership failures', async () => {
  vi.mocked(process.kill).mockReturnValue(true)
  await expect(probeArtifact(entry)).rejects.toThrow('did not stop')
  expect(existsSync(fake.roots[0]!)).toBe(true)
  const diagnostic = JSON.parse(readFileSync(join(fake.roots[0]!, 'probe-failure.json'), 'utf8'))
  expect(diagnostic).toMatchObject({ phase: 'shutdown', pids: [900001, 900002], stderr: '' })
  expect(fake.delay).toHaveBeenCalledTimes(60)
  expect(fake.delay).toHaveBeenCalledWith(100)
})
