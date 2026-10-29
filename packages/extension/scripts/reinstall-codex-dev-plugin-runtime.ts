import { isAbsolute, normalize, resolve } from 'node:path'

import { processRunsRuntimeEntry, type RuntimeProcess } from './agent-authoring-runtime-preflight'

export const devPluginName = 'tempad-dev-dev'
export const devPluginId = `${devPluginName}@${devPluginName}`

export type ReinstallArguments = {
  appPath?: string
  cdpPort: number
  cdpUrl: string
  pageUrl?: string
  restartCodex: boolean
  resumeAfterRestart: boolean
  resumeThread?: string
  reportPath?: string
  timeoutMs: number
  version?: string
}

const BOOLEAN_FLAGS = {
  '--restart-codex': 'restartCodex',
  '--resume-after-restart': 'resumeAfterRestart'
} as const

const VALUE_FLAGS = {
  '--app-path': 'appPath',
  '--cdp-url': 'cdpUrl',
  '--page-url': 'pageUrl',
  '--resume-thread': 'resumeThread',
  '--report-path': 'reportPath'
} as const

export function parseReinstallArguments(argv: string[]): ReinstallArguments | null {
  if (argv.includes('--help')) return null
  const args: Omit<ReinstallArguments, 'cdpPort'> = {
    cdpUrl: process.env.CODEX_CDP_URL ?? 'http://127.0.0.1:9222',
    restartCodex: false,
    resumeAfterRestart: false,
    timeoutMs: 60_000
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (Object.hasOwn(BOOLEAN_FLAGS, argument)) {
      args[BOOLEAN_FLAGS[argument as keyof typeof BOOLEAN_FLAGS]] = true
      continue
    }
    const takeValue = () => {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`)
      return value
    }
    if (argument === '--timeout-ms') {
      const value = takeValue()
      args.timeoutMs = Number(value)
      if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${value}`)
      }
      continue
    }
    if (Object.hasOwn(VALUE_FLAGS, argument)) {
      args[VALUE_FLAGS[argument as keyof typeof VALUE_FLAGS]] = takeValue()
      continue
    }
    if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
    if (args.version) throw new Error(`Unexpected positional argument: ${argument}`)
    args.version = argument
  }
  if (args.restartCodex && args.resumeAfterRestart) throw new Error('Use only one restart mode.')
  if (args.restartCodex) args.resumeThread ??= process.env.CODEX_THREAD_ID
  if (args.resumeThread) assertThreadId(args.resumeThread)
  if ((args.restartCodex || args.resumeAfterRestart) && !args.resumeThread)
    throw new Error('Restart requires --resume-thread or CODEX_THREAD_ID to restore the task.')
  if (args.resumeAfterRestart && !args.reportPath)
    throw new Error('Detached restart requires its saved --report-path.')
  if (args.reportPath && !isAbsolute(args.reportPath))
    throw new Error('--report-path must be absolute.')
  return { ...args, cdpPort: localCdpPort(args.cdpUrl) }
}

export function assertThreadId(id: string): void {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
    throw new Error('Expected a Codex thread UUID for --resume-thread.')
}

export function threadPageUrl(pageUrl: string, threadId: string): string {
  assertThreadId(threadId)
  selectCodexPageUrl([pageUrl])
  const url = new URL(pageUrl)
  url.searchParams.set('initialRoute', `/local/${threadId}`)
  url.hash = ''
  return url.href
}

export function resolveDevPluginVersion(input: unknown, requested?: string): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Generated development plugin manifest must be an object.')
  }
  const manifest = input as Record<string, unknown>
  if (manifest.name !== 'tempad-dev-dev' || typeof manifest.version !== 'string') {
    throw new Error('Generated development plugin manifest has an unexpected identity.')
  }
  if (requested && requested !== manifest.version) {
    throw new Error(
      `Generated plugin version is ${manifest.version}, not ${requested}. ` +
        'Run pnpm agent-plugin:build, then omit the version or pass the generated value.'
    )
  }
  return manifest.version
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object from the Codex plugin CLI.')
  }
  return value as Record<string, unknown>
}

function assertLocalPlugin(entry: Record<string, unknown>, pluginRoot: string): void {
  const source = objectValue(entry.source)
  const marketplace = objectValue(entry.marketplaceSource)
  if (
    entry.name !== devPluginName ||
    entry.marketplaceName !== devPluginName ||
    source.source !== 'local' ||
    typeof source.path !== 'string' ||
    normalize(source.path) !== normalize(pluginRoot) ||
    marketplace.sourceType !== 'local' ||
    typeof marketplace.source !== 'string' ||
    normalize(marketplace.source) !== resolve(pluginRoot, '../..')
  ) {
    throw new Error(
      'The configured development marketplace must point at this checkout’s local generated plugin.'
    )
  }
}

