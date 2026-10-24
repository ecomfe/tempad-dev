import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const preload = fileURLToPath(new URL('../scripts/runtime-probe-isolation.mjs', import.meta.url))
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function probe(code: string, root?: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', preload, '--input-type=module', '--eval', code],
      {
        env: { PATH: process.env.PATH, ...(root ? { TEMPAD_PROBE_ROOT: root } : {}) },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

it('refuses to run without an explicit absolute Unix measurement root', async () => {
  const result = await probe('throw new Error("should not run")')
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('isolated Unix runtime root')
})

it.skipIf(process.platform === 'win32')(
  'remaps HTTP/WS TCP ports and retains only private IPC listeners',
  async () => {
    const root = await realpath(await mkdtemp('/tmp/tp-i-'))
    roots.push(root)
    const result = await probe(
      `
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    import { createServer } from 'node:net';
    import { createServer as httpServer } from 'node:http';
    for (const server of [createServer(), httpServer()]) {
      await new Promise(resolve => server.listen({ port: 6220, host: '0.0.0.0' }, resolve));
      assert.notEqual(server.address().port, 6220);
      assert.equal(server.address().address, '127.0.0.1');
      await new Promise(resolve => server.close(resolve));
    }
    const local = createServer();
    await new Promise(resolve => local.listen(${JSON.stringify(join(root, 'mcp.sock'))}, resolve));
    await new Promise(resolve => local.close(resolve));
    assert.throws(() => createServer().listen('/tmp/outside-tempad-probe.sock'), /outside/);
    assert.throws(() => createServer().listen({ fd: 4 }), /unrecognized/);
    assert.throws(() => spawn(process.execPath, ['--version']), /own every child process/);
  `,
      root
    )
    expect(result, result.stderr).toMatchObject({ code: 0 })
  }
)
