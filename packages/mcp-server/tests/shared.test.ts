import { afterEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  openSync: vi.fn(() => 42),
  closeSync: vi.fn(),
  lstatSync: vi.fn((path?: unknown) => {
    if (/tempad-dev-\d+$/.test(String(path)))
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return {
      isDirectory: (): boolean => true,
      isSocket: (): boolean => true,
      isSymbolicLink: (): boolean => false,
      uid: process.getuid?.(),
      mode: 0o700
    }
  })
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

const pruneExpiredLogs = vi.hoisted(() => vi.fn())
vi.mock('../src/log-retention', () => ({ pruneExpiredLogs }))

vi.mock('node:fs', () => ({
  mkdirSync: fsMocks.mkdirSync,
  openSync: fsMocks.openSync,
  closeSync: fsMocks.closeSync,
  lstatSync: fsMocks.lstatSync
}))

vi.mock('node:os', () => ({
  homedir: () => '/home/test',
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

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
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
  it('refuses shared-writable or symlink runtime directories', async () => {
    const shared = await importShared()
    fsMocks.lstatSync.mockReturnValueOnce({
      isDirectory: () => true,
      isSocket: () => false,
      isSymbolicLink: () => false,
      uid: process.getuid?.(),
      mode: 0o777
    })
    expect(() => shared.ensureDir('/unsafe')).toThrow('untrusted runtime directory')
    fsMocks.lstatSync.mockReturnValueOnce({
      isDirectory: () => false,
      isSocket: () => false,
      isSymbolicLink: () => true,
      uid: process.getuid?.(),
      mode: 0o700
    })
    expect(() => shared.ensureDir('/symlink')).toThrow('untrusted runtime directory')
  })
  it('isolates task storage with custom runtime directories', async () => {
    const shared = await importShared()
    expect(shared.resolveStateDir({})).toBe('/home/test/.tempad-dev/state')
    expect(shared.resolveStateDir({ TEMPAD_MCP_RUNTIME_DIR: '/isolated' })).toBe('/isolated/state')
    expect(shared.resolveStateDir({ TEMPAD_MCP_STATE_DIR: '/state' })).toBe('/state')
  })
  it('initializes runtime paths and logger using env overrides', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    process.env.TEMPAD_MCP_RUNTIME_DIR = '/tmp/custom-run'
    process.env.TEMPAD_MCP_LOG_DIR = '/tmp/custom-log'
    process.env.TEMPAD_MCP_ASSET_DIR = '/tmp/custom-assets'
    process.env.DEBUG = '1'

    const shared = await importShared()

    expect(shared.RUNTIME_DIR).toBe('/tmp/custom-run')
    expect(shared.LOG_DIR).toBe('/tmp/custom-log')
    expect(pruneExpiredLogs).toHaveBeenCalledExactlyOnceWith('/tmp/custom-log')
    expect(shared.ASSET_DIR).toBe('/tmp/custom-assets')
    expect(shared.LOCK_PATH).toBe('/tmp/custom-run/mcp.lock')
    expect(shared.HUB_LOCK_PATH).toBe('/tmp/custom-run/hub.lock')
    expect(shared.SOCK_PATH).toBe('/tmp/custom-run/mcp.sock')
    expect(fsMocks.lstatSync).not.toHaveBeenCalledWith('/tmp/tempad-unit/tempad-dev')
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
    expect(fsMocks.openSync).toHaveBeenCalledWith('/tmp/custom-run/hub.lock', 'a')
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
        target: expect.stringMatching(/[/\\]src[/\\]log-transport\.ts$/),
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
    expect(shared.HUB_LOCK_PATH).toBe('/tmp/tempad-unit/tempad-dev/run/hub.lock')
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

  it('accepts only a current-user private Unix socket inside a private directory', async () => {
    const shared = await importShared()
    const safe = {
      isDirectory: () => true,
      isSocket: () => true,
      isSymbolicLink: () => false,
      uid: 1001,
      mode: 0o700
    }
    fsMocks.lstatSync.mockReturnValueOnce(safe).mockReturnValueOnce({ ...safe, mode: 0o600 })
    expect(() => shared.assertTrustedSocket('/run/mcp.sock', 'linux', 1001)).not.toThrow()
    for (const inode of [
      { ...safe, uid: 1002 },
      { ...safe, mode: 0o666 },
      { ...safe, isSocket: () => false },
      { ...safe, isSocket: () => false, isSymbolicLink: () => true }
    ]) {
      fsMocks.lstatSync.mockReturnValueOnce(safe).mockReturnValueOnce(inode)
      expect(() => shared.assertTrustedSocket('/run/mcp.sock', 'linux', 1001)).toThrow(
        'untrusted Hub socket'
      )
    }
    for (const parent of [
      { ...safe, uid: 1002 },
      { ...safe, mode: 0o777 },
      { ...safe, isDirectory: () => false }
    ]) {
      fsMocks.lstatSync.mockReturnValueOnce(parent).mockReturnValueOnce(safe)
      expect(() => shared.assertTrustedSocket('/run/mcp.sock', 'linux', 1001)).toThrow(
        'untrusted Hub socket'
      )
    }
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    fsMocks.lstatSync.mockReturnValueOnce(safe).mockImplementationOnce(() => {
      throw missing
    })
    expect(() => shared.assertTrustedSocket('/run/mcp.sock', 'linux', 1001)).toThrow(missing)
    vi.clearAllMocks()
    shared.assertTrustedSocket('pipe', 'win32')
    expect(fsMocks.lstatSync).not.toHaveBeenCalled()
  })
})
