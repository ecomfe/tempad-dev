import type { Socket } from 'node:net'

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs'
import { connect, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'

import { hubEnvironment } from '../process-environment'
import {
  assertPrivateEndpointAsync,
  assertPrivatePath,
  ensurePrivateDirectory,
  isPipe,
  protectPipeAsync,
  runtimeEndpoint
} from '../runtime-platform'
import { verifyReleaseArtifact } from '../runtime-update/artifact'
import { assertTrustedSocket, ensureFile } from '../shared'
import { isRuntimeUnavailable, RECOVER_MS, unavailable } from './protocol'
import { ConfigSchema, readJournal, type Artifact, type PrototypeConfig } from './state'
export type { PrototypeConfig } from './state'

export function fingerprintBundle(entry: string): string {
  const directory = dirname(entry)
  const hash = createHash('sha256')
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.mjs'))
    .sort())
    hash
      .update(name)
      .update('\0')
      .update(readFileSync(join(directory, name)))
  return hash.digest('hex')
}

export function runtimePaths(config: PrototypeConfig) {
  return (
    config.directories ?? {
      runtime: join(config.root, 'run'),
      state: join(config.root, 'state'),
      assets: join(config.root, 'assets'),
      log: join(config.root, 'log')
    }
  )
}

export function hubSocketPath(root: string, runtime = join(root, 'run')) {
  return runtimeEndpoint(runtime, 'runtime-hub.sock')
}

export function supervisorSocketPath(config: PrototypeConfig) {
  return runtimeEndpoint(config.directories?.runtime ?? config.root, 'supervisor.sock')
}

