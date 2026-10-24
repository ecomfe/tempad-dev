// Loaded only by the explicit measurement harness, never by a distributed runtime.
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { Server } from 'node:net'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const root = process.env.TEMPAD_PROBE_ROOT
if (process.platform === 'win32' || !root || !isAbsolute(root))
  throw new Error('Runtime measurement requires an isolated Unix runtime root.')

// A CLI must fail rather than spawn an uninstrumented replacement if its fixture Hub exits.
for (const method of ['spawn', 'fork', 'exec', 'execFile']) {
  childProcess[method] = () => {
    throw new Error('The measurement harness must own every child process.')
  }
}
syncBuiltinESMExports()

const listen = Server.prototype.listen
Server.prototype.listen = function (...args) {
  const first = args[0]
  const path = typeof first === 'string' ? first : first?.path
  if (path) {
    const local = relative(root, resolve(path))
    if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
      throw new Error('Measurement refused an IPC listener outside its runtime root.')
    return listen.apply(this, args)
  }
  if (typeof first !== 'number' && !(first && typeof first === 'object' && 'port' in first))
    throw new Error('Measurement refused an unrecognized listener.')
  // Released artifacts otherwise compete for installed extensions' fixed discovery ports.
  // Only listener allocation is changed; MCP catalogs come from the unmodified artifact.
  const callback = args.findLast((value) => typeof value === 'function')
  return listen.call(
    this,
    { ...(typeof first === 'object' ? first : {}), port: 0, host: '127.0.0.1' },
    ...(callback ? [callback] : [])
  )
}