/** CLI discovery validates the source on disk; it never substitutes for App installation. */
export async function inspectDevPlugin(
  runCodex: (args: string[]) => Promise<unknown>,
  pluginRoot: string,
  version?: string
): Promise<boolean> {
  const listed = objectValue(
    await runCodex(['plugin', 'list', '--available', '--json', '--marketplace', devPluginName])
  )
  if (!Array.isArray(listed.installed) || !Array.isArray(listed.available)) {
    throw new Error('Codex did not return installed and available plugin lists.')
  }
  const candidates = [...listed.installed, ...listed.available]
    .map(objectValue)
    .filter((entry) => entry.pluginId === devPluginId)
  if (candidates.length !== 1) {
    throw new Error('Expected exactly one development plugin in the configured local marketplace.')
  }
  const entry = candidates[0]!
  assertLocalPlugin(entry, pluginRoot)
  if (typeof entry.installed !== 'boolean')
    throw new Error('Codex did not report whether the development plugin is installed.')
  if (
    version &&
    (entry.installed !== true || entry.enabled !== true || entry.version !== version)
  ) {
    throw new Error(`The installed development plugin is not enabled at version ${version}.`)
  }
  return entry.installed
}

/** An empty snapshot is insufficient: a host can respawn its MCP process after uninstall. */
export async function stopRuntimeProcesses(
  list: () => Promise<number[]>,
  terminate: (pid: number) => void,
  options: {
    timeoutMs?: number
    quietMs?: number
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  } = {}
): Promise<number[]> {
  const {
    timeoutMs = 15_000,
    quietMs = 1500,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now
  } = options
  const stopped = await list()
  for (const pid of stopped) {
    try {
      terminate(pid)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const deadline = now() + timeoutMs
  let quietSince: number | undefined
  do {
    const remaining = await list()
    if (remaining.some((pid) => !stopped.includes(pid)))
      throw new Error(
        'Checkout MCP processes respawned after uninstall; stop the owning host before reinstalling.'
      )
    if (remaining.length) quietSince = undefined
    else quietSince ??= now()
    if (quietSince !== undefined && now() - quietSince >= quietMs) return stopped
    await sleep(250)
  } while (now() < deadline)
  throw new Error('Timed out waiting for this checkout’s MCP processes to remain stopped.')
}

export function localCdpPort(value: string): number {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('CDP must use a loopback HTTP origin, such as http://127.0.0.1:9222.')
  return Number(url.port || 80)
}

export function cdpWebSocketUrl(input: unknown, cdpUrl: string): string {
  const value = objectValue(input).webSocketDebuggerUrl
  if (typeof value !== 'string') throw new Error('CDP did not return a browser WebSocket URL.')
  const url = new URL(value)
  if (
    url.protocol !== 'ws:' ||
    !url.pathname.startsWith('/devtools/browser/') ||
    localCdpPort(`http://${url.host}`) !== localCdpPort(cdpUrl) ||
    url.username ||
    url.password
  ) {
    throw new Error('CDP returned a WebSocket URL outside the verified local listener.')
  }
  return value
}

export function selectCodexPageUrl(urls: string[], requested?: string): string {
  const pages = urls.filter((value) => {
    try {
      const url = new URL(value)
      return (
        url.protocol === 'app:' &&
        url.pathname === '/index.html' &&
        !url.searchParams.get('initialRoute')?.startsWith('/avatar-overlay')
      )
    } catch {
      return false
    }
  })
  const exact = requested ? pages.filter((url) => url === requested) : []
  const matches = exact.length
    ? exact
    : pages.filter((url) => !requested || url.includes(requested))
  if (matches.length !== 1) {
    throw new Error(
      `Expected one Codex App page, found ${matches.length}. Use --page-url to select it.\n${pages.join('\n')}`
    )
  }
  return matches[0]!
}

export function matchingProcesses(processes: RuntimeProcess[], executable: string): number[] {
  return processes
    .filter(
      (process) =>
        process.executable === executable &&
        (process.command === executable || process.command.startsWith(`${executable} `))
    )
    .map(({ pid }) => pid)
}

export function checkoutRuntimeProcesses(processes: RuntimeProcess[], entries: string[]): number[] {
  return processes
    .filter((process) => entries.some((entry) => processRunsRuntimeEntry(process, entry)))
    .map(({ pid }) => pid)
}

const ownerError = 'The CDP listener does not belong to the configured Codex App.'

export function assertCdpOwner(
  output: string,
  appPids: number[],
  processes: RuntimeProcess[] = []
): void {
  if (appPids.length !== 1) throw new Error(ownerError)
  const appPid = appPids[0]!
  const listeners = [
    ...new Set(
      output
        .split('\n')
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => Number(line.slice(1)))
    )
  ]
  const parents = new Map(processes.map(({ pid, ppid }) => [pid, ppid] as const))
  // App child services can inherit the same listening descriptor.
  const belongsToApp = (listener: number): boolean => {
    const visited = new Set<number>()
    let current = listener
    while (!visited.has(current)) {
      if (current === appPid) return true
      visited.add(current)
      const parent = parents.get(current)
      if (parent === undefined) return false
      current = parent
    }
    return false
  }
  if (!listeners.includes(appPid) || !listeners.every(belongsToApp)) throw new Error(ownerError)
}

export const restartJobPrefix = 'com.tempad-dev.codex-plugin-reinstall.'

export function assertNoRestartJob(output: string): void {
  if (
    output.split('\n').some((line) => line.trim().split(/\s+/).at(-1)?.startsWith(restartJobPrefix))
  ) {
    throw new Error('A detached Codex plugin reinstall is already running.')
  }
}
