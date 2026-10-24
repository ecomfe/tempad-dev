import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  checkoutProfile,
  resolveRuntimeProfile,
  runtimeDirectories,
  runtimeSocketPath
} from '../../../agent-plugin/src/clients/shared/runtime-profile.mjs'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-profile-')))
function checkout(name: string) {
  const path = join(root, name)
  mkdirSync(join(path, 'packages/mcp-server/dist'), { recursive: true })
  for (const file of ['cli.mjs', 'hub.mjs'])
    writeFileSync(join(path, 'packages/mcp-server/dist', file), '')
  return path
}
const first = checkout('first')
const second = checkout('second')
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('runtime profiles', () => {
  it('keeps all release launches in one namespace regardless of launch update policy', () => {
    expect(resolveRuntimeProfile({})).toEqual({ kind: 'release' })
    const paths = runtimeDirectories({}, undefined, { tmpdir: root, homedir: root })
    expect(paths.runtime).toBe(join(root, 'tempad-dev/run'))
    expect(paths.state).toBe(join(root, '.tempad-dev/state'))
    expect(runtimeSocketPath(paths.runtime, undefined, 'win32')).toBe('\\\\.\\pipe\\tempad-mcp')
  })

  it('isolates two checkouts and all explicit directory overrides from release', () => {
    const overrides = Object.fromEntries(
      ['RUNTIME', 'LOG', 'ASSET', 'STATE'].map((key) => [`TEMPAD_MCP_${key}_DIR`, join(root, key)])
    )
    const release = runtimeDirectories(overrides)
    const a = runtimeDirectories({ ...overrides, TEMPAD_MCP_DEV_CHECKOUT: first })
    const b = runtimeDirectories({ ...overrides, TEMPAD_MCP_DEV_CHECKOUT: second })
    for (const key of ['runtime', 'log', 'assets', 'state'] as const) {
      expect(new Set([release[key], a[key], b[key]]).size).toBe(3)
      expect(a[key]).toBe(join(release[key], `checkout-${checkoutProfile(first).id}`))
    }
    expect(a.root).toBeUndefined()
  })

  it('treats an empty checkout state override as unset without changing release behavior', () => {
    const env = {
      TEMPAD_MCP_RUNTIME_DIR: join(root, 'run'),
      TEMPAD_MCP_LOG_DIR: join(root, 'log'),
      TEMPAD_MCP_ASSET_DIR: join(root, 'assets'),
      TEMPAD_MCP_STATE_DIR: ''
    }
    expect(runtimeDirectories(env).state).toBe('')
    const paths = runtimeDirectories({ ...env, TEMPAD_MCP_DEV_CHECKOUT: first })
    expect(paths.state).toBe(join(paths.runtime, 'state'))
    expect(
      runtimeDirectories({ TEMPAD_MCP_DEV_CHECKOUT: first, TEMPAD_MCP_STATE_DIR: '' }, undefined, {
        homedir: root
      }).state
    ).toBe(join(root, '.tempad-dev/checkouts', checkoutProfile(first).id, 'state'))
  })

  it('keeps default checkout stores durable and runtime roots independent of the legacy root', () => {
    const env = { TEMPAD_MCP_DEV_CHECKOUT: first }
    const profile = checkoutProfile(first)
    const paths = runtimeDirectories(env, profile, { tmpdir: root, homedir: root, uid: 17 })
    expect(paths.runtime).toBe(join(root, `tpd-17-${profile.id}/run`))
    expect(paths.state).toBe(join(root, `.tempad-dev/checkouts/${profile.id}/state`))
    expect(runtimeDirectories({ ...env, TEMPAD_MCP_RUNTIME_DIR: root }).state).toBe(
      join(root, `checkout-${profile.id}/state`)
    )
    expect(runtimeSocketPath('/tmp/short', profile, 'darwin')).toBe('/tmp/short/mcp.sock')
    expect(() => runtimeSocketPath('/' + '界'.repeat(40), profile, 'darwin')).toThrow(
      'shorter TEMPAD_MCP_RUNTIME_DIR'
    )
  })

  it('names Windows checkout pipes by user and checkout, not directory overrides', () => {
    const profiles = [checkoutProfile(first), checkoutProfile(second)]
    const homes = ['C:\\Users\\alice', 'C:\\Users\\bob']
    const pipes = profiles.flatMap((profile) =>
      homes.map((home) => runtimeSocketPath('C:\\runtime-a', profile, 'win32', home))
    )
    expect(new Set(pipes).size).toBe(4)
    for (const pipe of pipes) expect(pipe).toMatch(/tempad-mcp-[a-f0-9]{16}-[a-f0-9]{16}$/)
    for (const home of homes) {
      expect(runtimeSocketPath('C:\\runtime-a', undefined, 'win32', home)).toBe(
        '\\\\.\\pipe\\tempad-mcp'
      )
      expect(runtimeSocketPath('C:\\runtime-b', profiles[0], 'win32', home)).toBe(
        runtimeSocketPath('C:\\runtime-a', profiles[0], 'win32', home)
      )
    }
  })

  it('uses the real checkout identity across symlink launches', () => {
    const link = join(root, 'alias')
    symlinkSync(first, link, 'junction')
    expect(checkoutProfile(link)).toEqual(checkoutProfile(first))
    const entry = pathToFileURL(join(link, 'packages/mcp-server/dist/cli.mjs'))
    expect(resolveRuntimeProfile({ TEMPAD_MCP_DEV_CHECKOUT: link }, entry)).toEqual(
      checkoutProfile(first)
    )
  })

  it('rejects relative, empty, missing, incomplete and conflicting checkout inputs', () => {
    for (const path of ['', '.', join(root, 'missing')])
      expect(() => checkoutProfile(path)).toThrow()
    expect(() => checkoutProfile(join(first, 'packages/mcp-server/dist/cli.mjs'))).toThrow(
      'directory'
    )
    const entry = pathToFileURL(join(first, 'packages/mcp-server/dist/cli.mjs'))
    expect(() => resolveRuntimeProfile({ TEMPAD_MCP_DEV_CHECKOUT: second }, entry)).toThrow(
      'does not belong'
    )
    const incomplete = join(root, 'incomplete')
    mkdirSync(incomplete)
    expect(() => resolveRuntimeProfile({ TEMPAD_MCP_DEV_CHECKOUT: incomplete }, entry)).toThrow()
  })

  it.each(['directory', 'symlink'] as const)(
    'rejects a %s in place of the checkout Hub bundle',
    (kind) => {
      const path = checkout(kind)
      const hub = join(path, 'packages/mcp-server/dist/hub.mjs')
      rmSync(hub)
      if (kind === 'directory') mkdirSync(hub)
      else symlinkSync(join(first, 'packages/mcp-server/dist/hub.mjs'), hub)
      expect(() =>
        resolveRuntimeProfile(
          { TEMPAD_MCP_DEV_CHECKOUT: path },
          pathToFileURL(join(path, 'packages/mcp-server/dist/cli.mjs'))
        )
      ).toThrow('Invalid checkout runtime')
    }
  )
})
