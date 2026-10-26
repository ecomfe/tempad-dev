import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { execFileSync, spawn } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer, createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// Keep real child processes while allowing the disappearance test to intercept
// the helper launch; native ESM module namespace properties are not configurable.
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>())
}))

import {
  assertPrivateEndpoint,
  assertPrivatePath,
  assertPrivatePathAsync,
  cleanupEndpoint,
  createPrivateTempDirectory,
  ensurePrivateDirectory,
  isPipe,
  protectPipe,
  runtimeEndpoint,
  windowsPowerShellEnvironment
} from '../src/runtime-platform'
import { HubControl, LeaseSchema } from '../src/runtime-prototype/hub-control'
import { ControlPeer, LEASE_MS, RENEW_MS, SocketTransport } from '../src/runtime-prototype/protocol'
import { readPrivateJson } from '../src/runtime-prototype/state'

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
  it('keeps a real control lease alive during a native ACL check longer than the lease', async () => {
    const path = join(fixture(), 'heartbeat.json')
    writeFileSync(path, '{}')
    const control = new HubControl('secret')
    const server = createServer((socket) => void control.attach(socket))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const peer = new ControlPeer()
    const socket = createConnection((server.address() as { port: number }).port, '127.0.0.1')
    const execute = childProcess.execFile
    const helper = vi.spyOn(childProcess, 'execFile').mockImplementationOnce((...args) => {
      const command = [...(args[1] as string[])]
      const index = command.indexOf('-EncodedCommand') + 1
      const script = Buffer.from(command[index]!, 'base64').toString('utf16le')
      command[index] = Buffer.from(
        script.replace('$request = ', `[Threading.Thread]::Sleep(${LEASE_MS + 500}); $request = `),
        'utf16le'
      ).toString('base64')
      return Reflect.apply(execute, childProcess, [args[0], command, ...args.slice(2)])
    })
    let timer: ReturnType<typeof setInterval> | undefined
    const renewals: Promise<unknown>[] = []
    try {
      await peer.connect(new SocketTransport(socket))
      await peer.request(
        { method: 'tempad/runtime-acquire', params: { secret: 'secret', versions: [2] } },
        LeaseSchema
      )
      timer = setInterval(() => {
        const renewal = peer.request({ method: 'tempad/runtime-renew' }, ResultSchema)
        void renewal.catch(() => {})
        renewals.push(renewal)
      }, RENEW_MS)
      await assertPrivatePathAsync(path, 'file')
      await Promise.all(renewals)
      expect(renewals.length).toBeGreaterThanOrEqual(5)
      expect(control.available()).toBe(true)
      expect(helper).toHaveBeenCalledOnce()
    } finally {
      clearInterval(timer)
      helper.mockRestore()
      await peer.close()
      await control.close()
      socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 30_000)

  it('revalidates a snapshot replaced after the native ACL helper returns', () => {
    const path = join(fixture(), 'switch.json')
    writeFileSync(path, '{"revision":1}')
    const execute = childProcess.execFileSync
    const helper = vi.spyOn(childProcess, 'execFileSync').mockImplementationOnce((...args) => {
      const result = Reflect.apply(execute, childProcess, args)
      writeFileSync(`${path}.tmp`, '{"revision":2}')
      renameSync(`${path}.tmp`, path)
      return result
    })
    try {
      expect(readPrivateJson(path, z.object({ revision: z.number() }))).toEqual({ revision: 2 })
      expect(helper).toHaveBeenCalledTimes(2)
    } finally {
      helper.mockRestore()
    }
  }, 30_000)

  it.each(['file', 'directory'] as const)(
    'preserves ENOENT when a %s disappears before its ACL inspection',
    (kind) => {
      const path = join(fixture(), 'vanishing')
      if (kind === 'file') writeFileSync(path, '{}')
      else mkdirSync(path)
      const execute = childProcess.execFileSync
      const helper = vi.spyOn(childProcess, 'execFileSync').mockImplementationOnce((...args) => {
        rmSync(path, { recursive: true })
        return Reflect.apply(execute, childProcess, args)
      })
      try {
        expect(() => assertPrivatePath(path, kind)).toThrowError(
          expect.objectContaining({ code: 'ENOENT' })
        )
        expect(helper).toHaveBeenCalledOnce()
      } finally {
        helper.mockRestore()
      }
    },
    30_000
  )

  it.each([
    ['original full environment', true, false, false],
    ['SDK and platform environment', false, false, false],
    ['isolated home only', false, true, false],
    ['isolated temp only', false, false, true],
    ['isolated home and temp', false, true, true]
  ] as const)(
    'verifies Unicode storage with open MCP stdin: %s',
    async (name, inheritAll, isolateHome, isolateTemp) => {
      const root = fixture()
      const { getDefaultEnvironment } = await import('@modelcontextprotocol/sdk/client/stdio.js')
      const helperPath = '../scripts/runtime-test-platform.mjs'
      const { fixtureEnvironment } = await import(helperPath)
      const home = join(root, 'home-设计-é')
      ensurePrivateDirectory(home)
      const isolated = fixtureEnvironment(home, root)
      const inheritedPlatform = Object.fromEntries(
        Object.keys(isolated).flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]]]
        )
      )
      const env = inheritAll
        ? { ...process.env }
        : { ...getDefaultEnvironment(), ...inheritedPlatform }
      if (isolateHome) Object.assign(env, { HOME: home, USERPROFILE: home })
      if (isolateTemp) Object.assign(env, { TMPDIR: root, TEMP: root, TMP: root })
      const source = `
      process.stderr.write('permission probe: started\\n');
      const { assertPrivatePath } = await import(${JSON.stringify(new URL('../src/runtime-platform.ts', import.meta.url).href)});
      process.stderr.write('permission probe: imported\\n');
      assertPrivatePath(process.argv[1], 'directory');
      process.stdout.write('verified');
    `
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, home], {
        env,
        timeout: 25_000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      try {
        // A real host keeps this pipe open for future JSON-RPC messages.
        child.stdin.write('{"jsonrpc":"2.0","method":"initialize","id":1}\n')
        const [code] = await once(child, 'close')
        expect(code, `${name}: ${stderr}`).toBe(0)
        expect(stdout).toBe('verified')
      } finally {
        child.stdin.destroy()
        if (child.exitCode === null) child.kill()
      }
    },
    30_000
  )

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
      await inspect(() =>
        expect(() => assertPrivateEndpoint(path)).toThrowError(
          expect.objectContaining({ code: 'EPIPEUNPROTECTED' })
        )
      )
      await inspect(() => protectPipe(path))
      await inspect(() => assertPrivateEndpoint(path))
      await new Promise<void>((resolve, reject) => {
        createConnection(path)
          .once('error', reject)
          .once('close', () => resolve())
      })
      await inspect(() => assertPrivateEndpoint(path))
      for (const [extraRule, includeUser] of [
        ['(A;;GW;;;WD)', true],
        ['(A;;GR;;;AU)', true],
        ['', false]
      ] as const) {
        await inspect(() =>
          powershell(
            `
            $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
            $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            $rights = [System.IO.Pipes.PipeAccessRights]'ReadData,ReadPermissions,ChangePermissions'
            $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $request.name, $rights,
              [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::Anonymous,
              [System.IO.HandleInheritability]::None)
            try {
              $pipe.Connect(1000)
              $security = $pipe.GetAccessControl()
              $sddl = 'D:P(A;;GA;;;SY)(A;;GA;;;BA)'
              if ($request.includeUser) { $sddl += '(A;;GA;;;' + $user + ')' }
              $security.SetSecurityDescriptorSddlForm($sddl + $request.extraRule,
                [System.Security.AccessControl.AccessControlSections]::Access)
              $pipe.SetAccessControl($security)
            } finally { $pipe.Dispose() }
          `,
            { name: path.slice('\\\\.\\pipe\\'.length), extraRule, includeUser }
          )
        )
        await inspect(() =>
          expect(() => assertPrivateEndpoint(path)).toThrowError(
            expect.objectContaining({ code: 'EPIPEUNTRUSTED' })
          )
        )
      }
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
