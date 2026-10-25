import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'

import { ensurePrivateDirectory } from '../src/runtime-platform.ts'

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
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SystemRoot|WINDIR|COMSPEC|PATHEXT)$/i.test(key)
      )
    ),
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp
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
    { encoding: 'utf8', windowsHide: true }
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
