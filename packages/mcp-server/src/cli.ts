#!/usr/bin/env node

import type { ChildProcess } from 'node:child_process'
import type { Socket } from 'node:net'

import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'

import { PACKAGE_VERSION, log, LOCK_PATH, RUNTIME_DIR, SOCK_PATH, ensureDir } from './shared'

let activeSocket: Socket | null = null
let shuttingDown = false

function closeActiveSocket() {
  if (!activeSocket) return
  try {
    activeSocket.end()
  } catch {
    // ignore
  }
  try {
    activeSocket.destroy()
  } catch {
    // ignore
  }
  activeSocket = null
}

function shutdownCli(reason: string) {
  if (shuttingDown) return
  shuttingDown = true
  log.info(`${reason} Shutting down CLI.`)
  closeActiveSocket()
  process.exit(0)
}

process.on('SIGINT', () => shutdownCli('SIGINT received.'))
process.on('SIGTERM', () => shutdownCli('SIGTERM received.'))

const HUB_STARTUP_TIMEOUT = 5000
const CONNECT_RETRY_DELAY = 200
const FAILED_RESTART_DELAY = 5000
const HERE = fileURLToPath(new URL('.', import.meta.url))
const HUB_ENTRY = join(HERE, 'hub.mjs')

ensureDir(RUNTIME_DIR)

function bridge(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    log.info('Bridge established with Hub. Forwarding I/O.')
    activeSocket = socket

    const onStdinEnd = () => {
      shutdownCli('Consumer stream ended.')
    }
    process.stdin.once('end', onStdinEnd)

    const onSocketClose = () => {
      log.warn('Connection to Hub lost. Attempting to reconnect...')
      activeSocket = null
      process.stdin.removeListener('end', onStdinEnd)
      process.stdin.unpipe(socket)
      socket.unpipe(process.stdout)
      socket.removeAllListeners()
      resolve()
    }
    socket.once('close', onSocketClose)
    socket.on('error', (err) => log.warn({ err }, 'Socket error occurred.'))

    // The `{ end: false }` option prevents stdin from closing the socket.
    process.stdin.pipe(socket, { end: false }).pipe(process.stdout)
  })
}

function connectHub(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCK_PATH)
    socket.on('connect', () => {
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.on('error', reject)
  })
}

async function connectWithRetry(timeout: number): Promise<Socket> {
  const startTime = Date.now()
  let delay = CONNECT_RETRY_DELAY
  while (Date.now() - startTime < timeout) {
    try {
      return await connectHub()
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err.code === 'ENOENT' || err.code === 'ECONNREFUSED')
      ) {
        const remainingTime = timeout - (Date.now() - startTime)
        const waitTime = Math.min(delay, remainingTime)
        if (waitTime <= 0) break
        await new Promise((r) => setTimeout(r, waitTime))
        delay = Math.min(delay * 1.5, 1000)
      } else {
        throw err
      }
    }
  }
  throw new Error(`Failed to connect to Hub within ${timeout}ms.`)
}

function startHub(): ChildProcess {
  log.info('Spawning new Hub process...')
  return spawn(process.execPath, [HUB_ENTRY], {
    detached: true,
    stdio: 'ignore'
  })
}

async function tryBecomeLeaderAndStartHub(): Promise<Socket> {
  let releaseLock: (() => Promise<void>) | null = null
  try {
    releaseLock = await lockfile.lock(LOCK_PATH, {
      retries: { retries: 5, factor: 1.2, minTimeout: 50 },
      stale: 15000
    })
  } catch {
    log.info('Another process is starting the Hub. Waiting...')
    return connectWithRetry(HUB_STARTUP_TIMEOUT)
  }

  log.info('Acquired lock. Starting Hub as the leader...')
  let child: ChildProcess | null = null
  try {
    try {
      return await connectHub()
    } catch {
      // If the Hub is not running, we proceed to start it.
      log.info('Hub not running. Proceeding to start it...')
    }
    child = startHub()
    child.on('error', (err) => log.error({ err }, 'Hub child process error.'))
    const socket = await connectWithRetry(HUB_STARTUP_TIMEOUT)
    child.unref()
    return socket
  } catch (err: unknown) {
    log.error({ err }, 'Failed to start or connect to the Hub.')
    if (child && !child.killed) {
      log.warn(`Killing stale Hub process (PID: ${child.pid})...`)
      child.kill('SIGTERM')
    }
    throw err
  } finally {
    if (releaseLock) await releaseLock()
  }
}

async function main() {
  log.info({ version: PACKAGE_VERSION }, 'TemPad MCP Client starting...')

  while (true) {
    try {
      const socket = await connectHub().catch(() => {
        log.info('Hub not running. Initiating startup sequence...')
        return tryBecomeLeaderAndStartHub()
      })
      await bridge(socket)
      log.info('Bridge disconnected. Restarting connection process...')
    } catch (err: unknown) {
      log.error(
        { err },
        `Connection attempt failed. Retrying in ${FAILED_RESTART_DELAY / 1000}s...`
      )
      await new Promise((r) => setTimeout(r, FAILED_RESTART_DELAY))
    }
  }
}

main()
