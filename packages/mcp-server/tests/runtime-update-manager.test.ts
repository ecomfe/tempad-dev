import { existsSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import type { Artifact } from '../src/runtime-prototype/state'
import type { AcquisitionResult } from '../src/runtime-update/acquire'

import * as durable from '../src/durable-json'
import { createPrivateTempDirectory } from '../src/runtime-platform'
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
  const value = createPrivateTempDirectory('tp-updates-')
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
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each([
  ['attempt', 'ENOSPC'],
  ['success', 'EIO'],
  ['failure', 'EACCES']
])('isolates %s persistence failure from the scheduler (%s)', async (stage, code) => {
  vi.useFakeTimers()
  const directory = root()
  const acquire = vi.fn(async () => {
    if (stage === 'failure') throw new Error('registry offline')
    return { candidate }
  })
  const updates = owner({ root: directory, enrolled: () => true, acquire })
  const write = durable.writeDurableJson
  const persist = vi.spyOn(durable, 'writeDurableJson').mockImplementation((path, state) => {
    if (stage === 'attempt' || persist.mock.calls.length === 2)
      throw Object.assign(new Error(code), { code })
    write(path, state)
  })
  updates.schedule()
  await vi.advanceTimersByTimeAsync(0)
  expect(acquire).toHaveBeenCalledTimes(stage === 'attempt' ? 0 : 1)
  expect(updates.status).toMatchObject({
    checking: false,
    disabled: true,
    error: expect.stringContaining(code)
  })
  expect(updates.status.error).toContain('disabled')
  if (stage === 'failure') expect(updates.status.error).toContain('registry offline')
  expect(updates.status.candidate).toBeUndefined()
  const writes = persist.mock.calls.length
  updates.schedule()
  await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
  expect(persist).toHaveBeenCalledTimes(writes)
  await expect(updates.check('latest', true)).rejects.toThrow(code)
  expect(acquire).toHaveBeenCalledTimes(stage === 'attempt' ? 0 : 1)
  expect(persist).toHaveBeenCalledTimes(writes)
  updates.close()
  // A fresh owner can resume once storage is repaired, using the persisted
  // attempt backoff rather than repeatedly crashing or skipping admission.
  persist.mockRestore()
  const restored = owner({
    root: directory,
    enrolled: () => true,
    acquire: async () => ({ candidate })
  })
  await expect(restored.check('latest', true)).resolves.toEqual(candidate)
})

it.each([false, true])(
  'retains the committed candidate after a failed save (renamed: %s)',
  async (renamed) => {
    const directory = root()
    const acquire = vi.fn(async () => ({ candidate }))
    const updates = owner({ root: directory, enrolled: () => true, acquire })
    await updates.check('latest', true)
    const later = { ...candidate, version: '0.12.2', bundle: 'b'.repeat(64) }
    acquire.mockResolvedValue({ candidate: later })
    const write = durable.writeDurableJson
    vi.spyOn(durable, 'writeDurableJson')
      .mockImplementationOnce(write)
      .mockImplementation((path, value) => {
        if (renamed) write(path, value)
        throw new Error('EIO')
      })
    await expect(updates.check('latest', true)).rejects.toThrow('EIO')
    expect(updates.status).toMatchObject({ candidate, error: expect.stringContaining('EIO') })
    expect(JSON.parse(readFileSync(join(directory, 'updates.json'), 'utf8')).candidate).toEqual(
      renamed ? later : candidate
    )
  }
)

it('does no background work without an enrolled edge and never activates', async () => {
  vi.useFakeTimers()
  const acquire = vi.fn(async () => ({ candidate }))
  const directory = root()
  const updates = owner({ root: directory, enrolled: () => false, acquire })
  updates.schedule()
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  await updates.check()
  expect(acquire).not.toHaveBeenCalled()
  await updates.check('0.12.1', true)
  expect(acquire).toHaveBeenCalledOnce()
  expect(updates.status).toMatchObject({ disabled: false, manualCandidate: candidate })
  expect(updates.status.candidate).toBeUndefined()
  expect(existsSync(join(directory, 'switch.json'))).toBe(false)
})

it('shares concurrent checks and preserves the schedule across an owner restart', async () => {
  vi.useFakeTimers()
  const directory = root()
  const acquire = vi.fn(async () => ({ candidate }))
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

it('keeps exact staging separate from stable selection across restarts', async () => {
  const manual = { ...candidate, version: '0.12.99', bundle: 'c'.repeat(64) }
  const acquire = vi.fn(async (selector: string) => ({
    candidate: selector === 'latest' ? candidate : manual
  }))
  const options = { root: root(), enrolled: () => true, acquire }
  const updates = owner(options)
  await updates.check('latest', true)
  await updates.check(manual.version, true)
  expect(updates.status).toMatchObject({ candidate, manualCandidate: manual })
  updates.close()
  expect(owner(options).status).toMatchObject({ candidate, manualCandidate: manual })
})

it.each(['latest', '0.12.1'])(
  'only shares concurrent acquisitions for the same selector (%s)',
  async (selector) => {
    const completion = Promise.withResolvers<AcquisitionResult>()
    const acquire = vi.fn(() => completion.promise)
    const updates = owner({ root: root(), enrolled: () => true, acquire })
    const first = updates.check(selector, true)
    const same = updates.check(selector, true)
    await expect(updates.check(selector === 'latest' ? '0.12.1' : 'latest', true)).rejects.toThrow(
      'Another release selector'
    )
    completion.resolve({ candidate })
    expect(await first).toEqual(await same)
    expect(acquire).toHaveBeenCalledOnce()
    expect(updates.status.candidate).toEqual(selector === 'latest' ? candidate : undefined)
  }
)

it('does not automatically reuse old staging without provenance', () => {
  const directory = root()
  writeFileSync(
    join(directory, 'updates.json'),
    JSON.stringify({ version: 1, candidate, nextCheck: 0, failures: 0 }),
    { mode: 0o600 }
  )
  const updates = owner({ root: directory, enrolled: () => true, acquire: vi.fn() })
  expect(updates.status.candidate).toBeUndefined()
  expect(updates.status.error).toContain('rebuilt')
})

it('backs off offline failures while retaining a verified candidate', async () => {
  vi.useFakeTimers()
  const acquire = vi
    .fn<() => Promise<AcquisitionResult>>()
    .mockResolvedValueOnce({ candidate })
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
      new Promise<AcquisitionResult>((_resolve, reject) =>
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

it.each(['broken', JSON.stringify({ version: 1, nextCheck: 'invalid' })])(
  'rebuilds corrupt scheduling metadata after preserving %s and backs off across restarts',
  async (corrupt) => {
    vi.useFakeTimers()
    const directory = root()
    writeFileSync(join(directory, 'updates.json'), corrupt, { mode: 0o600 })
    for (const name of ['switch.json', 'design-tasks.json', 'hooks.json'])
      writeFileSync(join(directory, name), `authoritative ${name}`, { mode: 0o600 })
    const acquire = vi.fn(async () => ({ candidate }))
    const updates = owner({ root: directory, enrolled: () => true, acquire })
    const backup = readdirSync(directory).find((name) => name.startsWith('updates.invalid-'))!
    expect(readFileSync(join(directory, backup), 'utf8')).toBe(corrupt)
    expect(updates.status).toMatchObject({
      disabled: false,
      failures: 1,
      error: expect.stringContaining(backup)
    })
    expect(updates.status.candidate).toBeUndefined()
    updates.schedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(acquire).not.toHaveBeenCalled()
    updates.close()
    const restarted = owner({ root: directory, enrolled: () => true, acquire })
    restarted.schedule()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(acquire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(acquire).toHaveBeenCalledOnce()
    expect(restarted.status.candidate).toEqual(candidate)
    expect(readFileSync(join(directory, backup), 'utf8')).toBe(corrupt)
    for (const name of ['switch.json', 'design-tasks.json', 'hooks.json'])
      expect(readFileSync(join(directory, name), 'utf8')).toBe(`authoritative ${name}`)
  }
)

it('allows an explicit check after rebuilding derived metadata', async () => {
  const directory = root()
  writeFileSync(join(directory, 'updates.json'), 'broken', { mode: 0o600 })
  const acquire = vi.fn(async () => ({ candidate }))
  const updates = owner({ root: directory, enrolled: () => true, acquire })
  await expect(updates.check('latest', true)).resolves.toEqual(candidate)
  expect(acquire).toHaveBeenCalledOnce()
})

it('does not replace corrupt metadata if the repaired snapshot cannot commit', async () => {
  const directory = root()
  const path = join(directory, 'updates.json')
  writeFileSync(path, 'broken', { mode: 0o600 })
  vi.spyOn(durable, 'writeDurableJson').mockImplementation(() => {
    throw new Error('ENOSPC')
  })
  const acquire = vi.fn()
  const updates = owner({ root: directory, enrolled: () => true, acquire })
  expect(updates.status).toMatchObject({ disabled: true, error: expect.stringContaining('ENOSPC') })
  expect(readFileSync(path, 'utf8')).toBe('broken')
  await expect(updates.check('latest', true)).rejects.toThrow('ENOSPC')
  expect(acquire).not.toHaveBeenCalled()
})

it.skipIf(process.platform === 'win32')(
  'does not quarantine or replace untrusted metadata',
  async () => {
    const directory = root()
    const original = join(directory, 'original.json')
    writeFileSync(original, 'broken', { mode: 0o600 })
    symlinkSync(original, join(directory, 'updates.json'))
    const acquire = vi.fn()
    const updates = owner({ root: directory, enrolled: () => true, acquire })
    expect(updates.status).toMatchObject({
      disabled: true,
      error: expect.stringContaining('untrusted')
    })
    expect(readdirSync(directory).some((name) => name.startsWith('updates.invalid-'))).toBe(false)
    expect(readFileSync(original, 'utf8')).toBe('broken')
    await expect(updates.check('latest', true)).rejects.toThrow('untrusted')
    expect(acquire).not.toHaveBeenCalled()
  }
)

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

it('persists search progress and resumes promptly after an owner restart', async () => {
  vi.useFakeTimers()
  const directory = root()
  const cursor = {
    fingerprint: 'b'.repeat(64),
    before: '0.12.3',
    latestReasons: ['Guidance epoch changed; restart MCP']
  }
  const selection = {
    latest: '0.12.19',
    latestReasons: cursor.latestReasons,
    inspected: 16,
    remaining: 2,
    cursor
  }
  const acquire = vi
    .fn<ConstructorParameters<typeof ReleaseUpdates>[0]['acquire']>()
    .mockResolvedValueOnce({ selection })
    .mockResolvedValue({
      candidate,
      selection: { ...selection, inspected: 2, remaining: 0, cursor: undefined }
    })
  const options = { root: directory, enrolled: () => true, acquire, jitter: () => 0 }
  const first = owner(options)
  await first.check()
  expect(first.status.candidate).toBeUndefined()
  expect(first.status.selection?.cursor).toEqual(cursor)
  first.close()
  const next = owner(options)
  next.schedule()
  await vi.advanceTimersByTimeAsync(29999)
  expect(acquire).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(acquire).toHaveBeenLastCalledWith('latest', expect.any(AbortSignal), cursor)
  expect(next.status.candidate).toEqual(candidate)
  expect(next.status.selection?.cursor).toBeUndefined()
})

it('clears staging after a successful tag rollback but retains it when the registry is unavailable', async () => {
  const acquire = vi
    .fn<ConstructorParameters<typeof ReleaseUpdates>[0]['acquire']>()
    .mockResolvedValueOnce({ candidate })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      selection: { latest: '0.12.0', latestReasons: [], inspected: 0, remaining: 0 }
    })
  const updates = owner({ root: root(), enrolled: () => true, acquire })
  await updates.check()
  await expect(updates.check()).rejects.toThrow('offline')
  expect(updates.status.candidate).toEqual(candidate)
  await updates.check()
  expect(updates.status.candidate).toBeUndefined()
  expect(updates.status.selection?.latest).toBe('0.12.0')
})
