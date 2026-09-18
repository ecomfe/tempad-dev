import { normalize, resolve } from 'node:path'

import { commandIncludesExactPath } from './agent-authoring-runtime-preflight'

export const devPluginName = 'tempad-dev-dev'
export const devPluginId = `${devPluginName}@${devPluginName}`

export type ReinstallArguments = {
  appPath?: string
  cdpPort: number
  cdpUrl: string
  pageUrl?: string
  restartCodex: boolean
  resumeAfterRestart: boolean
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
  '--page-url': 'pageUrl'
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
    if (Object.hasOwn(VALUE_FLAGS, argument) || argument === '--timeout-ms') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`)
      if (argument === '--timeout-ms') {
        args.timeoutMs = Number(value)
        if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0) {
          throw new Error(`Invalid --timeout-ms value: ${value}`)
        }
      } else {
        args[VALUE_FLAGS[argument as keyof typeof VALUE_FLAGS]] = value
      }
      continue
    }
    if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
    if (args.version) throw new Error(`Unexpected positional argument: ${argument}`)
    args.version = argument
  }
  return { ...args, cdpPort: localCdpPort(args.cdpUrl) }
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
): Promise<void> {
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
  if (
    version &&
    (entry.installed !== true || entry.enabled !== true || entry.version !== version)
  ) {
    throw new Error(`The installed development plugin is not enabled at version ${version}.`)
  }
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

/** Parses `ps -axo pid=,command=` output. */
function processTable(output: string): { command: string; pid: number }[] {
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    return match ? [{ command: match[2]!, pid: Number(match[1]) }] : []
  })
}

export function matchingProcesses(output: string, executable: string): number[] {
  return processTable(output)
    .filter(({ command }) => command === executable || command.startsWith(`${executable} `))
    .map(({ pid }) => pid)
}

export function checkoutRuntimeProcesses(output: string, entries: string[]): number[] {
  return processTable(output)
    .filter(({ command }) => entries.some((entry) => commandIncludesExactPath(command, entry)))
    .map(({ pid }) => pid)
}

const ownerError = 'The CDP listener does not belong to the configured Codex App.'

export function assertCdpOwner(output: string, appPids: number[], processParents = ''): void {
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
  const parents = new Map(
    processParents.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/)
      return match ? [[Number(match[1]), Number(match[2])] as const] : []
    })
  )
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
