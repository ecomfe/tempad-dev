import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import type { Artifact } from '../src/runtime-prototype/state'

import { updateIntent } from '../src/runtime-update/bootstrap'
import { ReleaseUpdates } from '../src/runtime-update/manager'

const roots: string[] = []
const owners: ReleaseUpdates[] = []
const candidate: Artifact = {
  entry: '/verified/dist/managed-runtime.mjs',
  bundle: 'a'.repeat(64),
  version: '0.12.1'
}
function root() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'tp-updates-')))
  roots.push(value)
  return value
}
function owner(options: ConstructorParameters<typeof ReleaseUpdates>[0]) {
  const value = new ReleaseUpdates(options)
  owners.push(value)
  return value
}
afterEach(() => {
  for (const value of owners.splice(0)) value.close()
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

it('does no background work without an enrolled edge and never activates', async () => {
  vi.useFakeTimers()
  const acquire = vi.fn(async () => candidate)
  const directory = root()
  const updates = owner({ root: directory, enrolled: () => false, acquire })
  updates.schedule()
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  await updates.check()
  expect(acquire).not.toHaveBeenCalled()
  await updates.check('0.12.1', true)
  expect(acquire).toHaveBeenCalledOnce()
  expect(updates.status).toMatchObject({ automaticActivation: false, candidate })
  expect(existsSync(join(directory, 'switch.json'))).toBe(false)
})

it('shares concurrent checks and preserves the schedule across an owner restart', async () => {
  vi.useFakeTimers()
  const directory = root()
  const acquire = vi.fn(async () => candidate)
  const options = { root: directory, enrolled: () => true, acquire, jitter: () => 0 }
  const updates = owner(options)
  const [first, second] = await Promise.all([updates.check(), updates.check()])
  expect(first).toEqual(second)
  expect(acquire).toHaveBeenCalledOnce()
  updates.close()
  const next = owner(options)
  next.schedule()
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1)
  expect(acquire).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(acquire).toHaveBeenCalledTimes(2)
})

it('backs off offline failures while retaining a verified candidate', async () => {
  vi.useFakeTimers()
  const acquire = vi
    .fn<() => Promise<Artifact>>()
    .mockResolvedValueOnce(candidate)
    .mockRejectedValue(new Error('offline'))
  const updates = owner({ root: root(), enrolled: () => true, acquire, jitter: () => 0 })
  await updates.check()
  await expect(updates.check()).rejects.toThrow('offline')
  expect(updates.status).toMatchObject({
    candidate,
    failures: 1,
    error: expect.stringContaining('offline')
  })
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
  expect(acquire).toHaveBeenCalledTimes(3)
  expect(updates.status.failures).toBe(2)
})

it('cancels background acquisition after the last opt-in edge leaves', async () => {
  let enrolled = true
  const acquire = vi.fn(
    (_selector, signal: AbortSignal) =>
      new Promise<Artifact>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      )
  )
  const updates = owner({ root: root(), enrolled: () => enrolled, acquire })
  const checking = updates.check()
  await Promise.resolve()
  enrolled = false
  updates.schedule()
  await expect(checking).rejects.toThrow('aborted')
})

it('preserves corrupt scheduling evidence without querying the network', async () => {
  const directory = root()
  writeFileSync(join(directory, 'updates.json'), 'broken', { mode: 0o600 })
  const acquire = vi.fn(async () => candidate)
  const updates = owner({ root: directory, enrolled: () => true, acquire })
  updates.schedule()
  await expect(updates.check('latest', true)).rejects.toThrow('metadata is unreadable')
  expect(readFileSync(join(directory, 'updates.json'), 'utf8')).toBe('broken')
  expect(acquire).not.toHaveBeenCalled()
})

it('rejects contradictory checkout enrollment before constructing an updater', () => {
  expect(updateIntent([], true)).toEqual({ command: undefined, policy: 'off' })
  for (const flag of [
    '--runtime-updates=stable',
    '--runtime-updates=off',
    '--runtime-updates=pinned',
    '--check-runtime-update',
    '--update-runtime'
  ])
    expect(() => updateIntent([flag], true)).toThrow('Checkout')
  expect(() => updateIntent(['--runtime-updates=canary'], false)).toThrow('Use one')
  expect(updateIntent(['--runtime-updates=pinned'], false).policy).toBe('pinned')
  vi.stubEnv('TEMPAD_MCP_DEV_CHECKOUT', '/missing/checkout')
  expect(() => owner({ root: root(), enrolled: () => true, acquire: vi.fn() })).toThrow('Checkout')
})
