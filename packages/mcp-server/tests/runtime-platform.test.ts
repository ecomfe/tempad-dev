import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer, createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertPrivateEndpoint,
  assertPrivatePath,
  cleanupEndpoint,
  createPrivateTempDirectory,
  ensurePrivateDirectory,
  isPipe,
  protectPipe,
  runtimeEndpoint,
  windowsPowerShellEnvironment
} from '../src/runtime-platform'

const roots: string[] = []
function fixture() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'tp-platform-')))
  roots.push(parent)
  const root = join(parent, 'private')
  ensurePrivateDirectory(root)
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('keeps Unix endpoints and isolates Windows pipes by directory, role and user', () => {
  expect(runtimeEndpoint('/private/run', 'supervisor.sock', 'linux', 'a')).toBe(
    join('/private/run', 'supervisor.sock')
  )
  const pipe = runtimeEndpoint('C:\\private\\run', 'supervisor.sock', 'win32', 'a')
  expect(pipe).toMatch(/^\\\\\.\\pipe\\tempad-runtime-[a-f0-9]{32}$/)
  expect(runtimeEndpoint('c:/private/run', 'supervisor.sock', 'win32', 'a')).toBe(pipe)
  expect(runtimeEndpoint('C:\\private\\run', 'hub.sock', 'win32', 'a')).not.toBe(pipe)
  expect(runtimeEndpoint('C:\\private\\other', 'supervisor.sock', 'win32', 'a')).not.toBe(pipe)
  expect(runtimeEndpoint('C:\\private\\run', 'supervisor.sock', 'win32', 'b')).not.toBe(pipe)
})

it('creates temporary storage with private permissions from its first creation', () => {
  const root = createPrivateTempDirectory('tp-private-')
  roots.push(root)
  expect(() => assertPrivatePath(root, 'directory')).not.toThrow()
})

it('requires canonical private storage and regular files', () => {
  const root = fixture()
  expect(() => ensurePrivateDirectory(root)).not.toThrow()
  expect(() => ensurePrivateDirectory('relative')).toThrow('absolute')
  const path = join(root, 'state.json')
  writeFileSync(path, '{}', { mode: 0o600 })
  expect(() => assertPrivatePath(path, 'file')).not.toThrow()
  expect(() => assertPrivatePath(root, 'file')).toThrow('untrusted')
  expect(() => assertPrivatePath(path, 'directory')).toThrow('untrusted')
  cleanupEndpoint(path)
  expect(() => readFileSync(path)).toThrow()
  expect(isPipe(runtimeEndpoint('C:\\run', 'mcp.sock', 'win32'))).toBe(true)
  expect(() => cleanupEndpoint('\\\\.\\pipe\\tempad-not-a-file')).not.toThrow()
})

describe.skipIf(process.platform === 'win32')('Unix storage', () => {
  it('rejects exposed permissions and symlink aliases', () => {
    const root = fixture()
    const link = join(root, 'link')
    symlinkSync(root, link)
    expect(() => assertPrivatePath(link, 'directory')).toThrow('untrusted')
    chmodSync(root, 0o755)
    expect(() => assertPrivatePath(root, 'directory')).toThrow('untrusted')
  })
})

describe.skipIf(process.platform !== 'win32')('Windows ACLs', () => {
  function powershell(source: string, input: unknown) {
    return execFileSync(
      join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(source, 'utf16le').toString('base64')
      ],
      {
        input: JSON.stringify(input),
        encoding: 'utf8',
        windowsHide: true,
        env: windowsPowerShellEnvironment()
      }
    )
  }

  it('rejects permissive ACLs instead of treating chmod as protection', () => {
    const root = fixture()
    powershell(
      `
      $path = [Console]::In.ReadToEnd() | ConvertFrom-Json
      $acl = Get-Acl -LiteralPath $path
      $everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
      $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Read', 'Allow')))
      Set-Acl -LiteralPath $path -AclObject $acl
    `,
      root
    )
    expect(() => assertPrivatePath(root, 'directory')).toThrow('another account')
    expect(() => ensurePrivateDirectory(root)).toThrow('another account')
  }, 30_000)

  it('protects and verifies live pipe ACLs, including after later accepts', async () => {
    const path = runtimeEndpoint(fixture(), 'control.sock')
    const server = createServer((socket) => socket.end())
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(path, resolve)
      })
      // The default descriptor grants Everyone read, so unprotected pipes are untrusted.
      // Each ACL helper opens an instance. Let Node service its close before the next check.
      const inspect = async (check: () => void) => {
        const closed = new Promise<void>((resolve) => {
          server.once('connection', (socket) => socket.once('close', resolve))
        })
        check()
        await closed
      }
      await inspect(() => expect(() => assertPrivateEndpoint(path)).toThrow('untrusted'))
      await inspect(() => protectPipe(path))
      await inspect(() => assertPrivateEndpoint(path))
      await new Promise<void>((resolve, reject) => {
        createConnection(path)
          .once('error', reject)
          .once('close', () => resolve())
      })
      await inspect(() => assertPrivateEndpoint(path))
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 30_000)

  it('fails closed without the trusted Windows ACL tool', () => {
    const root = fixture()
    const file = join(root, 'unchecked.json')
    writeFileSync(file, '{}')
    vi.stubEnv('SystemRoot', '')
    expect(() => assertPrivatePath(file, 'file')).toThrow('SystemRoot')
  }, 30_000)
})
