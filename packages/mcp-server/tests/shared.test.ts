import { afterEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  openSync: vi.fn(() => 42),
  closeSync: vi.fn()
}))

const osMocks = vi.hoisted(() => ({
  tmpdir: vi.fn(() => '/tmp/tempad-unit')
}))

const pinoMocks = vi.hoisted(() => {
  const transport = vi.fn(() => ({ mockTransport: true }))
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
  const pino = Object.assign(
    vi.fn(() => logger),
    { transport }
  )
  return { pino, transport, logger }
})

vi.mock('node:fs', () => ({
  mkdirSync: fsMocks.mkdirSync,
  openSync: fsMocks.openSync,
  closeSync: fsMocks.closeSync
}))

vi.mock('node:os', () => ({
  tmpdir: osMocks.tmpdir
}))

vi.mock('pino', () => ({
  default: pinoMocks.pino
}))

const ENV_KEYS = [
  'DEBUG',
  'TEMPAD_MCP_RUNTIME_DIR',
  'TEMPAD_MCP_LOG_DIR',
  'TEMPAD_MCP_ASSET_DIR'
] as const

const originalEnv = new Map<string, string | undefined>()
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key])
}

async function importShared() {
  vi.resetModules()
  return import('../src/shared')
}

async function importSharedWithPackageJson(value: unknown) {
  vi.resetModules()
  vi.doMock('../package.json', () => ({
    default: value
  }))
  const shared = await import('../src/shared')
  vi.doUnmock('../package.json')
  return shared
}

afterEach(() => {
  vi.clearAllMocks()
  vi.doUnmock('../package.json')
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('mcp-server/shared', () => {
  it('initializes runtime paths and logger using env overrides', async () => {
    process.env.TEMPAD_MCP_RUNTIME_DIR = '/tmp/custom-run'
    process.env.TEMPAD_MCP_LOG_DIR = '/tmp/custom-log'
    process.env.TEMPAD_MCP_ASSET_DIR = '/tmp/custom-assets'
    process.env.DEBUG = '1'

    const shared = await importShared()

    expect(shared.RUNTIME_DIR).toBe('/tmp/custom-run')
    expect(shared.LOG_DIR).toBe('/tmp/custom-log')
    expect(shared.ASSET_DIR).toBe('/tmp/custom-assets')
    expect(shared.LOCK_PATH).toBe('/tmp/custom-run/mcp.lock')
    expect(shared.SOCK_PATH).toBe('/tmp/custom-run/mcp.sock')
    expect(shared.PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/)

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith('/tmp/custom-run', {
      recursive: true,
      mode: 0o700
    })
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith('/tmp/custom-log', {
      recursive: true,
      mode: 0o700
    })
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith('/tmp/custom-assets', {
      recursive: true,
      mode: 0o700
    })
    expect(fsMocks.openSync).toHaveBeenCalledWith('/tmp/custom-run/mcp.lock', 'a')
    expect(fsMocks.closeSync).toHaveBeenCalledWith(42)

    expect(pinoMocks.pino).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        msgPrefix: '[tempad-dev/mcp] '
      }),
      expect.any(Object)
    )
    expect(pinoMocks.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'pino-pretty',
        options: expect.objectContaining({
          translateTime: 'SYS:HH:MM:ss',
          destination: expect.stringMatching(/^\/tmp\/custom-log\/mcp-.*-\d+\.log$/)
        })
      })
    )
  })

  it('falls back to tmpdir defaults and info level when env is unset', async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }

    const shared = await importShared()

    expect(shared.RUNTIME_DIR).toBe('/tmp/tempad-unit/tempad-dev/run')
    expect(shared.LOG_DIR).toBe('/tmp/tempad-unit/tempad-dev/log')
    expect(shared.ASSET_DIR).toBe('/tmp/tempad-unit/tempad-dev/assets')
    expect(shared.LOCK_PATH).toBe('/tmp/tempad-unit/tempad-dev/run/mcp.lock')
    expect(shared.SOCK_PATH).toBe('/tmp/tempad-unit/tempad-dev/run/mcp.sock')
    expect(pinoMocks.pino).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info'
      }),
      expect.any(Object)
    )
  })

  it('resolves helper branches for version, paths, level, and sock path', async () => {
    const shared = await importShared()

    expect(shared.normalizePackageVersion('1.2.3')).toBe('1.2.3')
    expect(shared.normalizePackageVersion(null)).toBe('0.0.0')

    expect(shared.resolveRuntimeDir({ TEMPAD_MCP_RUNTIME_DIR: '/runtime' }, '/tmp/base')).toBe(
      '/runtime'
    )
    expect(shared.resolveRuntimeDir({}, '/tmp/base')).toBe('/tmp/base/tempad-dev/run')

    expect(shared.resolveLogDir({ TEMPAD_MCP_LOG_DIR: '/logs' }, '/tmp/base')).toBe('/logs')
    expect(shared.resolveLogDir({}, '/tmp/base')).toBe('/tmp/base/tempad-dev/log')

    expect(shared.resolveAssetDir({ TEMPAD_MCP_ASSET_DIR: '/assets' }, '/tmp/base')).toBe('/assets')
    expect(shared.resolveAssetDir({}, '/tmp/base')).toBe('/tmp/base/tempad-dev/assets')

    expect(shared.resolveLogLevel('true')).toBe('debug')
    expect(shared.resolveLogLevel(undefined)).toBe('info')

    expect(shared.resolveSockPath('win32', 'C:\\runtime')).toBe('\\\\.\\pipe\\tempad-mcp')
    expect(shared.resolveSockPath('linux', '/runtime')).toBe('/runtime/mcp.sock')
  })

  it('falls back to default version when package metadata is not an object', async () => {
    const shared = await importSharedWithPackageJson(null)

    expect(shared.PACKAGE_VERSION).toBe('0.0.0')
  })

  it('creates directories and files through exported fs helpers', async () => {
    const shared = await importShared()
    vi.clearAllMocks()

    fsMocks.openSync.mockReturnValueOnce(7)
    shared.ensureDir('/tmp/manual-dir')
    shared.ensureFile('/tmp/manual-file')

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith('/tmp/manual-dir', {
      recursive: true,
      mode: 0o700
    })
    expect(fsMocks.openSync).toHaveBeenCalledWith('/tmp/manual-file', 'a')
    expect(fsMocks.closeSync).toHaveBeenCalledWith(7)
  })
})
