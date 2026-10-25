import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify({ packageManager: 'pnpm@12.8.2' })
}))
vi.mock('../scripts/package-manager.mjs', () => ({ runPackageManagerSync: fixture.run }))
const modulePath = '../scripts/runtime-dependencies.mjs'
const { deployRuntimeDependencies } = await import(modulePath)

beforeEach(() => {
  fixture.run.mockReset().mockReturnValue('12.8.2\n')
})

it.each([false, true])('keeps the production dependency graph frozen (offline: %s)', (offline) => {
  deployRuntimeDependencies('/workspace', '/temporary/deploy', { offline })
  expect(fixture.run).toHaveBeenNthCalledWith(1, 'pnpm', ['--version'], {
    cwd: '/workspace',
    encoding: 'utf8'
  })
  expect(fixture.run).toHaveBeenNthCalledWith(
    2,
    'pnpm',
    [
      '--filter',
      '@tempad-dev/mcp',
      'deploy',
      '--prod',
      ...(offline ? ['--offline'] : []),
      '--ignore-scripts',
      '--frozen-lockfile',
      '--config.node-linker=hoisted',
      '/temporary/deploy'
    ],
    { cwd: '/workspace', stdio: 'inherit' }
  )
})

it('rejects a different package manager before deploying dependencies', () => {
  fixture.run.mockReturnValue('11.19.0\n')
  expect(() => deployRuntimeDependencies('/workspace', '/deploy', { offline: false })).toThrow(
    'pnpm version pinned by the workspace'
  )
  expect(fixture.run).toHaveBeenCalledTimes(1)
})