export function prototypeConfig(root: string, entry: string, role = 'edge'): PrototypeConfig {
  root = realpathSync(root)
  ensurePrivateDirectory(root)
  const bundle = fingerprintBundle(entry)
  const path = join(root, 'prototype.json')
  try {
    writeFileSync(path, JSON.stringify({ version: 1, entry, bundle, secret: randomUUID() }), {
      flag: 'wx',
      mode: 0o600
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  assertPrivatePath(path, 'file')
  const config = ConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (config.entry !== entry || config.bundle !== bundle) {
    const journal = readJournal(root)
    const known = [journal?.active, journal?.candidate, journal?.previous].some(
      (artifact) => artifact?.entry === entry && artifact.bundle === bundle
    )
    if (role === 'supervisor' || !known)
      throw new Error(
        'Runtime prototype bundle changed. Stop the isolated run and use a fresh root.'
      )
  }
  return { ...config, root }
}

export function launch(config: PrototypeConfig, role: 'supervisor' | 'hub', artifact?: Artifact) {
  const entry = artifact?.entry ?? config.entry
  if (artifact?.release) verifyReleaseArtifact(artifact)
  else if (config.release && !artifact)
    verifyReleaseArtifact({
      entry,
      bundle: config.bundle,
      version: JSON.parse(readFileSync(join(config.release.directory, 'package.json'), 'utf8'))
        .version,
      release: config.release
    })
  if (fingerprintBundle(entry) !== (artifact?.bundle ?? config.bundle))
    throw new Error('Verified runtime bundle changed before launch.')
  const child = spawn(process.execPath, [entry, '--root', config.root, '--role', role], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: hubEnvironment(process.env)
  })
  child.on('error', () => {})
  child.unref()
  return child
}

export function connectSocket(path: string, signal?: AbortSignal): Promise<Socket> {
  if (!isPipe(path)) assertTrustedSocket(path)
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    let deadline = performance.now() + 1000
    const inspection = new AbortController()
    const inspectionSignal = signal
      ? AbortSignal.any([signal, inspection.signal])
      : inspection.signal
    let pendingInspection: Error | undefined
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket.off('error', fail)
    }
    const fail = (error: Error) => {
      cleanup()
      inspection.abort()
      socket.destroy()
      reject(error)
    }
    const abort = () => fail(new Error('Runtime connection cancelled.'))
    const timedOut = () =>
      fail(
        pendingInspection ??
          Object.assign(new Error('Runtime connection timed out.'), { code: 'ETIMEDOUT' })
      )
    let timer = setTimeout(timedOut, 1000)
    socket.once('error', fail)
    const verify = async () => {
      while (!socket.destroyed) {
        try {
          if (isPipe(path)) await assertPrivateEndpointAsync(path, inspectionSignal)
          return
        } catch (error) {
          if (
            !['EPIPEUNPROTECTED', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') ||
            performance.now() >= deadline
          )
            throw error
          pendingInspection = error instanceof Error ? error : new Error(String(error))
          await delay(25, undefined, { signal: inspectionSignal })
        }
      }
    }
    socket.once('connect', () => {
      if (isPipe(path)) {
        // Connection acquisition and ACL inspection have separate bounds. The
        // helper may take 15s, but must not block the Hub's 10s control lease.
        clearTimeout(timer)
        deadline = performance.now() + 15_000
        timer = setTimeout(timedOut, 15_000)
      }
      // Keep the connection open while inspecting: a connected pipe cannot be replaced by
      // a different owner between this check and the caller's first authenticated frame.
      void verify().then(
        () => {
          if (socket.destroyed) return
          cleanup()
          resolve(socket)
        },
        (error) => fail(error instanceof Error ? error : new Error(String(error)))
      )
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

export async function waitForSocket(
  path: string,
  signal?: AbortSignal,
  timeoutMs = 5000,
  processId?: number
) {
  if (timeoutMs <= 0) throw unavailable('Runtime process has not published its endpoint yet.')
  const until = performance.now() + timeoutMs
  const deadline = AbortSignal.timeout(Math.ceil(timeoutMs))
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    do {
      if (processId !== undefined) {
        try {
          process.kill(processId, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          throw new Error('Runtime process exited before endpoint publication.', { cause: error })
        }
      }
      try {
        const socket = await connectSocket(path, bounded)
        if (bounded.aborted) {
          socket.destroy()
          bounded.throwIfAborted()
        }
        return socket
      } catch (error) {
        bounded.throwIfAborted()
        if (!unavailableSocket(error) && !isSocketPending(error)) throw error
        await delay(100, undefined, { signal: bounded })
      }
    } while (performance.now() < until)
  } catch (error) {
    signal?.throwIfAborted()
    if (!deadline.aborted) throw error
  }
  throw unavailable('Runtime process has not published its endpoint yet.')
}

export async function waitForLaunchedSocket(
  path: string,
  child: ChildProcess,
  signal: AbortSignal,
  timeoutMs = RECOVER_MS
) {
  const ended = new AbortController()
  const failed = (error: Error) => ended.abort(error)
  const exited = (code: number | null, exitSignal: NodeJS.Signals | null) =>
    failed(new Error(`Runtime process exited before endpoint publication (${exitSignal ?? code}).`))
  child.once('error', failed)
  child.once('exit', exited)
  if (child.exitCode != null || child.signalCode != null) exited(child.exitCode, child.signalCode)
  try {
    return await waitForSocket(path, AbortSignal.any([signal, ended.signal]), timeoutMs)
  } catch (error) {
    signal.throwIfAborted()
    ended.signal.throwIfAborted()
    throw error
  } finally {
    child.off('error', failed)
    child.off('exit', exited)
  }
}

export function unavailableSocket(error: unknown) {
  return ['ENOENT', 'ECONNREFUSED', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')
}

export function isSocketPending(error: unknown) {
  // Slow acquisition or pending protection cannot prove that the owner is absent.
  return ['EPIPEUNPROTECTED', 'ETIMEDOUT'].includes((error as NodeJS.ErrnoException).code ?? '')
}

export async function supervisorConnection(config: PrototypeConfig, signal: AbortSignal) {
  const deadline = AbortSignal.timeout(RECOVER_MS)
  const attemptSignal = AbortSignal.any([signal, deadline])
  for (;;) {
    signal.throwIfAborted()
    if (deadline.aborted) throw unavailable('Runtime supervisor startup timed out.')
    try {
      return await supervisorConnectionAttempt(config, attemptSignal)
    } catch (error) {
      signal.throwIfAborted()
      if (!deadline.aborted && !isRuntimeUnavailable(error) && !isSocketPending(error)) throw error
      await delay(200, undefined, { signal: attemptSignal }).catch(() => {})
    }
  }
}

// Retry only endpoint acquisition, before a control request can be dispatched.
async function supervisorConnectionAttempt(config: PrototypeConfig, signal: AbortSignal) {
  const path = supervisorSocketPath(config)
  try {
    return await connectSocket(path, signal)
  } catch (error) {
    if (!unavailableSocket(error)) throw error
  }
  try {
    return await withStartupLock(config.root, async () => {
      try {
        return await connectSocket(path, signal)
      } catch (error) {
        if (!unavailableSocket(error)) throw error
      }
      signal.throwIfAborted()
      // Another cold launch may have promoted the retained control artifact while
      // this edge waited. Never launch the stale snapshot supplied by the caller.
      if (config.release) {
        const { resumeColdStart } = await import('../runtime-update/cold-start')
        config = await resumeColdStart(config)
      }
      const owner = join(config.root, 'supervisor.lock')
      // A supervisor may be waiting for a crashed Hub's writer lease before it can
      // publish its endpoint. Repeated edge retries must not spawn losing owners.
      if (!existsSync(owner) || !(await lockfile.check(owner, { stale: 5000 })))
        launch(config, 'supervisor')
      return await waitForSocket(path, signal)
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error
    return waitForSocket(path, signal)
  }
}

export async function withStartupLock<T>(root: string, action: () => Promise<T>, wait = false) {
  const path = join(root, 'startup.lock')
  ensureFile(path)
  const unlock = await lockfile.lock(path, {
    retries: wait ? { retries: 900, factor: 1, minTimeout: 100, maxTimeout: 100 } : 0,
    stale: 10_000
  })
  try {
    return await action()
  } finally {
    await unlock()
  }
}

export async function listenPrivate(server: Server, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const connectionListeners = isPipe(path) ? server.rawListeners('connection') : undefined
  const rejectUnprotected = (socket: Socket) => socket.destroy()
  if (connectionListeners) {
    server.removeAllListeners('connection')
    server.on('connection', rejectUnprotected)
  }
  await new Promise<void>((resolve, reject) => {
    const inspection = new AbortController()
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      server.off('error', fail)
      server.off('close', closed)
      signal?.removeEventListener('abort', abort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      inspection.abort()
      cleanup()
      server.close()
      reject(error)
    }
    const closed = () => fail(new Error('Runtime listener closed during startup.'))
    const abort = () => fail(signal?.reason ?? new Error('Runtime listener startup cancelled.'))
    let timer = setTimeout(() => fail(new Error('Runtime listener startup timed out.')), 5000)
    server.once('error', fail)
    server.once('close', closed)
    signal?.addEventListener('abort', abort, { once: true })
    const mask = process.umask(0o177)
    try {
      server.listen(path, () => {
        clearTimeout(timer)
        timer = setTimeout(() => fail(new Error('Runtime listener protection timed out.')), 15_000)
        void (async () => {
          // Reject connections until the real ACL is installed and verified.
          if (isPipe(path)) await protectPipeAsync(path, inspection.signal)
          if (settled) return
          if (connectionListeners) {
            server.off('connection', rejectUnprotected)
            for (const listener of connectionListeners)
              server.on('connection', listener as (socket: Socket) => void)
          }
          cleanup()
          settled = true
          resolve()
        })().catch((error: unknown) => {
          fail(error instanceof Error ? error : new Error(String(error)))
        })
      })
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    } finally {
      process.umask(mask)
    }
  })
  if (signal?.aborted) {
    server.close()
    signal.throwIfAborted()
  }
}
