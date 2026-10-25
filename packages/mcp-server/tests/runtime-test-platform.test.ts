import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const modulePath = '../scripts/runtime-test-platform.mjs'
const { commandArguments, fixtureEnvironment, fixtureProcesses, processInventory } = await import(
  modulePath
)
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

function windowsEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]))
}

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('runtime process fixture platform', () => {
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
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    vi.stubEnv('CODEX_THREAD_ID', 'unrelated-task')
    vi.stubEnv('TEMPAD_MCP_DEV_CHECKOUT', '/unrelated-checkout')
    const env = fixtureEnvironment('/private-home', '/private-temp')
    expect(windowsEnvironment(env)).toMatchObject({
      SYSTEMROOT: 'C:\\Windows',
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
