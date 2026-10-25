import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const modulePath = '../scripts/runtime-test-platform.mjs'
const {
  commandArguments,
  fixtureEnvironment,
  fixtureProcesses,
  preserveFixtureEvidence,
  processInventory
} = await import(modulePath)
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const temporaryDirectories: string[] = []

function windowsEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]))
}

afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('runtime process fixture platform', () => {
  it('copies bounded runtime records before cleanup without bundling installed packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tp-evidence-'))
    temporaryDirectories.push(root)
    const fixture = join(root, 'fixture')
    const evidence = join(root, 'evidence')
    const records = {
      'supervisor.json': '{"pid":42}',
      'state/runtime/switch.json': '{"phase":"preparing"}',
      'run/hub-runtime.json': '{"processId":43}',
      'log/hub.log': 'starting',
      'auto/state/design-tasks.json': '{}',
      'node_modules/package/package.json': '{}',
      'state/runtime/cache/package.json': '{}'
    }
    for (const [path, content] of Object.entries(records)) {
      const target = join(fixture, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    await writeFile(join(fixture, 'log/large.log'), Buffer.alloc(2 * 1024 * 1024 + 1))
    vi.stubEnv('TEMPAD_RUNTIME_EVIDENCE_DIR', evidence)
    await preserveFixtureEvidence(fixture, 'request timed out')
    const copied = join(evidence, basename(fixture))
    expect(await readFile(join(copied, 'failure.txt'), 'utf8')).toContain('request timed out')
    for (const [path, content] of Object.entries(records)) {
      const actual = readFile(join(copied, path), 'utf8')
      if (path.includes('node_modules') || path.includes('cache'))
        await expect(actual).rejects.toThrow()
      else expect(await actual).toBe(content)
    }
    await expect(readFile(join(copied, 'log/large.log'))).rejects.toThrow()
  })

  it.each(['PSModulePath', 'psmodulepath', 'PsMoDuLePaTh'])(
    'lets Windows PowerShell choose its own modules instead of inheriting %s',
    (key) => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      vi.stubEnv('SystemRoot', 'C:\\Windows')
      vi.stubEnv('TEMP', 'C:\\fixture-temp')
      vi.stubEnv(key, 'C:\\PowerShell7\\Modules')
      vi.mocked(execFileSync).mockReturnValue('[]')
      expect(processInventory()).toEqual([])
      const options = vi.mocked(execFileSync).mock.calls[0]![2]!
      expect(windowsEnvironment(options.env!)).toMatchObject({
        SYSTEMROOT: 'C:\\Windows',
        TEMP: 'C:\\fixture-temp'
      })
      expect(Object.keys(options.env!).some((name) => name.toLowerCase() === 'psmodulepath')).toBe(
        false
      )
    }
  )

  it('retains platform discovery variables without inheriting host identity', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    vi.stubEnv('PROGRAMFILES', 'C:\\Program Files')
    vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)')
    vi.stubEnv('SystemDrive', 'C:')
    vi.stubEnv('CODEX_THREAD_ID', 'unrelated-task')
    vi.stubEnv('TEMPAD_MCP_DEV_CHECKOUT', '/unrelated-checkout')
    const env = fixtureEnvironment('/private-home', '/private-temp')
    expect(windowsEnvironment(env)).toMatchObject({
      SYSTEMROOT: 'C:\\Windows',
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      SYSTEMDRIVE: 'C:',
      HOME: '/private-home',
      USERPROFILE: '/private-home',
      TMPDIR: '/private-temp',
      TEMP: '/private-temp',
      TMP: '/private-temp'
    })
    expect(env).not.toHaveProperty('CODEX_THREAD_ID')
    expect(env).not.toHaveProperty('TEMPAD_MCP_DEV_CHECKOUT')
  })

  it('matches the exact fixture root and executable argument with Windows quoting', () => {
    const root = 'C:\\fixture root\\run'
    const entry = 'C:\\fixture root\\runtime.mjs'
    const commands = [
      { pid: 41, command: `"C:\\Program Files\\node.exe" "${entry}" --root "${root}" --role hub` },
      { pid: 42, command: `node "${entry}" --root "${root}-other" --role hub` },
      { pid: 43, command: `node C:\\other.mjs --root "${root}" --role hub` },
      { pid: 44, command: `node "${entry}-other" --root "${root}" --role hub` }
    ]
    vi.mocked(execFileSync).mockReturnValue(
      process.platform === 'win32'
        ? JSON.stringify(commands)
        : commands.map(({ pid, command }) => `${pid} ${command}`).join('\n')
    )
    expect(commandArguments(commands[0]!.command)).toEqual([
      'C:\\Program Files\\node.exe',
      entry,
      '--root',
      root,
      '--role',
      'hub'
    ])
    expect(fixtureProcesses(root, entry)).toEqual([commands[0]])
  })
})
