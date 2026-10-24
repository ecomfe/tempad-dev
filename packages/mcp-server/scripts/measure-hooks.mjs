import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import { summarize } from './runtime-contract.mjs'

const { values } = parseArgs({
  options: {
    hook: { type: 'string' },
    output: { type: 'string' },
    runs: { type: 'string', default: '30' }
  }
})
const runs = Number(values.runs)
if (process.platform === 'win32')
  throw new Error('Hook measurement requires isolated Unix sockets.')
if (!values.hook || !values.output || !Number.isInteger(runs) || runs < 1 || runs > 1000)
  throw new Error('Usage: measure-hooks.mjs --hook <lifecycle.mjs> --output <new.json> [--runs 30]')
const hook = await realpath(resolve(values.hook))

async function invocation(fault) {
  const root = await realpath(await mkdtemp('/tmp/tp-hm-'))
  const sockets = new Set()
  const pending = []
  const observations = { received: 0, commits: 0, output: '', exitCode: null }
  const started = performance.now()
  let child
  let inputTimer
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data
      const end = buffer.indexOf('\n')
      if (end < 0) return
      socket.removeAllListeners('data')
      const work = (async () => {
        const request = JSON.parse(buffer.slice(0, end))
        assert.equal(request.method, 'tempad/client-hook')
        observations.received++
        observations.receivedMs = performance.now() - started
        observations.request = request.params
        if (fault === 'before-commit') {
          socket.destroy()
          return
        }
        if (fault === 'slow-commit') await setTimeout(900)
        if (fault === 'commit-failed') {
          socket.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32603, message: 'Injected storage failure' }
            }) + '\n'
          )
          return
        }
        const temporary = join(root, 'event.tmp')
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(JSON.stringify(request))
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temporary, join(root, 'event.json'))
        const directory = await open(root, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
        observations.commits++
        observations.committedMs = performance.now() - started
        if (fault === 'lost-ack') return
        if (!socket.destroyed)
          socket.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                output: {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    additionalContext: 'isolated-hook-reply'
                  }
                }
              }
            }) + '\n'
          )
      })()
      // Attach a rejection handler immediately; propagate it after the child has exited.
      pending.push(
        work.then(
          () => undefined,
          (error) => error
        )
      )
    })
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(join(root, 'mcp.sock'), resolve)
    })
    await chmod(join(root, 'mcp.sock'), 0o600)
    child = spawn(process.execPath, [hook, 'claude'], {
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, TEMPAD_MCP_RUNTIME_DIR: root },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      observations.output += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.stdin.on('error', () => {})
    const exited = once(child, 'close')
    const input = () =>
      child.stdin.end(
        JSON.stringify({
          session_id: 'isolated-runtime-probe',
          hook_event_name: 'PreToolUse',
          turn_id: 'turn'
        })
      )
    if (fault === 'before-arrival') inputTimer = globalThis.setTimeout(input, 900)
    else input()
    const watchdog = globalThis.setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
      const [code, signal] = await exited
      assert.equal(signal, null, stderr)
      observations.exitCode = code
      observations.exitedMs = performance.now() - started
    } finally {
      globalThis.clearTimeout(watchdog)
    }
    const errors = (await Promise.all(pending)).filter(Boolean)
    if (errors.length) throw errors[0]
    assert.equal(observations.exitCode, 0, stderr)
    assert.equal(observations.received, fault === 'before-arrival' ? 0 : 1)
    assert.equal(
      observations.commits,
      ['before-arrival', 'before-commit', 'commit-failed'].includes(fault) ? 0 : 1
    )
    assert.equal(Boolean(observations.output), fault === 'normal')
    return observations
  } finally {
    globalThis.clearTimeout(inputTimer)
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'close')
      child.kill('SIGKILL')
      await exited
    }
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}

const normal = []
for (let run = 0; run < runs; run++) normal.push(await invocation('normal'))
const faults = {}
for (const fault of ['slow-commit', 'before-commit', 'lost-ack', 'commit-failed', 'before-arrival'])
  faults[fault] = await invocation(fault)
await writeFile(
  resolve(values.output),
  JSON.stringify(
    {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      hook,
      hookSha256: createHash('sha256')
        .update(await readFile(hook))
        .digest('hex'),
      observedProtocol: {
        version: normal[0].request.version,
        invocationId: Boolean(normal[0].request.invocationId),
        receiptRetryProven: false
      },
      normal: Object.fromEntries(
        ['receivedMs', 'committedMs', 'exitedMs'].map((key) => [
          key,
          summarize(normal.map((sample) => sample[key]))
        ])
      ),
      faults,
      limits: [
        'Synthetic local receiver and fresh hook processes, not installed-host delivery or an implemented Hub inbox.',
        'File and directory fsync measured; this does not establish macOS F_FULLFSYNC latency or crash durability.',
        'Normal samples are idle-machine observations; injected delay is not a disk/memory-pressure benchmark.',
        'No population telemetry or hook-adoption claim; successful exit is not evidence of delivery.'
      ]
    },
    null,
    2
  ) + '\n',
  { flag: 'wx' }
)
console.error(
  `Measured ${runs} ordinary invocations and five failure boundaries; saved ${resolve(values.output)}.`
)
