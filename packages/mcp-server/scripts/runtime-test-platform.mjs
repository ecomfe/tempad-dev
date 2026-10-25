import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'

import { platformEnvironment } from '../src/process-environment.ts'
import { ensurePrivateDirectory, windowsPowerShellEnvironment } from '../src/runtime-platform.ts'

export async function fixtureRoot(prefix) {
  if (process.platform === 'win32') {
    const root = join(tmpdir(), `${prefix}${randomUUID()}`)
    ensurePrivateDirectory(root)
    return realpath(root)
  }
  // Short Unix paths keep nested socket names below sockaddr_un's limit.
  return realpath(await mkdtemp(join('/tmp', prefix)))
}

export function fixtureEnvironment(home, temp = home) {
  return {
    ...platformEnvironment(process.env),
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp
  }
}

export function fixtureNodeArguments(args) {
  return process.env.TEMPAD_RUNTIME_EVIDENCE_DIR
    ? ['--import', new URL('./runtime-startup-trace.mjs', import.meta.url).href, ...args]
    : args
}

/** Copy bounded fixture diagnostics before shutdown removes live ownership records. */
export async function preserveFixtureEvidence(root, failure) {
  const output = process.env.TEMPAD_RUNTIME_EVIDENCE_DIR
  if (!output) return
  try {
    if (!isAbsolute(output)) throw new Error('Runtime evidence directory must be absolute.')
    const destination = join(output, basename(root))
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'failure.txt'), `${String(failure)}\nRoot: ${root}\n`)
    let remaining = 16 * 1024 * 1024
    async function copy(directory, relative = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        const target = join(destination, relative, entry.name)
        if (entry.isDirectory()) {
          // Runtime stores and the two nested update fixtures contain the evidence;
          // packages, cached archives, images and executable bundles do not.
          if (['run', 'state', 'runtime', 'log', 'logs', 'auto', 'f'].includes(entry.name))
            await copy(path, join(relative, entry.name))
        } else if (entry.isFile() && /\.(?:json|log|txt|lock)$/.test(entry.name)) {
          try {
            const { size } = await stat(path)
            if (size > 2 * 1024 * 1024 || size > remaining) continue
            const bytes = await readFile(path)
            if (bytes.length > 2 * 1024 * 1024 || bytes.length > remaining) continue
            remaining -= bytes.length
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, bytes)
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
        }
      }
    }
    await copy(root)
    console.error(`Copied runtime fixture diagnostics: ${destination}`)
  } catch (error) {
    // Diagnostics must never replace the test failure or prevent fixture shutdown.
    console.error(`Could not copy runtime fixture diagnostics: ${error.message}`)
  }
}

function powershell(script) {
  return execFileSync(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $ErrorActionPreference = 'Stop'; ${script}`
    ],
    { encoding: 'utf8', windowsHide: true, env: windowsPowerShellEnvironment() }
  ).trim()
}

export function processInventory() {
  if (process.platform === 'win32')
    return JSON.parse(
      powershell(
        '@(Get-CimInstance Win32_Process | Select-Object @{n="pid";e={$_.ProcessId}}, @{n="command";e={$_.CommandLine}}) | ConvertTo-Json -Compress'
      )
    ).filter((entry) => entry.command)
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.*)$/)
      return { pid: Number(match[1]), command: match[2] }
    })
}

export function commandArguments(command) {
  // Fixture arguments contain neither embedded quotes nor escaped quote sequences.
  // Windows quotes paths with spaces; ps prints the same paths without quotes on Unix.
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2])
}

export function fixtureProcesses(root, entry) {
  return processInventory().filter(({ command }) => {
    const args = commandArguments(command)
    const index = args.indexOf('--root')
    const executable = args[index - 1]
    return (
      index > 0 &&
      args[index + 1] === root &&
      (executable === entry || executable.startsWith(`${entry}${sep}`))
    )
  })
}

export function processMemory(pids) {
  if (process.platform === 'win32')
    return JSON.parse(
      powershell(
        `@(Get-Process -Id ${pids.join(',')} | Select-Object @{n="pid";e={$_.Id}}, @{n="rssKiB";e={[math]::Ceiling($_.WorkingSet64 / 1024)}}) | ConvertTo-Json -Compress`
      )
    )
  return execFileSync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, rssKiB] = line.trim().split(/\s+/).map(Number)
      return { pid, rssKiB }
    })
}
