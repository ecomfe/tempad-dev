import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { pluginSandboxWorkers } from '../../build/plugin-sandbox-workers'

type ResolveHook = (
  this: { resolve: (source: string) => Promise<{ id: string }> },
  source: string,
  importer: string
) => Promise<{ id: string } | string>

type LoadHook = (this: { addWatchFile: (file: string) => void }, id: string) => Promise<string>

const workerPath = fileURLToPath(new URL('../../codegen/worker.ts', import.meta.url))

describe('plugin sandbox Worker build', () => {
  it('inlines a self-contained blob Worker during development', async () => {
    const plugin = pluginSandboxWorkers(true)
    const resolve = vi.fn(async () => ({ id: workerPath }))
    const resolveId = plugin.resolveId as unknown as ResolveHook
    const id = await resolveId.call({ resolve }, '@/codegen/worker?sandbox-worker', '/entry.ts')
    const watched: string[] = []
    const load = plugin.load as unknown as LoadHook
    const moduleCode = await load.call({ addWatchFile: (file) => watched.push(file) }, String(id))

    expect(resolve).toHaveBeenCalledWith('@/codegen/worker', '/entry.ts', { skipSelf: true })
    expect(moduleCode).toContain("new Blob([source], { type: 'text/javascript' })")
    expect(moduleCode).not.toContain('worker_file')
    expect(watched).toContain(workerPath)
  })

  it('keeps Vite production Worker bundling unchanged', async () => {
    const plugin = pluginSandboxWorkers(false)
    const resolved = { id: `${workerPath}?worker&inline` }
    const resolve = vi.fn(async () => resolved)
    const resolveId = plugin.resolveId as unknown as ResolveHook

    await expect(
      resolveId.call({ resolve }, '@/codegen/worker?sandbox-worker', '/entry.ts')
    ).resolves.toBe(resolved)
    expect(resolve).toHaveBeenCalledWith('@/codegen/worker?worker&inline', '/entry.ts', {
      skipSelf: true
    })
  })
})
