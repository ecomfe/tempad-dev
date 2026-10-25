// Opt-in process-fixture diagnostics. Never loaded by a published runtime.
import childProcess from 'node:child_process'
import { writeSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

const started = performance.now()
function trace(event) {
  writeSync(
    2,
    `Runtime startup ${JSON.stringify({ pid: process.pid, ms: Math.round(performance.now() - started), ...event })}\n`
  )
}
trace({ phase: 'entry' })
const execute = childProcess.execFileSync
childProcess.execFileSync = function (file, ...args) {
  const command = basename(file)
  trace({ phase: 'helper-start', command })
  try {
    const result = execute.call(this, file, ...args)
    trace({ phase: 'helper-end', command })
    return result
  } catch (error) {
    trace({ phase: 'helper-error', command, code: error.code })
    throw error
  }
}
syncBuiltinESMExports()
