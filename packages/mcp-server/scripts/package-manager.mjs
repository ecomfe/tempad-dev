import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

function invocation(command, args) {
  if (process.platform !== 'win32') return [command, args]

  // Windows .cmd shims require a shell. Run the installed CLI with Node instead,
  // keeping paths and arguments (including spaces and shell characters) intact.
  const roots = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]
  const script = command === 'npm' ? 'npm-cli.js' : 'pnpm.cjs'
  const inherited = process.env.npm_execpath
  const candidates = [
    ...(command === 'pnpm' && inherited && /^pnpm\.(?:c?js|mjs|exe)$/i.test(basename(inherited))
      ? [inherited]
      : []),
    ...roots.map((root) => join(root, 'node_modules', command, 'bin', script)),
    ...roots.map((root) => join(root, `${command}.exe`))
  ]
  const entry = candidates.find((path) => existsSync(path))
  if (!entry) throw new Error(`Cannot locate the installed ${command} CLI without a shell.`)
  return /\.exe$/i.test(entry) ? [entry, args] : [process.execPath, [entry, ...args]]
}

export function runPackageManagerSync(command, args, options) {
  return execFileSync(...invocation(command, args), options)
}

export function runPackageManager(command, args, options) {
  return exec(...invocation(command, args), options)
}
