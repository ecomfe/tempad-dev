import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ directory: '', stderr: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    writeSync(...args: unknown[]) {
      if (args[0] === 2) {
        fixture.stderr.push(String(args[1]))
        return Buffer.byteLength(String(args[1]))
      }
      return Reflect.apply(fs.writeSync, fs, args)
    }
  }
})
vi.mock('../src/shared', () => ({
  get LOG_DIR() {
    return fixture.directory
  },
  PACKAGE_VERSION: '1.0.2'
}))
let directory: string
const originalArgs = process.argv
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
beforeEach(() => {
  vi.resetModules()
  directory = mkdtempSync(join(tmpdir(), 'tempad-startup-log-'))
  fixture.directory = directory
  fixture.stderr = []
})
afterEach(async () => {
  const { finishStartup } = await import('../src/startup-log')
  finishStartup('ready')
  process.argv = originalArgs
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
  rmSync(directory, { recursive: true, force: true })
})

it.each([
  { args: [], tty: false, summaries: 1 },
  { args: ['--runtime-updates=stable'], tty: false, summaries: 1 },
  { args: [], tty: true, summaries: 0 },
  { args: ['--runtime-status'], tty: false, summaries: 0 },
  { args: ['--update-runtime'], tty: false, summaries: 0 }
])('limits stderr to service summaries: $args, TTY=$tty', async ({ args, tty, summaries }) => {
  process.argv = [process.execPath, 'cli.mjs', ...args]
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: tty })
  const { startStartup, startupPhase, finishStartup } = await import('../src/startup-log')
  startStartup('cli')
  startupPhase('verify', () => 42)
  expect(fixture.stderr).toEqual([])
  finishStartup('ready')
  expect(fixture.stderr).toHaveLength(summaries)
  expect(records()).toHaveLength(4)
})

function records() {
  return readdirSync(directory).flatMap((name) =>
    readFileSync(join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  )
}

it('persists stage boundaries before returning without a logging worker', async () => {
  const { startStartup, startupPhase, finishStartup } = await import('../src/startup-log')
  startStartup('hub')
  expect(
    startupPhase('verify-retained-package', () => {
      expect(records().at(-1).event).toBe('start')
      return 42
    })
  ).toBe(42)
  finishStartup('ready')
  expect(records()).toEqual([
    expect.objectContaining({ role: 'hub', event: 'start' }),
    expect.objectContaining({ pid: process.pid, phase: 'verify-retained-package', event: 'start' }),
    expect.objectContaining({ event: 'complete', durationMs: expect.any(Number) }),
    expect.objectContaining({ role: 'hub', event: 'ready' })
  ])
  expect(startupPhase('background-check', () => 'unchanged')).toBe('unchanged')
  expect(records()).toHaveLength(4)
})

it('does not trace background acquisition or probes outside the startup window', async () => {
  const { startupPhase } = await import('../src/startup-log')
  expect(await startupPhase('verify', async () => 42)).toBe(42)
  expect(startupPhase('probe', () => 42)).toBe(42)
  expect(readdirSync(directory)).toEqual([])
})

it('records asynchronous completion and synchronous and asynchronous failures', async () => {
  const { startStartup, startupPhase, finishStartup } = await import('../src/startup-log')
  startStartup('supervisor')
  expect(await startupPhase('copy', async () => 42)).toBe(42)
  const error = new Error('Disk unavailable')
  expect(() =>
    startupPhase('verify', () => {
      throw error
    })
  ).toThrow(error)
  await expect(
    startupPhase('publish', async () => {
      throw error
    })
  ).rejects.toBe(error)
  finishStartup('failed', error)
  expect(records().filter((record) => record.event === 'complete')).toEqual([
    expect.objectContaining({ phase: 'copy', durationMs: expect.any(Number) })
  ])
  expect(records().filter((record) => record.event === 'failed')).toEqual([
    expect.objectContaining({ phase: 'verify', error: String(error) }),
    expect.objectContaining({ phase: 'publish', error: String(error) }),
    expect.objectContaining({ phase: 'supervisor', error: String(error) })
  ])
})

it('keeps diagnostic file failures from blocking startup', async () => {
  fixture.directory = join(directory, 'missing')
  const { startStartup, startupPhase, finishStartup } = await import('../src/startup-log')
  expect(() => startStartup('hub')).not.toThrow()
  expect(startupPhase('verify', () => 42)).toBe(42)
  expect(() => finishStartup('ready')).not.toThrow()
})
