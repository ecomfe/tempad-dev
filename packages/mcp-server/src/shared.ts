import { closeSync, mkdirSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'

import packageJson from '../package.json' assert { type: 'json' }

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
}

const pkg = packageJson as { version?: unknown }
export const PACKAGE_VERSION = typeof pkg.version === 'string' ? pkg.version : '0.0.0'

function resolveRuntimeDir(): string {
  if (process.env.TEMPAD_MCP_RUNTIME_DIR) return process.env.TEMPAD_MCP_RUNTIME_DIR
  return join(tmpdir(), 'tempad-dev', 'run')
}

function resolveLogDir(): string {
  if (process.env.TEMPAD_MCP_LOG_DIR) return process.env.TEMPAD_MCP_LOG_DIR
  return join(tmpdir(), 'tempad-dev', 'log')
}

function resolveAssetDir(): string {
  if (process.env.TEMPAD_MCP_ASSET_DIR) return process.env.TEMPAD_MCP_ASSET_DIR
  return join(tmpdir(), 'tempad-dev', 'assets')
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
    level: process.env.DEBUG ? 'debug' : 'info',
    msgPrefix: '[tempad-dev/mcp] '
  },
  prettyTransport
)

export const SOCK_PATH =
  process.platform === 'win32' ? '\\\\.\\pipe\\tempad-mcp' : join(RUNTIME_DIR, 'mcp.sock')
