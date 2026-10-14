#!/usr/bin/env node

import type { ChildProcess } from 'node:child_process'
import type { Socket } from 'node:net'

import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'

import { runtimeIdentity } from './agent-clients/identity'
import {
  ClientBindingFilter,
  ClientBindingSubscribeSchema,
  type ClaudeBinding
} from './client-binding'
import {
  HUB_BUSY_EXIT_CODE,
  HUB_LOCK_STALE_MS,
  PACKAGE_VERSION,
  log,
  LOCK_PATH,
  RUNTIME_DIR,
  SOCK_PATH,
  ensureDir,
  assertTrustedSocket
} from './shared'

let activeSocket: Socket | null = null
let shuttingDown = false
let claudeBinding: ClaudeBinding | undefined
let claudeHintRetired = false

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
process.stdin.once('end', () => shutdownCli('Consumer stream ended.'))

const HUB_STARTUP_TIMEOUT = 5000
const CONNECT_RETRY_DELAY = 200
const FAILED_RESTART_DELAY = 5000
const HERE = fileURLToPath(new URL('.', import.meta.url))
const HUB_ENTRY = join(HERE, 'hub.mjs')

ensureDir(RUNTIME_DIR)

function bridge(socket: Socket): Promise<boolean> {
  return new Promise((resolve, reject) => {
    log.info('Bridge established with Hub. Forwarding I/O.')
    activeSocket = socket
    let receivedOutput = false
    let outputError: Error | undefined
    const output = new ClientBindingFilter((binding) => {
      receivedOutput = true
      claudeHintRetired = true
      if ('kind' in binding) claudeBinding = binding
    })
    output.on('data', () => {
      receivedOutput = true
    })
    output.on('error', (error) => {
      outputError = error
      log.warn({ error }, 'Invalid Hub output. Reconnecting.')
      socket.destroy()
    })

    const onSocketClose = () => {
      log.warn('Connection to Hub lost. Attempting to reconnect...')
      activeSocket = null
      process.stdin.unpipe(socket)
      socket.unpipe(output)
      output.unpipe(process.stdout)
      output.destroy()
      socket.removeAllListeners()
      if (outputError) reject(outputError)
      else resolve(receivedOutput)
    }
    socket.once('close', onSocketClose)
    socket.on('error', (err) => log.warn({ err }, 'Socket error occurred.'))

    const binding = claudeBinding ?? runtimeIdentity(process.env).client
    socket.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/tempad/client-event',
        params: {
          event: 'connect',
          kind: binding.kind,
          sessionId: binding.sessionId
        }
      }) + '\n'
    )
    socket.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: ClientBindingSubscribeSchema.shape.method.value,
        ...(!claudeHintRetired &&
        process.env.CLAUDE_CODE_SESSION_ID &&
        process.env.CLAUDE_CODE_SESSION_ID.length <= 256
          ? { params: { sessionId: process.env.CLAUDE_CODE_SESSION_ID } }
          : {})
      }) + '\n'
    )

    // The `{ end: false }` option prevents stdin from closing the socket.
    process.stdin.pipe(socket, { end: false })
    socket.pipe(output).pipe(process.stdout, { end: false })
  })
}

function connectHub(timeout = HUB_STARTUP_TIMEOUT): Promise<Socket> {
  return new Promise((resolve, reject) => {
    assertTrustedSocket(SOCK_PATH)
    const socket = connect(SOCK_PATH)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('error', fail)
      socket.off('close', onClose)
    }
    const fail = (error: Error) => {
      cleanup()
      socket.destroy()
      reject(error)
    }
    const onClose = () => fail(new Error('Hub socket closed before connecting.'))
    const onConnect = () => {
      cleanup()
      resolve(socket)
    }
    const timer = setTimeout(() => {
      fail(Object.assign(new Error('Hub connection timed out.'), { code: 'ETIMEDOUT' }))
    }, timeout)
    socket.once('connect', onConnect)
    socket.once('error', fail)
    socket.once('close', onClose)
  })
}

