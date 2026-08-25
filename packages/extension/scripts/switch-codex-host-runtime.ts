import { basename, extname, join, normalize, relative, resolve } from 'node:path'

export type HostProcess = {
  command: string
  pid: number
  ppid: number
}

export type SwitchPaths = {
  appPath: string
  retireAppPath: string
}

export function isPathInside(parent: string, candidate: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
}

export function parseProcessList(output: string): HostProcess[] {
  return output
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      command: match[3] ?? '',
      pid: Number(match[1]),
      ppid: Number(match[2])
    }))
}

export function parseLaunchctlLabels(output: string, prefix: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
    .filter((label) => label.startsWith(prefix))
}

export function processBelongsToApp(process: HostProcess, appPath: string): boolean {
  return process.command.startsWith(`${normalize(resolve(appPath))}/Contents/`)
}

export function processRunsRetiredHostHelper(
  process: HostProcess,
  retireAppPath: string,
  reinstallScriptPath: string
): boolean {
  return (
    process.command.includes(normalize(resolve(reinstallScriptPath))) &&
    process.command.includes(normalize(resolve(retireAppPath)))
  )
}

export function resolveSwitchPaths(
  appPath: string,
  retireAppPath: string,
  userHome: string
): SwitchPaths {
  const resolvedAppPath = normalize(resolve(appPath))
  const resolvedRetireAppPath = normalize(resolve(retireAppPath))
  const userApplications = join(resolve(userHome), 'Applications')

  if (extname(resolvedAppPath) !== '.app') {
    throw new Error(`The target Codex host must be an app bundle: ${resolvedAppPath}`)
  }
  if (extname(resolvedRetireAppPath) !== '.app') {
    throw new Error(`The retired Codex host must be an app bundle: ${resolvedRetireAppPath}`)
  }
  if (resolvedAppPath === resolvedRetireAppPath) {
    throw new Error('The target and retired Codex hosts must be different app bundles.')
  }
  if (!isPathInside(userApplications, resolvedRetireAppPath)) {
    throw new Error(`The retired Codex host must be inside ${userApplications}.`)
  }

  return { appPath: resolvedAppPath, retireAppPath: resolvedRetireAppPath }
}

export function trashName(appPath: string, timestamp: string, suffix = 0): string {
  const stem = basename(appPath, '.app')
  const collisionSuffix = suffix > 0 ? `-${String(suffix)}` : ''
  return `${stem} - retired-${timestamp}${collisionSuffix}.app`
}
