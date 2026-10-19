import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'

import {
  prepareDefaultRoot,
  resolveDefaultRoot
} from '../../../agent-plugin/src/clients/shared/runtime-paths.mjs'
import packageJson from '../package.json' with { type: 'json' }
import { pruneExpiredLogs } from './log-retention'

export {
  assertTrustedSocket,
  resolveDefaultRoot
} from '../../../agent-plugin/src/clients/shared/runtime-paths.mjs'

export function normalizePackageVersion(version: unknown): string {
  return typeof version === 'string' ? version : '0.0.0'
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
  const stat = lstatSync(dirPath)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
  )
    throw new Error(`Refusing untrusted runtime directory: ${dirPath}`)
}

export function getRecordProperty(record: unknown, key: string): unknown {
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
  return join(resolveDefaultRoot(systemTmpDir), 'run')
}

export function resolveLogDir(
  env: NodeJS.ProcessEnv = process.env,
  systemTmpDir: string = tmpdir()
): string {
  if (env.TEMPAD_MCP_LOG_DIR) return env.TEMPAD_MCP_LOG_DIR
  return join(resolveDefaultRoot(systemTmpDir), 'log')
}

export function resolveAssetDir(
  env: NodeJS.ProcessEnv = process.env,
  systemTmpDir: string = tmpdir()
): string {
  if (env.TEMPAD_MCP_ASSET_DIR) return env.TEMPAD_MCP_ASSET_DIR
  return join(resolveDefaultRoot(systemTmpDir), 'assets')
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.TEMPAD_MCP_STATE_DIR ??
    (env.TEMPAD_MCP_RUNTIME_DIR
      ? join(env.TEMPAD_MCP_RUNTIME_DIR, 'state')
      : join(homedir(), '.tempad-dev', 'state'))
  )
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

const needsDefaultRoot =
  !process.env.TEMPAD_MCP_RUNTIME_DIR ||
  !process.env.TEMPAD_MCP_LOG_DIR ||
  !process.env.TEMPAD_MCP_ASSET_DIR
const defaultRoot = needsDefaultRoot ? prepareDefaultRoot() : ''
export const RUNTIME_DIR = process.env.TEMPAD_MCP_RUNTIME_DIR || join(defaultRoot, 'run')
export const LOG_DIR = process.env.TEMPAD_MCP_LOG_DIR || join(defaultRoot, 'log')
export const ASSET_DIR = process.env.TEMPAD_MCP_ASSET_DIR || join(defaultRoot, 'assets')

if (needsDefaultRoot) ensureDir(defaultRoot)
ensureDir(RUNTIME_DIR)
ensureDir(LOG_DIR)
ensureDir(ASSET_DIR)

export function ensureFile(filePath: string): void {
  const fd = openSync(filePath, 'a')
  closeSync(fd)
}

export const LOCK_PATH = join(RUNTIME_DIR, 'mcp.lock')
export const HUB_LOCK_PATH = join(RUNTIME_DIR, 'hub.lock')
export const HUB_RUNTIME_IDENTITY_PATH = join(RUNTIME_DIR, 'hub-runtime.json')
ensureFile(LOCK_PATH)
ensureFile(HUB_LOCK_PATH)

export const HUB_BUSY_EXIT_CODE = 75
export const HUB_LOCK_STALE_MS = 60000
export const HUB_LOCK_UPDATE_MS = 10000

const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const pid = process.pid
const LOG_FILE = join(LOG_DIR, `mcp-${timestamp}-${pid}.log`)

pruneExpiredLogs(LOG_DIR)

const prettyTransport = pino.transport({
  target: fileURLToPath(
    import.meta.url.endsWith('.ts')
      ? new URL('./log-transport.ts', import.meta.url)
      : new URL('./log-transport.mjs', import.meta.url)
  ),
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

export function endLogging(): void {
  // Shutdown must drain the worker even when its ready event is still pending.
  prettyTransport.end()
}

export const SOCK_PATH = resolveSockPath()
