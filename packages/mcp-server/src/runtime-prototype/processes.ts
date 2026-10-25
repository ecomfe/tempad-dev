import type { Socket } from 'node:net'

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync
} from 'node:fs'
import { connect, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'

import { hubEnvironment } from '../process-environment'
import { verifyReleaseArtifact } from '../runtime-update/artifact'
import { assertTrustedSocket, ensureFile, ensureDir } from '../shared'
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
  return join(runtime, 'runtime-hub.sock')
}

export function supervisorSocketPath(config: PrototypeConfig) {
  return join(config.directories?.runtime ?? config.root, 'supervisor.sock')
}

export function prototypeConfig(root: string, entry: string, role = 'edge'): PrototypeConfig {
  if (process.platform === 'win32')
    throw new Error('The runtime prototype requires isolated Unix sockets.')
  root = realpathSync(root)
  ensureDir(root)
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
  const stat = lstatSync(path)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error('Refusing an untrusted runtime prototype configuration.')
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
    stdio: 'ignore',
    env: hubEnvironment(process.env)
  })
  child.on('error', () => {})
  child.unref()
  return child
}

export function connectSocket(path: string, signal?: AbortSignal): Promise<Socket> {
  assertTrustedSocket(path)
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket.off('error', fail)
    }
    const fail = (error: Error) => {
      cleanup()
      socket.destroy()
      reject(error)
    }
    const abort = () => fail(new Error('Runtime connection cancelled.'))
    const timer = setTimeout(() => fail(new Error('Runtime connection timed out.')), 1000)
    socket.once('error', fail)
    socket.once('connect', () => {
      cleanup()
      resolve(socket)
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

export async function waitForSocket(path: string, signal?: AbortSignal) {
  const until = performance.now() + 5000
  do {
    try {
      return await connectSocket(path, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (!unavailableSocket(error)) throw error
      await delay(100, undefined, { signal })
    }
  } while (performance.now() < until)
  throw unavailable('Runtime process has not published its endpoint yet.')
}

export function unavailableSocket(error: unknown) {
  return ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')
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
      if (!deadline.aborted && !isRuntimeUnavailable(error)) throw error
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

export async function listenPrivate(server: Server, path: string) {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      server.off('error', fail)
      server.off('close', closed)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const closed = () => fail(new Error('Runtime listener closed during startup.'))
    const timer = setTimeout(() => fail(new Error('Runtime listener startup timed out.')), 5000)
    server.once('error', fail)
    server.once('close', closed)
    const mask = process.umask(0o177)
    try {
      server.listen(path, () => {
        cleanup()
        resolve()
      })
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    } finally {
      process.umask(mask)
    }
  })
}
