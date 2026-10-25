import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import lockfile from 'proper-lockfile'

import { writeDurableJson } from '../durable-json'
import { startPrototypeEdge } from '../runtime-prototype/edge'
import {
  connectSocket,
  fingerprintBundle,
  hubSocketPath,
  supervisorConnection,
  unavailableSocket
} from '../runtime-prototype/processes'
import { ControlPeer, SocketTransport } from '../runtime-prototype/protocol'
import { ConfigSchema, readPrivateJson, type PrototypeConfig } from '../runtime-prototype/state'
import {
  ASSET_DIR,
  HUB_LOCK_PATH,
  HUB_LOCK_STALE_MS,
  LOCK_PATH,
  LOG_DIR,
  RUNTIME_DIR,
  RUNTIME_PROFILE,
  SOCK_PATH,
  endLogging,
  ensureFile,
  resolveStateDir
} from '../shared'
import { retainBundledPackage } from './artifact'
import { privateDirectory } from './cache'
import { prepareManagedEdge } from './cold-start'
import { MANIFEST_PATH, ManifestSchema, VersionSchema } from './manifest'
import { sha256 } from './package'

export function updateIntent(
  args: string[],
  checkout: boolean,
  defaultPolicy: 'stable' | 'off' = 'off'
) {
  const flags = args.filter((arg) => arg.startsWith('--runtime-updates'))
  if (
    flags.length > 1 ||
    flags.some(
      (flag) => !['stable', 'off', 'pinned'].some((value) => flag === `--runtime-updates=${value}`)
    )
  )
    throw new Error('Use one --runtime-updates=stable, off or pinned option.')
  const command = args.find((arg) =>
    ['--check-runtime-update', '--update-runtime', '--runtime-update-status'].includes(arg)
  )
  if (checkout && (command || flags.length))
    throw new Error('Checkout runtimes cannot enroll, check or download release updates.')
  return {
    command,
    policy:
      flags[0] === '--runtime-updates=stable'
        ? ('stable' as const)
        : flags[0] === '--runtime-updates=pinned'
          ? ('pinned' as const)
          : flags[0] === '--runtime-updates=off'
            ? ('off' as const)
            : defaultPolicy
  }
}

