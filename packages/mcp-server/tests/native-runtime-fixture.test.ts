import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MCP_PORT_CANDIDATES } from '../../shared/src/mcp/constants'

const sockets = vi.hoisted(() => ({
  occupied: 0,
  opened: [] as number[],
  closed: [] as number[]
}))
vi.mock('node:net', () => ({
  createServer: () => {
    let onError: (error: Error) => void
    let port: number
    return {
      once: (_event: string, callback: (error: Error) => void) => {
        onError = callback
      },
      listen: (
        options: { port: number; host: string; exclusive: boolean },
        callback: () => void
      ) => {
        expect(options.host).toBe('127.0.0.1')
        expect(options.exclusive).toBe(true)
        port = options.port
        if (port === sockets.occupied) onError(new Error('EADDRINUSE'))
        else {
          sockets.opened.push(port)
          callback()
        }
      },
      close: (callback: () => void) => {
        sockets.closed.push(port)
        callback()
      }
    }
  }
}))

const modulePath = '../scripts/native-runtime-fixture.mjs'
const { fixtureEnvironment, validateFixture, fixtureResponse, assertReleasePortsFree } =
  await import(modulePath)

function descriptor() {
  const root = '/tmp/tp-native-fixture-test'
  const release = (version: string) => ({
    version,
    directory: join(root, 'packages', version),
    archive: join(root, 'archives', `mcp-${version}.tgz`),
    integrity: `sha512-${'A'.repeat(86)}==`
  })
  return {
    version: 1,
    kind: 'native-runtime-fixture',
    testOnly: true,
    checkout: '/checkout',
    root,
    sourceHash: 'a'.repeat(64),
    registryUrl: 'http://127.0.0.1:48273',
    releasePorts: MCP_PORT_CANDIDATES,
    env: fixtureEnvironment(root),
    initial: release('0.12.0'),
    candidate: release('0.12.1')
  }
}

describe('native runtime fixture isolation', () => {
  beforeEach(() => {
    sockets.occupied = 0
    sockets.opened = []
    sockets.closed = []
  })

  it('keeps all runtime directories private without supplying host identity', () => {
    const fixture = descriptor()
    expect(validateFixture(fixture, fixture.root)).toBe(fixture)
    expect(fixture.env).toEqual({
      TEMPAD_MCP_RUNTIME_DIR: `${fixture.root}/run`,
      TEMPAD_MCP_STATE_DIR: `${fixture.root}/state`,
      TEMPAD_MCP_ASSET_DIR: `${fixture.root}/assets`,
      TEMPAD_MCP_LOG_DIR: `${fixture.root}/logs`
    })
  })

  it.each([
    'https://registry.npmjs.org',
    'http://localhost:48273',
    'http://127.0.0.1:6220',
    'http://127.0.0.1:48273/path',
    'http://user@127.0.0.1:48273'
  ])('rejects a registry outside its dedicated loopback origin: %s', (registryUrl) => {
    const fixture = { ...descriptor(), registryUrl }
    expect(() => validateFixture(fixture, fixture.root)).toThrow()
  })

  it('rejects escaped artifact paths, state directories, host identity, or changed release ports', () => {
    const cases = [
      (value: ReturnType<typeof descriptor>) => {
        value.initial.directory = '/outside'
      },
      (value: ReturnType<typeof descriptor>) => {
        value.candidate.archive = '/outside.tgz'
      },
      (value: ReturnType<typeof descriptor>) => {
        value.env.TEMPAD_MCP_STATE_DIR = '/outside'
      },
      (value: ReturnType<typeof descriptor>) => {
        value.env.CODEX_THREAD_ID = 'spoofed'
      },
      (value: ReturnType<typeof descriptor>) => {
        value.releasePorts = [0]
      },
      (value: ReturnType<typeof descriptor>) => {
        value.testOnly = false
      }
    ]
    for (const change of cases) {
      const fixture = descriptor()
      change(fixture)
      expect(() => validateFixture(fixture, fixture.root)).toThrow()
    }
  })

  it('serves only the exact fixture versions and publishes the candidate as latest', () => {
    const fixture = descriptor()
    expect(fixtureResponse(fixture, 'GET', '/@tempad-dev%2fmcp/latest')).toEqual({
      status: 200,
      metadata: {
        name: '@tempad-dev/mcp',
        version: '0.12.1',
        dist: {
          integrity: fixture.candidate.integrity,
          tarball: `${fixture.registryUrl}/@tempad-dev/mcp/-/mcp-0.12.1.tgz`
        }
      }
    })
    expect(fixtureResponse(fixture, 'GET', '/@tempad-dev%2fmcp/0.12.0')).toMatchObject({
      status: 200,
      metadata: { version: '0.12.0' }
    })
    expect(fixtureResponse(fixture, 'GET', '/@tempad-dev/mcp/-/mcp-0.12.1.tgz')).toEqual({
      status: 200,
      archive: fixture.candidate.archive
    })
    expect(fixtureResponse(fixture, 'GET', '/@tempad-dev%2fmcp/0.12.2')).toEqual({ status: 404 })
    expect(fixtureResponse(fixture, 'POST', '/@tempad-dev%2fmcp/latest')).toEqual({ status: 405 })
  })

  it('checks and releases the entire normal release discovery group', async () => {
    await assertReleasePortsFree()
    expect(sockets.opened).toEqual(MCP_PORT_CANDIDATES)
    expect(sockets.closed).toEqual(MCP_PORT_CANDIDATES)
  })

  it('refuses an occupied release port and releases only its own earlier reservations', async () => {
    sockets.occupied = MCP_PORT_CANDIDATES[1]!
    await expect(assertReleasePortsFree()).rejects.toThrow(
      'Release discovery port 7431 is occupied'
    )
    expect(sockets.opened).toEqual([MCP_PORT_CANDIDATES[0]])
    expect(sockets.closed).toEqual(sockets.opened)
  })
})
