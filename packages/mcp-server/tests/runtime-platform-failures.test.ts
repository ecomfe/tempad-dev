import { execFileSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({
  lstatSync: vi.fn(),
  realpathSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn()
}))

import {
  assertPrivateEndpoint,
  assertPrivatePath,
  ensurePrivateDirectory,
  protectPipe
} from '../src/runtime-platform'

let revision = 0n
let inode = 1n
const path = resolve('private-runtime-fixture')
beforeEach(() => {
  vi.resetAllMocks()
  revision++
  inode = 1n
  vi.stubGlobal('process', {
    ...process,
    platform: 'win32',
    env: { ...process.env, SystemRoot: resolve('Windows') }
  })
  vi.mocked(realpathSync).mockImplementation((path) => resolve(String(path)))
  vi.mocked(lstatSync).mockImplementation(
    () =>
      ({
        dev: 1n,
        ino: inode,
        birthtimeNs: 1n,
        ctimeNs: revision,
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false
      }) as ReturnType<typeof lstatSync>
  )
})
afterEach(() => vi.unstubAllGlobals())

it('caches unchanged ACLs but rechecks a changed security descriptor', () => {
  assertPrivatePath(path, 'directory')
  assertPrivatePath(path, 'directory')
  expect(execFileSync).toHaveBeenCalledOnce()
  revision++
  assertPrivatePath(path, 'directory')
  expect(execFileSync).toHaveBeenCalledTimes(2)
  expect(vi.mocked(execFileSync).mock.calls[0]?.[2]).toMatchObject({
    env: {
      TEMPAD_RUNTIME_ACL_REQUEST: JSON.stringify({ action: 'inspect', path, kind: 'directory' })
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    windowsHide: true
  })
})

it.each(['PSModulePath', 'PSMODULEPATH', 'psmodulepath'])(
  'does not inherit %s from another PowerShell edition into ACL helpers',
  (key) => {
    process.env[key] = 'PowerShell7/modules'
    process.env.TEMP = resolve('temporary')
    assertPrivatePath(path, 'directory')
    const options = vi.mocked(execFileSync).mock.calls[0]?.[2]
    expect(options?.env).not.toHaveProperty(key)
    expect(options?.env).toMatchObject({
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP
    })
    expect(process.env[key]).toBe('PowerShell7/modules')
  }
)

it('creates missing directories through the ACL helper, without repairing unsafe ones', () => {
  vi.mocked(lstatSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  ensurePrivateDirectory(path)
  expect(vi.mocked(execFileSync).mock.calls[0]?.[2]).toMatchObject({
    env: {
      TEMPAD_RUNTIME_ACL_REQUEST: JSON.stringify({ action: 'ensure', path, kind: 'directory' })
    }
  })
  revision++
  vi.mocked(execFileSync).mockImplementation(() => {
    throw { stderr: JSON.stringify({ message: 'Unexpected owner', code: 5 }) }
  })
  expect(() => ensurePrivateDirectory(path)).toThrow('Unexpected owner')
  expect(execFileSync).toHaveBeenCalledTimes(2)
})

it('rechecks directory changes and caches only a stable private revision', () => {
  vi.mocked(execFileSync).mockImplementationOnce(() => {
    revision++
    return ''
  })
  expect(() => assertPrivatePath(path, 'directory')).not.toThrow()
  expect(execFileSync).toHaveBeenCalledTimes(2)
  assertPrivatePath(path, 'directory')
  expect(execFileSync).toHaveBeenCalledTimes(2)
})

it('allows concurrent directory content changes without caching an unstable ACL check', () => {
  vi.mocked(execFileSync).mockImplementation(() => {
    revision++
    return ''
  })
  expect(() => assertPrivatePath(path, 'directory')).not.toThrow()
  expect(execFileSync).toHaveBeenCalledTimes(2)
  expect(() => assertPrivatePath(path, 'directory')).not.toThrow()
  expect(execFileSync).toHaveBeenCalledTimes(4)
})

it.each([1, 2])('rejects paths replaced during ACL inspection %s', (replacementCheck) => {
  let checks = 0
  vi.mocked(execFileSync).mockImplementation(() => {
    revision++
    if (++checks === replacementCheck) inode++
    return ''
  })
  expect(() => assertPrivatePath(path, 'directory')).toThrow('changed during its permission check')
  expect(execFileSync).toHaveBeenCalledTimes(replacementCheck)
})

it('rejects an unsafe ACL discovered after the revision changes', () => {
  vi.mocked(execFileSync)
    .mockImplementationOnce(() => {
      revision++
      return ''
    })
    .mockImplementation(() => {
      throw { stderr: JSON.stringify({ message: 'ACL grants another account access.', code: 5 }) }
    })
  expect(() => assertPrivatePath(path, 'directory')).toThrow('another account')
  expect(execFileSync).toHaveBeenCalledTimes(2)
  expect(() => assertPrivatePath(path, 'directory')).toThrow('another account')
  expect(execFileSync).toHaveBeenCalledTimes(3)
})

it.each([
  [2, 'ENOENT'],
  [3, 'ENOENT'],
  [231, 'EBUSY'],
  ['EPIPEUNPROTECTED', 'EPIPEUNPROTECTED'],
  [5, 'EPIPEUNTRUSTED']
])('classifies Windows pipe failure %s without accepting it', (nativeCode, code) => {
  vi.mocked(execFileSync).mockImplementation(() => {
    throw { stderr: JSON.stringify({ message: 'denied', code: nativeCode }) }
  })
  expect(() => assertPrivateEndpoint('\\\\.\\pipe\\test')).toThrow('denied')
  try {
    assertPrivateEndpoint('\\\\.\\pipe\\test')
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe(code)
  }
})

it('fails closed for helper startup, timeout and configuration failures', () => {
  vi.mocked(execFileSync).mockImplementation(() => {
    throw Object.assign(new Error('timed out'), { stderr: 'helper timed out' })
  })
  expect(() => protectPipe('\\\\.\\pipe\\test')).toThrow('helper timed out')
  expect(() => protectPipe(path)).toThrow('Expected a Windows runtime pipe')
  process.env.SystemRoot = ''
  expect(() => assertPrivatePath(path, 'directory')).toThrow('SystemRoot')
})
