import { closeSync, mkdirSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
}

function resolveRuntimeDir(): string {
  if (process.env.TEMPAD_MCP_RUNTIME_DIR) return process.env.TEMPAD_MCP_RUNTIME_DIR
  return join(tmpdir(), 'tempad-dev', 'run')
}

function resolveLogDir(): string {
  if (process.env.TEMPAD_MCP_LOG_DIR) return process.env.TEMPAD_MCP_LOG_DIR
  return join(tmpdir(), 'tempad-dev', 'log')
}

export const RUNTIME_DIR = resolveRuntimeDir()
export const LOG_DIR = resolveLogDir()

ensureDir(RUNTIME_DIR)
ensureDir(LOG_DIR)

function ensureFile(filePath: string): void {
  const fd = openSync(filePath, 'a')
  closeSync(fd)
}

export const LOCK_PATH = join(RUNTIME_DIR, 'mcp.lock')
ensureFile(LOCK_PATH)

const timestamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replaceAll('.', '-')
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
