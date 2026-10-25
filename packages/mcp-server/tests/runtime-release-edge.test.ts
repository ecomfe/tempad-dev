import { afterEach, expect, it, vi } from 'vitest'

import type { PrototypeConfig } from '../src/runtime-prototype/state'
import type { StableEdgeOptions } from '../src/stable-edge'

const fake = vi.hoisted(() => ({
  options: undefined as StableEdgeOptions | undefined,
  journal: undefined as unknown,
  manifest: {} as Record<string, unknown>
}))
vi.mock('../src/stable-edge', async (original) => ({
  ...(await original<typeof import('../src/stable-edge')>()),
  startStableEdge: async (_host: unknown, options: StableEdgeOptions) => {
    fake.options = options
    return { closed: Promise.resolve(false), close: vi.fn() }
  }
}))
vi.mock('../src/runtime-prototype/state', async (original) => ({
  ...(await original<typeof import('../src/runtime-prototype/state')>()),
  readJournal: () => fake.journal
}))
vi.mock('../src/runtime-update/artifact', () => ({ releaseManifest: () => fake.manifest }))
vi.mock('../src/shared', async (original) => ({
  ...(await original<typeof import('../src/shared')>()),
  endLogging: () => {}
}))

import { startPrototypeEdge } from '../src/runtime-prototype/edge'
import { contractHashes } from '../src/stable-edge'

afterEach(() => vi.restoreAllMocks())
it('requires retained identity and exact wire/guidance while allowing reviewed presentation corrections', async () => {
  vi.spyOn(process.stdin, 'destroy').mockReturnValue(process.stdin)
  await startPrototypeEdge({
    root: '/fixture',
    release: { directory: '/fixture', manifestHash: 'a'.repeat(64) }
  } as PrototypeConfig)
  const validate = fake.options!.validateContract!
  const original = {
    info: { name: 'fixture' },
    instructions: 'Original guidance',
    capabilities: { tools: {} },
    pages: new Map([['', { tools: [] }]])
  }
  expect(() => validate(original, '0.12.0')).toThrow('retained release')
  fake.journal = { active: { version: '0.12.0' } }
  fake.manifest = { ...contractHashes(original), guidanceEpoch: 1 }
  validate(original, '0.12.0')
  const correction = { ...original, instructions: 'Reviewed typo correction' }
  fake.manifest = { ...contractHashes(correction), guidanceEpoch: 1 }
  validate(correction, '0.12.0', original)
  fake.manifest.guidanceEpoch = 2
  expect(() => validate(correction, '0.12.0', original)).toThrow('RESTART_REQUIRED')
  fake.manifest.guidanceEpoch = 1
  fake.manifest.wireHash = 'incorrect'
  expect(() => validate(correction, '0.12.0', original)).toThrow('RESTART_REQUIRED')
})
