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
import { z } from 'zod'

import { hubEnvironment } from '../process-environment'
import { assertTrustedSocket, ensureFile, ensureDir } from '../shared'

const ConfigSchema = z
  .object({
    version: z.literal(1),
    entry: z.string(),
    bundle: z.string().regex(/^[a-f0-9]{64}$/),
    secret: z.uuid()
  })
  .strict()
export type PrototypeConfig = z.infer<typeof ConfigSchema> & { root: string }

export function prototypeConfig(root: string, entry: string): PrototypeConfig {
  if (process.platform === 'win32')
    throw new Error('The runtime prototype requires isolated Unix sockets.')
  root = realpathSync(root)
  ensureDir(root)
  const directory = dirname(entry)
  const hash = createHash('sha256')
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.mjs'))
    .sort())
    hash
      .update(name)
      .update('\0')
      .update(readFileSync(join(directory, name)))
  const bundle = hash.digest('hex')
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
  if (config.entry !== entry || config.bundle !== bundle)
    throw new Error('Runtime prototype bundle changed. Stop the isolated run and use a fresh root.')
  return { ...config, root }
}

export function launch(config: PrototypeConfig, role: 'supervisor' | 'hub') {
  const child = spawn(process.execPath, [config.entry, '--root', config.root, '--role', role], {
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
  throw new Error('Runtime process did not publish its endpoint.')
}

export function unavailableSocket(error: unknown) {
  return ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')
}

export async function supervisorConnection(config: PrototypeConfig, signal: AbortSignal) {
  const path = join(config.root, 'supervisor.sock')
  try {
    return await connectSocket(path, signal)
  } catch (error) {
    if (!unavailableSocket(error)) throw error
  }
  const lockPath = join(config.root, 'startup.lock')
  ensureFile(lockPath)
  let unlock: (() => Promise<void>) | undefined
  try {
    unlock = await lockfile.lock(lockPath, { retries: 0, stale: 10000 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error
    return waitForSocket(path, signal)
  }
  try {
    try {
      return await connectSocket(path, signal)
    } catch (error) {
      if (!unavailableSocket(error)) throw error
    }
    signal.throwIfAborted()
    launch(config, 'supervisor')
    return await waitForSocket(path, signal)
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

export function hasHubRecord(root: string) {
  return existsSync(join(root, 'run', 'hub-runtime.json'))
}
