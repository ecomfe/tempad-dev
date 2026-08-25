import { execFile } from 'node:child_process'
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  type HostProcess,
  parseLaunchctlLabels,
  parseProcessList,
  processBelongsToApp,
  processRunsRetiredHostHelper,
  resolveSwitchPaths,
  trashName
} from './switch-codex-host-runtime'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const scriptPath = fileURLToPath(import.meta.url)
const logPath = join(repoRoot, '.dev/codex-host-switch.log')
const statusPath = join(repoRoot, '.dev/codex-host-switch.status.json')
const pollIntervalMs = 500
const detachedHandoffDelayMs = 2_500
const expectedBundleId = 'com.openai.codex'
const reinstallJobPrefix = 'com.tempad-dev.codex-plugin-reinstall.'
const reinstallScriptPath = join(
  repoRoot,
  'packages/extension/scripts/reinstall-codex-dev-plugin.ts'
)

type Arguments = {
  appPath: string
  cdpUrl: string
  dryRun: boolean
  resumeDetached: boolean
  retireAppPath: string
  timeoutMs: number
}

type SwitchStatus = {
  completedAt?: string
  error?: string
  retiredAppPath?: string
  startedAt: string
  targetAppPath: string
}

function fail(message: string): never {
  throw new Error(message)
}

function usage(): string {
  return [
    'Retire an old Codex host and start the current installed version from a detached helper:',
    '',
    '  pnpm codex-host:switch',
    '  pnpm codex-host:switch --dry-run',
    '',
    'Options:',
    '  --retire-app-path <path> Old host to move to Trash (default: ~/Applications/ChatGPT Eval.app)',
    '  --app-path <path>        Current host to start (default: /Applications/ChatGPT.app)',
    '  --cdp-url <url>          Current host CDP endpoint (default: http://127.0.0.1:9222)',
    '  --timeout-ms <number>    Timeout for each shutdown/startup transition (default: 60000)',
    '  --dry-run                Validate and print the detached operation without changing state',
    '  --help                   Show this help'
  ].join('\n')
}

function parseArguments(argv: string[]): Arguments | null {
  if (argv.includes('--help')) return null

  let appPath = process.env.CODEX_APP_PATH ?? '/Applications/ChatGPT.app'
  let cdpUrl = process.env.CODEX_CDP_URL ?? 'http://127.0.0.1:9222'
  let dryRun = false
  let resumeDetached = false
  let retireAppPath =
    process.env.CODEX_RETIRED_APP_PATH ?? join(homedir(), 'Applications/ChatGPT Eval.app')
  let timeoutMs = 60_000

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument) continue
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--resume-detached') {
      resumeDetached = true
      continue
    }
    if (
      argument === '--app-path' ||
      argument === '--cdp-url' ||
      argument === '--retire-app-path' ||
      argument === '--timeout-ms'
    ) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`Missing value for ${argument}.`)
      index += 1
      if (argument === '--app-path') appPath = value
      if (argument === '--cdp-url') cdpUrl = value
      if (argument === '--retire-app-path') retireAppPath = value
      if (argument === '--timeout-ms') {
        timeoutMs = Number(value)
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
          fail(`Invalid --timeout-ms value: ${value}`)
        }
      }
      continue
    }
    fail(`Unknown option: ${argument}`)
  }

  const paths = resolveSwitchPaths(appPath, retireAppPath, homedir())
  return { ...paths, cdpUrl, dryRun, resumeDetached, timeoutMs }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cdpPort(cdpUrl: string): number {
  const url = new URL(cdpUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    fail('The Codex host switch requires a local HTTP CDP URL.')
  }
  const port = Number(url.port || 80)
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    fail(`Invalid CDP port in ${cdpUrl}.`)
  }
  return port
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function assertCodexBundle(appPath: string): Promise<void> {
  await access(join(appPath, 'Contents/MacOS/ChatGPT'))
  const { stdout } = await execFileAsync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents/Info.plist')],
    { encoding: 'utf8' }
  )
  if (stdout.trim() !== expectedBundleId) {
    fail(`${appPath} has unexpected bundle identifier ${stdout.trim()}.`)
  }
}

