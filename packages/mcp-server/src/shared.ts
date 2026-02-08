import { closeSync, mkdirSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'

import packageJson from '../package.json' assert { type: 'json' }

export function normalizePackageVersion(version: unknown): string {
  return typeof version === 'string' ? version : '0.0.0'
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
}

function getRecordProperty(record: unknown, key: string): unknown {
  if (!record || typeof record !== 'object') {
    return undefined
  }
  return Reflect.get(record, key)
}

export const PACKAGE_VERSION = normalizePackageVersion(getRecordProperty(packageJson, 'version'))

export function resolveRuntimeDir(
  env: NodeJS.ProcessEnv = process.env,
  systemTmpDir: string = tmpdir()
): string {
  if (env.TEMPAD_MCP_RUNTIME_DIR) return env.TEMPAD_MCP_RUNTIME_DIR
  return join(systemTmpDir, 'tempad-dev', 'run')
}

export function resolveLogDir(
  env: NodeJS.ProcessEnv = process.env,
  systemTmpDir: string = tmpdir()
): string {
  if (env.TEMPAD_MCP_LOG_DIR) return env.TEMPAD_MCP_LOG_DIR
  return join(systemTmpDir, 'tempad-dev', 'log')
}

export function resolveAssetDir(
  env: NodeJS.ProcessEnv = process.env,
  systemTmpDir: string = tmpdir()
): string {
  if (env.TEMPAD_MCP_ASSET_DIR) return env.TEMPAD_MCP_ASSET_DIR
  return join(systemTmpDir, 'tempad-dev', 'assets')
}

export function resolveLogLevel(
  debugValue: string | undefined = process.env.DEBUG
): 'debug' | 'info' {
  return debugValue ? 'debug' : 'info'
}

export function resolveSockPath(
  platform: NodeJS.Platform = process.platform,
  runtimeDir: string = RUNTIME_DIR
): string {
  return platform === 'win32' ? '\\\\.\\pipe\\tempad-mcp' : join(runtimeDir, 'mcp.sock')
}

export const RUNTIME_DIR = resolveRuntimeDir()
export const LOG_DIR = resolveLogDir()
export const ASSET_DIR = resolveAssetDir()

ensureDir(RUNTIME_DIR)
ensureDir(LOG_DIR)
ensureDir(ASSET_DIR)

export function ensureFile(filePath: string): void {
  const fd = openSync(filePath, 'a')
  closeSync(fd)
}

export const LOCK_PATH = join(RUNTIME_DIR, 'mcp.lock')
ensureFile(LOCK_PATH)

const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const pid = process.pid
const LOG_FILE = join(LOG_DIR, `mcp-${timestamp}-${pid}.log`)

const prettyTransport = pino.transport({
  target: 'pino-pretty',
  options: {
    translateTime: 'SYS:HH:MM:ss',
    destination: LOG_FILE
  }
})

export const log = pino(
  {
    level: resolveLogLevel(),
    msgPrefix: '[tempad-dev/mcp] '
  },
  prettyTransport
)

export const SOCK_PATH = resolveSockPath()
