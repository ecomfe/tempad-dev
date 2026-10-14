import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'

vi.mock('node:process', () => ({ default: { ...process, platform: 'win32' } }))
vi.mock('node:child_process', async (load) => ({
  ...(await load<typeof import('node:child_process')>()),
  spawn: vi.fn(() => {
    throw new Error('Unexpected process launch')
  })
}))
vi.mock('node:fs/promises', async (load) => ({
  ...(await load<typeof import('node:fs/promises')>()),
  mkdtemp: vi.fn(() => {
    throw new Error('Unexpected runtime allocation')
  })
}))

it('rejects the bridge harness on Windows before allocating a runtime or starting a Hub', async () => {
  const harness = '../scripts/check-bridge-compatibility.mjs'
  await expect(import(harness)).rejects.toThrow(/Windows.*fixed named pipe/)
  expect(mkdtemp).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})