async function listProcesses(): Promise<HostProcess[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  return parseProcessList(stdout)
}

async function listHostProcesses(appPaths: string[]): Promise<HostProcess[]> {
  return (await listProcesses()).filter((hostProcess) =>
    appPaths.some((appPath) => processBelongsToApp(hostProcess, appPath))
  )
}

async function listRetiredHostHelpers(retireAppPath: string): Promise<HostProcess[]> {
  return (await listProcesses()).filter((hostProcess) =>
    processRunsRetiredHostHelper(hostProcess, retireAppPath, reinstallScriptPath)
  )
}

async function listReinstallJobs(): Promise<string[]> {
  const { stdout } = await execFileAsync('/bin/launchctl', ['list'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  return parseLaunchctlLabels(stdout, reinstallJobPrefix)
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  fail(`Timed out waiting for ${description}.`)
}

function signalProcesses(processes: HostProcess[], signal: NodeJS.Signals): void {
  for (const hostProcess of processes) {
    try {
      process.kill(hostProcess.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}

async function stopHosts(appPaths: string[], timeoutMs: number): Promise<void> {
  const initial = await listHostProcesses(appPaths)
  if (initial.length === 0) {
    console.log('No processes from either Codex host are running.')
    return
  }

  console.log(`Stopping ${String(initial.length)} verified Codex host process(es)...`)
  signalProcesses(initial, 'SIGTERM')
  try {
    await waitUntil(
      async () => (await listHostProcesses(appPaths)).length === 0,
      'both Codex hosts to stop',
      Math.min(timeoutMs, 15_000)
    )
  } catch {
    const remaining = await listHostProcesses(appPaths)
    console.warn(
      `Graceful shutdown left ${String(remaining.length)} verified process(es); terminating them.`
    )
    signalProcesses(remaining, 'SIGKILL')
    await waitUntil(
      async () => (await listHostProcesses(appPaths)).length === 0,
      'both Codex hosts to stop after forced termination',
      timeoutMs
    )
  }
}

async function stopRetiredHostHelpers(retireAppPath: string, timeoutMs: number): Promise<void> {
  const jobs = await listReinstallJobs()
  for (const job of jobs) {
    console.log(`Removing stale reinstall job ${job}...`)
    await execFileAsync('/bin/launchctl', ['remove', job])
  }

  const helpers = await listRetiredHostHelpers(retireAppPath)
  if (helpers.length === 0) return

  console.log(`Stopping ${String(helpers.length)} stale retired-host helper process(es)...`)
  signalProcesses(helpers, 'SIGTERM')
  try {
    await waitUntil(
      async () => (await listRetiredHostHelpers(retireAppPath)).length === 0,
      'stale retired-host helpers to stop',
      Math.min(timeoutMs, 10_000)
    )
  } catch {
    const remaining = await listRetiredHostHelpers(retireAppPath)
    signalProcesses(remaining, 'SIGKILL')
    await waitUntil(
      async () => (await listRetiredHostHelpers(retireAppPath)).length === 0,
      'stale retired-host helpers to stop after forced termination',
      timeoutMs
    )
  }
}

function timestampForPath(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

async function nextTrashPath(appPath: string): Promise<string> {
  const trashDirectory = join(homedir(), '.Trash')
  await mkdir(trashDirectory, { recursive: true })
  const timestamp = timestampForPath(new Date())
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const destination = join(trashDirectory, trashName(appPath, timestamp, suffix))
    if (!(await exists(destination))) return destination
  }
  fail(`Could not choose a unique Trash destination for ${appPath}.`)
}

async function retireHost(appPath: string): Promise<string | undefined> {
  if (!(await exists(appPath))) {
    console.log(`The retired Codex host is already absent: ${appPath}`)
    return undefined
  }
  const destination = await nextTrashPath(appPath)
  await rename(appPath, destination)
  console.log(`Moved the retired Codex host to Trash: ${destination}`)
  return destination
}

async function isCdpReady(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/json/version', cdpUrl), {
      signal: AbortSignal.timeout(1_000)
    })
    return response.ok
  } catch {
    return false
  }
}

async function startCurrentHost(args: Arguments): Promise<void> {
  const port = cdpPort(args.cdpUrl)
  console.log(`Starting ${args.appPath} with --remote-debugging-port=${String(port)}...`)
  await execFileAsync('/usr/bin/open', [
    '-n',
    args.appPath,
    '--args',
    `--remote-debugging-port=${String(port)}`
  ])
  await waitUntil(
    async () =>
      (await listHostProcesses([args.appPath])).some(({ command }) =>
        command.startsWith(`${args.appPath}/Contents/MacOS/ChatGPT`)
      ),
    'the current Codex host process to start',
    args.timeoutMs
  )
  await waitUntil(
    () => isCdpReady(args.cdpUrl),
    `Codex CDP endpoint ${args.cdpUrl}`,
    args.timeoutMs
  )
  console.log(`Current Codex host is ready at ${args.cdpUrl}.`)
}

async function writeStatus(status: SwitchStatus): Promise<void> {
  await mkdir(dirname(statusPath), { recursive: true })
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`)
}

async function runDetached(args: Arguments): Promise<void> {
  const status: SwitchStatus = {
    startedAt: new Date().toISOString(),
    targetAppPath: args.appPath
  }
  await writeStatus(status)
  try {
    console.log(
      'Detached helper owns the host switch; shutdown begins after a short handoff delay.'
    )
    await new Promise((resolve) => setTimeout(resolve, detachedHandoffDelayMs))
    console.log(`Retiring ${args.retireAppPath} and switching to ${args.appPath}.`)
    await stopRetiredHostHelpers(args.retireAppPath, args.timeoutMs)
    await stopHosts([args.retireAppPath, args.appPath], args.timeoutMs)
    status.retiredAppPath = await retireHost(args.retireAppPath)
    await startCurrentHost(args)
    status.completedAt = new Date().toISOString()
    await writeStatus(status)
  } catch (error) {
    status.completedAt = new Date().toISOString()
    status.error = errorMessage(error)
    await writeStatus(status)
    throw error
  }
}

async function startDetached(args: Arguments): Promise<void> {
  if (
    process.execPath.startsWith(`${args.appPath}/Contents/`) ||
    process.execPath.startsWith(`${args.retireAppPath}/Contents/`)
  ) {
    fail(`Refusing to use a Node runtime inside a Codex app bundle: ${process.execPath}`)
  }
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, '')

  const jobLabel = `com.tempad-dev.codex-host-switch.${String(process.pid)}.${String(Date.now())}`
  const childArguments = [
    ...process.execArgv,
    scriptPath,
    '--resume-detached',
    '--retire-app-path',
    args.retireAppPath,
    '--app-path',
    args.appPath,
    '--cdp-url',
    args.cdpUrl,
    '--timeout-ms',
    String(args.timeoutMs)
  ]
  await execFileAsync(
    '/bin/launchctl',
    [
      'submit',
      '-l',
      jobLabel,
      '-o',
      logPath,
      '-e',
      logPath,
      '--',
      '/bin/sh',
      '-c',
      '"$@"\nstatus=$?\n/bin/launchctl remove "$0"\nexit "$status"',
      jobLabel,
      process.execPath,
      ...childArguments
    ],
    { cwd: repoRoot }
  )

  console.log(`Detached Codex host switch submitted as ${jobLabel}.`)
  console.log(`Progress: ${logPath}`)
  console.log(`Status: ${statusPath}`)
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') fail('The Codex host switch is supported only on macOS.')
  const args = parseArguments(process.argv.slice(2))
  if (!args) {
    console.log(usage())
    return
  }

  cdpPort(args.cdpUrl)
  await assertCodexBundle(args.appPath)
  if (await exists(args.retireAppPath)) await assertCodexBundle(args.retireAppPath)

  if (args.dryRun) {
    console.log(`Would move ${args.retireAppPath} to Trash.`)
    console.log(`Would start ${args.appPath} with CDP at ${args.cdpUrl}.`)
    console.log(`Detached runtime: ${process.execPath}`)
    return
  }
  if (args.resumeDetached) {
    await runDetached(args)
    return
  }
  await startDetached(args)
}

main().catch((error) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