function isHubUnavailable(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')
  )
}

function isTransientConnectionError(error: unknown): boolean {
  if (isHubUnavailable(error)) return true
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'EPIPE')
  )
}

async function connectWithRetry(timeout: number): Promise<Socket> {
  const startTime = Date.now()
  let delay = CONNECT_RETRY_DELAY
  while (Date.now() - startTime < timeout) {
    try {
      return await connectHub(Math.max(1, timeout - (Date.now() - startTime)))
    } catch (err: unknown) {
      if (isHubUnavailable(err)) {
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
  throw Object.assign(new Error(`Failed to connect to Hub within ${timeout}ms.`), {
    code: 'ETIMEDOUT'
  })
}

function startHub(): ChildProcess {
  log.info('Spawning new Hub process...')
  return spawn(process.execPath, [HUB_ENTRY], {
    detached: true,
    stdio: 'ignore'
  })
}

async function waitForHubStart(child: ChildProcess): Promise<Socket> {
  let foundExistingHub = false
  child.once('exit', (code) => {
    foundExistingHub = code === HUB_BUSY_EXIT_CODE
  })

  const socket = await connectWithRetry(HUB_STARTUP_TIMEOUT)
  if (foundExistingHub) {
    log.info('Spawned Hub found an existing lifecycle lock. Using the active Hub.')
  }
  child.unref()
  return socket
}

async function tryBecomeLeaderAndStartHub(): Promise<Socket> {
  let releaseLock: (() => Promise<void>) | undefined
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
    } catch (error) {
      if (!isHubUnavailable(error)) throw error
      // If the Hub is not running, we proceed to start it.
      log.info('Hub not running. Proceeding to start it...')
    }
    child = startHub()
    child.on('error', (err) => log.error({ err }, 'Hub child process error.'))
    return await waitForHubStart(child)
  } catch (err: unknown) {
    log.error({ err }, 'Failed to start or connect to the Hub.')
    if (child && !child.killed && child.exitCode === null && child.signalCode === null) {
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
  // A killed Hub can leave valid lock leases behind. Allow their full stale
  // interval and a further startup attempt without weakening lock ownership.
  const startupDeadline = Date.now() + HUB_LOCK_STALE_MS + 2 * HUB_STARTUP_TIMEOUT
  let connected = false
  let failedAttempts = 0

  while (true) {
    try {
      const socket = await connectHub().catch((error: unknown) => {
        if (!isHubUnavailable(error)) throw error
        log.info('Hub not running. Initiating startup sequence...')
        return tryBecomeLeaderAndStartHub()
      })
      // Accepting a socket alone must not disable the initial retry limit.
      if (!(await bridge(socket))) {
        throw new Error('Hub closed before sending a valid MCP message.')
      }
      connected = true
      failedAttempts = 0
      log.info('Bridge disconnected. Restarting connection process...')
      await new Promise((r) => setTimeout(r, CONNECT_RETRY_DELAY))
    } catch (err: unknown) {
      const transient = isTransientConnectionError(err)
      if (connected && transient) failedAttempts = 0
      else failedAttempts++
      if (failedAttempts >= 3 && (!transient || Date.now() >= startupDeadline)) {
        const reason = err instanceof Error ? err.message : String(err)
        process.stderr.write(
          `Unable to connect to TemPad Hub after ${failedAttempts} ${connected ? 'reconnect' : 'startup'} attempts: ${reason} Reconnect the MCP client after resolving the connection error.\n`
        )
        process.stdin.pause()
        process.exitCode = 1
        return
      }
      log.error(
        { err },
        `Connection attempt failed. Retrying in ${FAILED_RESTART_DELAY / 1000}s...`
      )
      await new Promise((r) => setTimeout(r, FAILED_RESTART_DELAY))
    }
  }
}

void main()
