import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'

export const log = pino(
  {
    level: process.env.DEBUG ? 'debug' : 'info',
    msgPrefix: '[tempad-dev/mcp] ',
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } }
  },
  pino.destination(2)
)

export const RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || join(homedir(), '.tempad', 'run')
export const SOCK_PATH =
  process.platform === 'win32' ? '\\\\.\\pipe\\tempad-mcp' : join(RUNTIME_DIR, 'mcp.sock')
export const LOCK_PATH = join(RUNTIME_DIR, 'mcp.lock')

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 })
}
