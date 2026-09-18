import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { describe, expect, it } from 'vitest'

import {
  getExtensionRuntimeIssues,
  createHubRuntimeIdentity,
  readHubRuntimeIdentity,
  removeHubRuntimeIdentityIfOwned,
  writeHubRuntimeIdentity
} from '../src/runtime-identity'

describe('runtime identity', () => {
  it('publishes, reads, and owner-removes an atomic Hub identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tempad-runtime-identity-'))
    const entryPath = join(directory, 'hub.mjs')
    const identityPath = join(directory, 'hub-runtime.json')
    writeFileSync(entryPath, 'export const cohort = 1\n')
    const extensionFingerprint = 'a'.repeat(64)
    const identity = createHubRuntimeIdentity(entryPath, '0.8.0', {
      now: new Date('2026-08-26T00:00:00.000Z'),
      processId: 42
    })

    writeHubRuntimeIdentity(identityPath, identity)
    expect(readHubRuntimeIdentity(identityPath)).toEqual(identity)
    expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(identity)

    const legacyIdentity = JSON.parse(JSON.stringify(identity)) as Record<string, unknown>
    delete legacyIdentity.activeExtension
    writeFileSync(identityPath, JSON.stringify(legacyIdentity))
    expect(readHubRuntimeIdentity(identityPath)).toEqual({ ...identity, activeExtension: null })

    identity.activeExtension = {
      id: 'extension-1',
      connectedAt: '2026-08-26T00:01:00.000Z',
      version: '0.21.0',
      fingerprint: extensionFingerprint
    }
    writeHubRuntimeIdentity(identityPath, identity)
    expect(readHubRuntimeIdentity(identityPath)?.activeExtension).toEqual(identity.activeExtension)
    removeHubRuntimeIdentityIfOwned(identityPath, 7)
    expect(readHubRuntimeIdentity(identityPath)).toEqual(identity)
    removeHubRuntimeIdentityIfOwned(identityPath, 42)
    expect(readHubRuntimeIdentity(identityPath)).toBeNull()
  })

  it('requires a handshake without pinning the extension fingerprint to Hub startup', () => {
    expect(getExtensionRuntimeIssues(undefined)).toEqual([
      'Extension did not publish a runtime identity handshake'
    ])
    for (const fingerprint of ['c'.repeat(64), 'd'.repeat(64)]) {
      expect(getExtensionRuntimeIssues({ version: '0.21.0', fingerprint })).toEqual([])
    }
  })
})

// Use only a private test socket and runtime directory; never attach to the desktop Hub.
it.skipIf(process.platform === 'win32')(
  'bridges to an existing Hub despite a different build and package version',
  async () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url))
    const bundleDir = mkdtempSync(join(packageRoot, 'node_modules/.tempad-cli-test-'))
    const runtimeDir = mkdtempSync(join(tmpdir(), 'tempad-cli-test-'))
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      let pending = ''
      socket.on('data', (chunk) => {
        pending += String(chunk)
        let end: number
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end)
          pending = pending.slice(end + 1)
          if (JSON.parse(line).method === 'ping') socket.write(line + '\n')
        }
      })
    })
    let child: ReturnType<typeof spawn> | undefined
    try {
      await build({
        config: false,
        cwd: packageRoot,
        entry: ['src/cli.ts'],
        outDir: bundleDir,
        format: ['esm'],
        platform: 'node',
        target: 'node22',
        dts: false,
        logLevel: 'silent'
      })
      const hubPath = join(bundleDir, 'hub.mjs')
      writeFileSync(hubPath, 'old Hub build')
      const identity = createHubRuntimeIdentity(hubPath, '0.0.0', { processId: 42 })
      const identityPath = join(runtimeDir, 'hub-runtime.json')
      writeHubRuntimeIdentity(identityPath, identity)
      writeFileSync(hubPath, 'new Hub build')
      server.listen(join(runtimeDir, 'mcp.sock'))
      await once(server, 'listening')

      child = spawn(process.execPath, [join(bundleDir, 'cli.mjs')], {
        cwd: packageRoot,
        env: {
          ...process.env,
          TEMPAD_MCP_RUNTIME_DIR: runtimeDir,
          TEMPAD_MCP_LOG_DIR: join(runtimeDir, 'logs'),
          TEMPAD_MCP_ASSET_DIR: join(runtimeDir, 'assets')
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const message = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n'
      const output = new Promise<string>((resolve, reject) => {
        let received = ''
        let stderr = ''
        child!.stderr!.on('data', (chunk) => {
          stderr += String(chunk)
        })
        child!.once('error', reject)
        child!.once('exit', (code) => reject(new Error(`CLI exited ${code}: ${stderr}`)))
        child!.stdout!.on('data', (chunk) => {
          received += String(chunk)
          if (received.endsWith('\n')) resolve(received)
        })
      })
      child.stdin!.write(message)
      expect(await output).toBe(message)
      expect(readHubRuntimeIdentity(identityPath)).toEqual(identity)
      child.stdin!.end()
      const [code] = await once(child, 'exit')
      expect(code).toBe(0)
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
      sockets.forEach((socket) => socket.destroy())
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(runtimeDir, { recursive: true, force: true })
      rmSync(bundleDir, { recursive: true, force: true })
    }
  },
  15_000
)
