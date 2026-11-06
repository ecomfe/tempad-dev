import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { LOG_DIR, PACKAGE_VERSION } from './shared'

let started = 0
let role = ''
let active = false
let descriptor: number | undefined
let bytes = 0

/** Keep startup evidence available even if the host kills a logging worker. */
function startupEvent(phase: string, event: string, durationMs?: number, error?: unknown): void {
  if (!active) return
  const line =
    JSON.stringify({
      time: new Date().toISOString(),
      pid: process.pid,
      role,
      version: PACKAGE_VERSION,
      node: process.version,
      elapsedMs: Math.round(performance.now() - started),
      phase,
      event,
      ...(error === undefined ? {} : { error: String(error).slice(0, 1000) }),
      ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) })
    }) + '\n'
  try {
    const size = Buffer.byteLength(line)
    if (bytes + size > 1024 * 1024) return
    descriptor ??= openSync(
      join(
        LOG_DIR,
        `startup-mcp-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}.log`
      ),
      'wx',
      0o600
    )
    writeFileSync(descriptor, line)
    bytes += size
  } catch {
    // Diagnostics must not prevent the runtime from starting.
  }
  if (
    role === 'cli' &&
    !process.stdin.isTTY &&
    process.argv.slice(2).every((arg) => arg.startsWith('--runtime-updates=')) &&
    (event === 'ready' || event === 'failed')
  ) {
    try {
      writeSync(2, `TemPad startup ${line}`)
    } catch {
      /* Host may have disconnected. */
    }
  }
}

export function startStartup(processRole: string): void {
  role = processRole
  started = performance.now()
  active = true
  startupEvent(role, 'start')
}

export function finishStartup(event: 'ready' | 'failed', error?: unknown): void {
  if (!active) return
  startupEvent(role, event, performance.now() - started, error)
  active = false
  try {
    if (descriptor !== undefined) closeSync(descriptor)
  } catch {
    /* Logging must not block readiness or error handling. */
  }
  descriptor = undefined
}

export function startupPhase<T>(phase: string, action: () => T): T {
  if (!active) return action()
  const start = performance.now()
  startupEvent(phase, 'start')
  const complete = <V>(value: V): V => {
    startupEvent(phase, 'complete', performance.now() - start)
    return value
  }
  const failed = (error: unknown): never => {
    startupEvent(phase, 'failed', performance.now() - start, error)
    throw error
  }
  try {
    const result = action()
    if (result instanceof Promise) return result.then(complete, failed) as T
    return complete(result)
  } catch (error) {
    return failed(error)
  }
}
