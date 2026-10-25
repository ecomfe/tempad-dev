#!/usr/bin/env node

import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Deliberately separate from the installed CLI: Phase 1 cannot opt a user's
// release/checkout services into an unaccepted supervisor or version switch.
const args = process.argv.slice(2)
const root = args[1]
const role = args[3] ?? 'edge'
if (
  args[0] !== '--root' ||
  !root ||
  !isAbsolute(root) ||
  (args.length !== 2 && (args.length !== 4 || args[2] !== '--role')) ||
  !['edge', 'supervisor', 'hub'].includes(role) ||
  process.env.TEMPAD_MCP_DEV_CHECKOUT
)
  throw new Error(
    'Use runtime-prototype.mjs --root <private-isolated-directory> without checkout overrides.'
  )
if (process.platform === 'win32' || realpathSync(root) !== root)
  throw new Error('An isolated canonical Unix root is required.')
const stat = lstatSync(root)
if (!stat.isDirectory() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
  throw new Error('The isolated prototype root must be owned by this user and private (0700).')
for (const [key, directory] of Object.entries({
  TEMPAD_MCP_RUNTIME_DIR: 'run',
  TEMPAD_MCP_STATE_DIR: 'state',
  TEMPAD_MCP_LOG_DIR: 'log',
  TEMPAD_MCP_ASSET_DIR: 'assets'
}))
  process.env[key] = join(root, directory)

const { prototypeConfig } = await import('./runtime-prototype/processes')
const { endLogging } = await import('./shared')
const config = prototypeConfig(root, fileURLToPath(import.meta.url))
try {
  if (role === 'hub') {
    const { startHub } = await import('./hub-runtime')
    await startHub({ prototype: { secret: config.secret } })
  } else if (role === 'supervisor') {
    const { startSupervisor } = await import('./runtime-prototype/supervisor')
    await startSupervisor(config)
  } else {
    const { startPrototypeEdge } = await import('./runtime-prototype/edge')
    await startPrototypeEdge(config)
  }
} catch (error) {
  process.stderr.write(
    `Runtime prototype failed: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
  process.stdin.destroy()
  endLogging()
}
