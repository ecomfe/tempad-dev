import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

function pnpmPackageEntry(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
    return manifest.name === 'pnpm' && typeof bin === 'string' && /\.(?:exe|[cm]?js)$/i.test(bin)
      ? join(directory, bin)
      : undefined
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function* windowsEntries(command) {
  const path = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const inherited = process.env.npm_execpath
  // pnpm's version manager prepends its selected tool to PATH but can leave
  // npm_execpath pointing at the bootstrap version. Resolve each PATH entry first.
  if (command === 'pnpm') {
    for (const root of path) {
      yield join(root, 'pnpm.exe')
      yield pnpmPackageEntry(join(root, 'node_modules/pnpm'))
      yield pnpmPackageEntry(join(dirname(root), 'node_modules/pnpm'))
      yield join(root, 'node_modules/pnpm/bin/pnpm.cjs')
    }
    if (inherited && /^pnpm\.(?:c?js|mjs|exe)$/i.test(basename(inherited))) yield inherited
  } else {
    for (const root of [dirname(process.execPath), ...path]) {
      yield join(root, 'node_modules/npm/bin/npm-cli.js')
      yield join(root, 'npm.exe')
    }
  }
}

function invocation(command, args) {
  if (process.platform !== 'win32') return [command, args]
  // Windows .cmd shims require a shell. Run the installed CLI with Node instead,
  // keeping paths and arguments (including spaces and shell characters) intact.
  for (const entry of windowsEntries(command))
    if (entry && existsSync(entry))
      return /\.exe$/i.test(entry) ? [entry, args] : [process.execPath, [entry, ...args]]
  throw new Error(`Cannot locate the installed ${command} CLI without a shell.`)
}

export function runPackageManagerSync(command, args, options) {
  return execFileSync(...invocation(command, args), options)
}

export function runPackageManager(command, args, options) {
  return exec(...invocation(command, args), options)
}
