import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import {
  nativeFixtureHubEntry,
  nativeFixtureRuntimeEntries,
  nativeFixtureServer,
  readNativeRuntimeFixture,
  shellQuote,
  type NativeRuntimeFixture
} from '../../../../scripts/native-runtime-fixture.mjs'

const { runtimeSourceHash } = await import(
  new URL('../../../../packages/mcp-server/scripts/runtime-source-hash.mjs', import.meta.url).href
)

let root: string
const write = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
}
function descriptor(): NativeRuntimeFixture {
  const registryUrl = 'http://127.0.0.1:34567'
  const artifacts = ['0.12.0', '0.12.1'].map((version) => {
    const directory = join(root, version)
    write(join(directory, 'package.json'), {
      name: '@tempad-dev/mcp',
      version,
      private: true,
      publishConfig: { registry: registryUrl }
    })
    return { version, directory, integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }
  })
  return {
    version: 1,
    kind: 'native-runtime-fixture',
    testOnly: true,
    checkout: root,
    sourceHash: runtimeSourceHash(root),
    root,
    registryUrl,
    env: {
      TEMPAD_MCP_RUNTIME_DIR: join(root, 'run'),
      TEMPAD_MCP_STATE_DIR: join(root, 'state'),
      TEMPAD_MCP_ASSET_DIR: join(root, 'assets'),
      TEMPAD_MCP_LOG_DIR: join(root, 'logs')
    },
    initial: artifacts[0]!,
    candidate: artifacts[1]!
  }
}
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-native-test-')))
  for (const path of [
    'packages/mcp-server/package.json',
    'packages/mcp-server/tsdown.config.ts',
    'packages/mcp-server/scripts/runtime-contract.mjs',
    'packages/mcp-server/src/probe.ts',
    'packages/shared/src/probe.ts',
    'pnpm-lock.yaml'
  ])
    write(join(root, path), 'source fixture')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('uses one private release-test namespace without inheriting host or checkout overrides', () => {
  const fixture = descriptor()
  const path = join(root, 'runtime-fixture.json')
  write(path, fixture)
  expect(readNativeRuntimeFixture(path, root)).toEqual(fixture)
  expect(nativeFixtureServer(fixture, 300)).toEqual({
    command: 'node',
    args: [join(fixture.initial.directory, 'dist/cli.mjs'), '--runtime-updates=stable'],
    tool_timeout_sec: 300,
    env: fixture.env
  })
  expect(nativeFixtureHubEntry(fixture)).toBe(
    join(fixture.initial.directory, 'dist/managed-runtime.mjs')
  )
  expect(shellQuote("/test/user's runtime")).toBe("'/test/user'\\''s runtime'")
})

it.each(['registry', 'environment', 'checkout', 'permissions', 'publishable'])(
  'rejects unsafe native fixture %s before changing the generated plugin',
  (reason) => {
    const fixture = descriptor()
    const path = join(root, 'runtime-fixture.json')
    if (reason === 'registry') fixture.registryUrl = 'https://registry.npmjs.org'
    if (reason === 'environment') fixture.env.TEMPAD_MCP_STATE_DIR = '/tmp/shared-state'
    if (reason === 'checkout') fixture.checkout = '/different-checkout'
    if (reason === 'publishable')
      write(join(fixture.initial.directory, 'package.json'), {
        name: '@tempad-dev/mcp',
        version: fixture.initial.version,
        private: false,
        publishConfig: { registry: fixture.registryUrl }
      })
    write(path, fixture)
    if (reason === 'permissions') chmodSync(path, 0o644)
    expect(() => readNativeRuntimeFixture(path, root)).toThrow()
  }
)

it('rejects stale source evidence while allowing teardown of the old fixture', () => {
  const fixture = descriptor()
  const path = join(root, 'runtime-fixture.json')
  write(path, fixture)
  write(join(root, 'packages/mcp-server/src/probe.ts'), 'changed source')
  expect(() => readNativeRuntimeFixture(path, root)).toThrow(/Native fixture sources changed/)
  expect(readNativeRuntimeFixture(path, root, { allowStaleSource: true })).toEqual(fixture)
})

it('recognizes the verified replacement Hub without confusing it with the retained supervisor', () => {
  const fixture = descriptor()
  const directory = join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/cache/b/package')
  const entry = join(directory, 'dist/managed-runtime.mjs')
  write(entry, 'fixture')
  const manifest = { fixture: 'B' }
  write(join(fixture.candidate.directory, 'dist/runtime-manifest.json'), manifest)
  write(join(directory, 'dist/runtime-manifest.json'), manifest)
  const active = {
    version: fixture.candidate.version,
    entry,
    release: {
      directory,
      manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    }
  }
  const journal = join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/switch.json')
  write(journal, { active })
  expect(nativeFixtureHubEntry(fixture)).toBe(entry)
  write(join(fixture.env.TEMPAD_MCP_STATE_DIR, 'runtime/prototype.json'), { entry })
  expect(nativeFixtureRuntimeEntries(fixture)).toEqual([
    join(fixture.initial.directory, 'dist/cli.mjs'),
    join(fixture.candidate.directory, 'dist/cli.mjs'),
    entry
  ])
  write(journal, { active: { ...active, version: '99.0.0' } })
  expect(() => nativeFixtureHubEntry(fixture)).toThrow(/unknown/)
  write(journal, { active })
  write(join(directory, 'dist/runtime-manifest.json'), { fixture: 'changed' })
  expect(() => nativeFixtureHubEntry(fixture)).toThrow()
})
