import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  process: {
    platform: 'win32',
    execPath: 'C:\\Node\\node.exe',
    env: { PATH: 'C:\\Tools;C:\\Node', npm_execpath: '' }
  },
  files: new Set<string>(),
  execute: vi.fn()
}))
vi.mock('node:process', () => ({ default: fixture.process }))
vi.mock('node:fs', () => ({ existsSync: (path: string) => fixture.files.has(path) }))
vi.mock('node:path', async (original) => (await original<typeof import('node:path')>()).win32)
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: fixture.execute
}))
const modulePath = '../scripts/package-manager.mjs'
const { runPackageManagerSync } = await import(modulePath)

beforeEach(() => {
  fixture.process.platform = 'win32'
  fixture.process.env.npm_execpath = ''
  fixture.files.clear()
  fixture.execute.mockReset()
})

it('runs the Windows npm CLI without interpreting shell characters in paths', () => {
  const cli = 'C:\\Node\\node_modules\\npm\\bin\\npm-cli.js'
  fixture.files.add(cli)
  const args = ['pack', '--pack-destination', 'C:\\Build output & evidence']
  const options = { encoding: 'utf8', cwd: 'C:\\Package with spaces' }
  runPackageManagerSync('npm', args, options)
  expect(fixture.execute).toHaveBeenCalledWith(fixture.process.execPath, [cli, ...args], options)
})

it('uses the pnpm script supplied by its package-script environment', () => {
  const cli = 'C:\\Tools\\pnpm\\bin\\pnpm.cjs'
  fixture.process.env.npm_execpath = cli
  fixture.files.add(cli)
  runPackageManagerSync('pnpm', ['deploy'], {})
  expect(fixture.execute).toHaveBeenCalledWith(fixture.process.execPath, [cli, 'deploy'], {})
})

it('supports standalone pnpm executables without falling back to a cmd shim', () => {
  fixture.process.env.npm_execpath = 'C:\\Tools\\pnpm.cmd'
  fixture.files.add(fixture.process.env.npm_execpath)
  fixture.files.add('C:\\Tools\\pnpm.exe')
  runPackageManagerSync('pnpm', ['deploy'], {})
  expect(fixture.execute).toHaveBeenCalledWith('C:\\Tools\\pnpm.exe', ['deploy'], {})
})

it('fails explicitly when only a Windows cmd shim is available', () => {
  fixture.files.add('C:\\Tools\\pnpm.cmd')
  expect(() => runPackageManagerSync('pnpm', ['deploy'], {})).toThrow('without a shell')
  expect(fixture.execute).not.toHaveBeenCalled()
})

it('preserves existing Unix command resolution', () => {
  fixture.process.platform = 'linux'
  runPackageManagerSync('pnpm', ['deploy'], {})
  expect(fixture.execute).toHaveBeenCalledWith('pnpm', ['deploy'], {})
})
