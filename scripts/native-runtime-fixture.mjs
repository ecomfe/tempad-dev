import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import process from 'node:process'

import { runtimeSourceHash } from '../packages/mcp-server/scripts/runtime-source-hash.mjs'

/** Only the ignored native acceptance plugin may consume this local fixture. */
export function readNativeRuntimeFixture(path, checkout, { allowStaleSource = false } = {}) {
  assert.ok(isAbsolute(path), 'The native fixture descriptor must be absolute.')
  const file = lstatSync(path)
  assert.ok(file.isFile() && !file.isSymbolicLink() && file.uid === process.getuid?.())
  assert.equal(file.mode & 0o077, 0, 'The fixture descriptor must be private.')
  const fixture = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(fixture.version, 1)
  assert.equal(fixture.kind, 'native-runtime-fixture')
  assert.equal(fixture.testOnly, true)
  assert.equal(fixture.checkout, realpathSync(checkout))
  assert.match(fixture.sourceHash, /^[a-f0-9]{64}$/)
  // Teardown must still find an old fixture after the checkout has changed.
  if (!allowStaleSource)
    assert.equal(
      fixture.sourceHash,
      runtimeSourceHash(checkout),
      'Native fixture sources changed; prepare a new fixture before installation or acceptance.'
    )
  assert.ok(isAbsolute(fixture.root))
  assert.equal(fixture.root, realpathSync(fixture.root))
  const root = lstatSync(fixture.root)
  assert.ok(root.isDirectory() && root.uid === process.getuid?.())
  assert.equal(root.mode & 0o077, 0, 'The fixture root must be private.')
  assert.equal(path, join(fixture.root, 'runtime-fixture.json'))
  const registry = new URL(fixture.registryUrl)
  assert.equal(registry.origin, fixture.registryUrl)
  assert.equal(registry.protocol, 'http:')
  assert.equal(registry.hostname, '127.0.0.1')
  assert.ok(Number(registry.port) > 1024, 'The fixture registry must use a local test port.')
  assert.deepEqual(fixture.env, {
    TEMPAD_MCP_RUNTIME_DIR: join(fixture.root, 'run'),
    TEMPAD_MCP_STATE_DIR: join(fixture.root, 'state'),
    TEMPAD_MCP_ASSET_DIR: join(fixture.root, 'assets'),
    TEMPAD_MCP_LOG_DIR: join(fixture.root, 'logs')
  })
  for (const artifact of [fixture.initial, fixture.candidate]) {
    assert.match(artifact.version, /^\d+\.\d+\.\d+$/)
    assert.match(artifact.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/)
    assert.equal(artifact.directory, realpathSync(artifact.directory))
    const inside = relative(fixture.root, artifact.directory)
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside))
    const pkg = JSON.parse(readFileSync(join(artifact.directory, 'package.json'), 'utf8'))
    assert.equal(pkg.name, '@tempad-dev/mcp')
    assert.equal(pkg.version, artifact.version)
    assert.equal(pkg.private, true, 'Native fixtures must not be publishable.')
    assert.equal(pkg.publishConfig.registry, fixture.registryUrl)
  }
  return fixture
}

export function nativeFixtureServer(fixture, toolTimeout) {
  return {
    command: 'node',
    args: [join(fixture.initial.directory, 'dist/cli.mjs'), '--runtime-updates=stable'],
    tool_timeout_sec: toolTimeout,
    env: fixture.env
  }
}

export function nativeFixtureHubEntry(fixture) {
  const path = join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/switch.json')
  if (!existsSync(path)) return join(fixture.initial.directory, 'dist/managed-runtime.mjs')
  const stat = lstatSync(path)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.())
  assert.equal(stat.mode & 0o077, 0)
  const { active } = JSON.parse(readFileSync(path, 'utf8'))
  const expected = [fixture.initial, fixture.candidate].find(
    (artifact) => artifact.version === active.version
  )
  assert.ok(expected, 'The active native fixture version is unknown.')
  const cache = join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/cache')
  const location = relative(cache, active.release.directory)
  assert.ok(location && !location.startsWith('..') && !isAbsolute(location))
  assert.equal(active.entry, join(active.release.directory, 'dist/managed-runtime.mjs'))
  assert.equal(active.entry, realpathSync(active.entry))
  const manifest = readFileSync(join(expected.directory, 'dist/runtime-manifest.json'))
  assert.equal(createHash('sha256').update(manifest).digest('hex'), active.release.manifestHash)
  assert.deepEqual(
    readFileSync(join(active.release.directory, 'dist/runtime-manifest.json')),
    manifest
  )
  return active.entry
}

export function nativeFixtureRuntimeEntries(fixture) {
  const entries = [fixture.initial, fixture.candidate].map((artifact) =>
    join(artifact.directory, 'dist/cli.mjs')
  )
  entries.push(nativeFixtureHubEntry(fixture))
  const config = join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/prototype.json')
  if (existsSync(config)) {
    const { entry } = JSON.parse(readFileSync(config, 'utf8'))
    const inside = relative(join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/cache'), entry)
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside))
    assert.equal(entry, realpathSync(entry))
    entries.push(entry)
  }
  return [...new Set(entries)]
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
