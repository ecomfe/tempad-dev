import { isAbsolute, join } from 'node:path'

import { assertPrivatePath } from '../runtime-platform'
import { ConfigSchema, readPrivateJson } from './state'

export async function runRuntime(entry: string) {
  const args = process.argv.slice(2)
  const root = args[1]
  const role = args[2] === '--role' ? args[3] : 'edge'
  const command = args[2] !== '--role' ? args[2] : undefined
  if (
    args[0] !== '--root' ||
    !root ||
    !isAbsolute(root) ||
    (args.length !== 2 &&
      !(
        (args.length === 4 && args[2] === '--role') ||
        (args.length === 4 && command === '--switch') ||
        (args.length === 3 &&
          ['--status', '--runtime-status', '--recover-runtime'].includes(command ?? '')) ||
        (args.length === 4 && command === '--resolve-runtime-block')
      )) ||
    !['edge', 'supervisor', 'hub'].includes(role ?? '') ||
    process.env.TEMPAD_MCP_DEV_CHECKOUT
  )
    throw new Error(
      'Use runtime-prototype.mjs --root <private-isolated-directory> without checkout overrides.'
    )
  assertPrivatePath(root, 'directory')
  const saved = readPrivateJson(join(root, 'prototype.json'), ConfigSchema)
  for (const [key, directory] of Object.entries({
    TEMPAD_MCP_RUNTIME_DIR: saved?.directories?.runtime ?? join(root, 'run'),
    TEMPAD_MCP_STATE_DIR: saved?.directories?.state ?? join(root, 'state'),
    TEMPAD_MCP_LOG_DIR: saved?.directories?.log ?? join(root, 'log'),
    TEMPAD_MCP_ASSET_DIR: saved?.directories?.assets ?? join(root, 'assets')
  }))
    process.env[key] = directory

  const { prototypeConfig, hubSocketPath } = await import('./processes')
  const { readJournal } = await import('./state')
  const { endLogging } = await import('../shared')
  const config = prototypeConfig(root, entry, role)
  try {
    if (command) {
      const { supervisorConnection, connectSocket } = await import('./processes')
      const { ControlPeer, SocketTransport } = await import('./protocol')
      const { ResultSchema } = await import('@modelcontextprotocol/sdk/types.js')
      const peer = new ControlPeer()
      try {
        await peer.connect(
          new SocketTransport(await supervisorConnection(config, AbortSignal.timeout(10_000)))
        )
        if (command === '--runtime-status' || command === '--resolve-runtime-block') {
          const { runRuntimeRecovery } = await import('../runtime-recovery')
          await runRuntimeRecovery(args.slice(2), () =>
            connectSocket(hubSocketPath(root, config.directories?.runtime))
          )
        } else {
          const result = await peer.request(
            command === '--switch'
              ? { method: 'tempad/runtime-update', params: { entry: args[3]! } }
              : {
                  method:
                    command === '--recover-runtime'
                      ? 'tempad/runtime-recover'
                      : 'tempad/runtime-status'
                },
            ResultSchema,
            { timeout: 500_000 }
          )
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        }
      } finally {
        await peer.close()
        process.stdin.destroy()
        endLogging()
      }
    } else if (role === 'hub') {
      const { startHub } = await import('../hub-runtime')
      await startHub({
        entryPath: entry,
        prototype: {
          secret: config.secret,
          root,
          socketPath: hubSocketPath(root, config.directories?.runtime),
          release: !!config.release,
          paused: readJournal(root)?.phase !== 'committed'
        }
      })
    } else if (role === 'supervisor') {
      const { startSupervisor } = await import('./supervisor')
      await startSupervisor(config)
    } else {
      const { startPrototypeEdge } = await import('./edge')
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
}