/** Enrollment changes policy, never the release namespace or the task/asset store. */
export async function maybeManagedRuntime(args: string[], packageDir: string): Promise<boolean> {
  const manifestPath = join(packageDir, MANIFEST_PATH)
  const intent = updateIntent(
    args,
    RUNTIME_PROFILE.kind === 'checkout',
    existsSync(manifestPath) ? 'stable' : 'off'
  )
  if (RUNTIME_PROFILE.kind === 'checkout') return false
  if (args.includes('--recover-task-storage')) return false
  const root = join(resolveStateDir(), 'runtime')
  const path = join(root, 'prototype.json')
  if (!existsSync(path) && intent.command === '--runtime-update-status') {
    process.stdout.write(JSON.stringify({ managed: false, automaticActivation: false }) + '\n')
    process.stdin.destroy()
    endLogging()
    return true
  }
  if (!existsSync(path)) {
    if (args.includes('--runtime-status') || args.includes('--resolve-runtime-block')) return false
    if (args.includes('--recover-runtime')) throw new Error('No managed runtime exists to recover.')
  }
  if (!existsSync(path) && intent.policy === 'off' && !intent.command) return false
  if (!existsSync(manifestPath))
    throw new Error(
      'This build is not a verified release. Use a checkout profile for development; no online fallback is allowed.'
    )
  const bytes = readFileSync(manifestPath)
  const installed = ManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  const manifestHash = sha256(bytes)
  privateDirectory(root)
  let saved = readPrivateJson(path, ConfigSchema)
  if (!saved) {
    ensureFile(LOCK_PATH)
    const unlock = await lockfile.lock(LOCK_PATH, {
      retries: { retries: 120, factor: 1, minTimeout: 250, maxTimeout: 250 },
      stale: 10_000
    })
    try {
      saved = readPrivateJson(path, ConfigSchema)
      if (!saved) {
        let legacy
        try {
          legacy = await connectSocket(SOCK_PATH)
        } catch (error) {
          if (
            ['EPIPEUNPROTECTED', 'EPIPEUNTRUSTED'].includes(
              (error as NodeJS.ErrnoException).code ?? ''
            )
          )
            throw new Error(
              `An existing Windows Hub could not be verified. Close/restart all TemPad MCP connections once to replace a legacy Hub; runtime enrollment was not started. ${String(error)}`,
              { cause: error }
            )
          if (!unavailableSocket(error)) throw error
        }
        if (legacy) {
          legacy.destroy()
          if (intent.policy === 'stable' && !intent.command) {
            process.stderr.write(
              'TemPad: using the existing Hub. Automatic updates will start after all TemPad MCP clients restart once.\n'
            )
            return false
          }
          throw new Error(
            'A legacy Hub is running. Close/restart all TemPad MCP connections once to enroll; it will not be terminated automatically.'
          )
        }
        if (
          existsSync(HUB_LOCK_PATH) &&
          (await lockfile.check(HUB_LOCK_PATH, { stale: HUB_LOCK_STALE_MS }))
        )
          throw new Error('The prior Hub still owns its writer lease; wait before enrolling.')
        const artifact = await retainBundledPackage(packageDir, join(root, 'cache'))
        artifact.bundle = fingerprintBundle(artifact.entry)
        saved = ConfigSchema.parse({
          version: 1,
          entry: artifact.entry,
          bundle: artifact.bundle,
          secret: randomUUID(),
          release: artifact.release,
          directories: {
            runtime: RUNTIME_DIR,
            state: resolveStateDir(),
            assets: ASSET_DIR,
            log: LOG_DIR
          }
        })
        writeDurableJson(path, saved)
      }
    } finally {
      await unlock()
    }
  }
  if (
    !saved.release ||
    !saved.directories ||
    saved.directories.runtime !== RUNTIME_DIR ||
    saved.directories.state !== resolveStateDir() ||
    saved.directories.assets !== ASSET_DIR
  )
    throw new Error(
      'Managed runtime directories differ from this launch. Keep one release namespace; stop its clients before changing directory overrides.'
    )
  const config: PrototypeConfig = { ...saved, root }
  const command =
    intent.command ??
    args.find((arg) =>
      ['--runtime-status', '--resolve-runtime-block', '--recover-runtime'].includes(arg)
    )
  if (command) {
    const peer = new ControlPeer()
    try {
      await peer.connect(
        new SocketTransport(await supervisorConnection(config, AbortSignal.timeout(90_000)))
      )
      const request = (method: string, params?: Record<string, unknown>) =>
        peer.request({ method, ...(params ? { params } : {}) }, ResultSchema, { timeout: 500_000 })
      if (command === '--runtime-status' || command === '--resolve-runtime-block') {
        const { runRuntimeRecovery } = await import('../runtime-recovery')
        await runRuntimeRecovery(
          args.filter((arg) => !arg.startsWith('--runtime-updates=')),
          () => connectSocket(hubSocketPath(root, config.directories?.runtime))
        )
        if (command === '--runtime-status')
          process.stdout.write(
            JSON.stringify(await request('tempad/runtime-status'), null, 2) + '\n'
          )
      } else if (command === '--recover-runtime') {
        process.stdout.write(
          JSON.stringify(await request('tempad/runtime-recover'), null, 2) + '\n'
        )
      } else if (command === '--runtime-update-status') {
        process.stdout.write(JSON.stringify(await request('tempad/runtime-status'), null, 2) + '\n')
      } else {
        const version =
          command === '--update-runtime'
            ? VersionSchema.parse(args[args.indexOf(command) + 1])
            : 'latest'
        const checked = await request('tempad/runtime-check', { version })
        process.stdout.write(JSON.stringify(checked, null, 2) + '\n')
        if (command === '--update-runtime') {
          if (!process.stdin.isTTY || !process.stdout.isTTY)
            throw new Error(
              'Runtime activation requires interactive confirmation of the exact staged artifact.'
            )
          const candidate = (
            checked as { candidate?: { version?: string; release?: { integrity?: string } } }
          ).candidate
          if (candidate?.version !== version || !candidate.release?.integrity)
            throw new Error('The requested release is not staged.')
          const input = createInterface({ input: process.stdin, output: process.stdout })
          let answer
          try {
            answer = await input.question(
              `Activate ${version} (${candidate.release.integrity})? Type "update ${version}": `
            )
          } finally {
            input.close()
          }
          if (answer !== `update ${version}`) throw new Error('Runtime activation cancelled.')
          process.stdout.write(
            JSON.stringify(
              await request('tempad/runtime-activate', {
                version,
                integrity: candidate.release.integrity
              }),
              null,
              2
            ) + '\n'
          )
        }
      }
    } finally {
      await peer.close()
      process.stdin.destroy()
      endLogging()
    }
  } else {
    const prepared = await prepareManagedEdge(config, packageDir, installed)
    try {
      await startPrototypeEdge(prepared.config, {
        policy: intent.policy,
        version: installed.packageVersion,
        manifestHash
      })
    } finally {
      prepared.close()
    }
  }
  return true
}
