import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  assertNoDetachedReinstallJobs,
  detachedReinstallIdentity,
  detachedReinstallJobPrefix,
  runtimeStateMatches
} from './reinstall-codex-dev-plugin-runtime'
import { parseLaunchctlLabels } from './switch-codex-host-runtime'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const pluginRoot = join(repoRoot, '.dev/plugins/tempad-dev-dev')
const scriptPath = fileURLToPath(import.meta.url)
const pluginDisplayName = 'TemPad Dev (Dev)'
const pluginName = 'tempad-dev-dev'
const pollIntervalMs = 500
const pageFunctionDeclaration = `function (request) {
  const isVisible = (element) =>
    Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
  const findElement = (query) => {
    const match = [...document.querySelectorAll(query.selector)].find(
      (element) =>
        (query.visible === false || isVisible(element)) &&
        (query.leafOnly !== true || element.children.length === 0) &&
        (query.text === undefined || element.textContent.trim() === query.text) &&
        (query.ariaLabel === undefined ||
          element.getAttribute('aria-label') === query.ariaLabel)
    )
    return match && query.closest ? match.closest(query.closest) : match || null
  }
  const pluginState = () => {
    if (findElement({ selector: 'button', ariaLabel: 'More actions' })) return 'installed'
    if (findElement({ selector: 'button', text: 'Install plugin' })) return 'uninstalled'
    return null
  }

  if (request.action === 'body-includes') {
    return Boolean(document.body && document.body.innerText.includes(request.text))
  }
  if (request.action === 'element-exists') {
    return Boolean(findElement(request.query))
  }
  if (request.action === 'element-center') {
    const element = findElement(request.query)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  if (request.action === 'click-element') {
    const element = findElement(request.query)
    if (!element || typeof element.click !== 'function') return false
    element.click()
    return true
  }
  if (request.action === 'plugin-state') return pluginState()
  if (request.action === 'plugin-state-is') return pluginState() === request.state
  if (request.action === 'set-input-value') {
    const input = document.querySelector(request.selector)
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) return false
    setter.call(input, request.value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  throw new Error('Unknown Codex page action.')
}`

type Arguments = {
  appPath: string
  cdpUrl: string
  pageUrl?: string
  restartCodex: boolean
  resumeAfterRestart: boolean
  timeoutMs: number
  version: string
}

type ProcessInfo = {
  command: string
  pid: number
  ppid: number
}

type RuntimeProcesses = {
  cli: ProcessInfo[]
  hub: ProcessInfo[]
}

type RuntimePaths = {
  cli: string
  hub: string
}

type PluginState = 'installed' | 'uninstalled'

type PageElementQuery = {
  ariaLabel?: string
  closest?: string
  leafOnly?: boolean
  selector: string
  text?: string
  visible?: boolean
}

type PageRequest =
  | { action: 'body-includes'; text: string }
  | {
      action: 'click-element' | 'element-center' | 'element-exists'
      query: PageElementQuery
    }
  | { action: 'plugin-state' }
  | { action: 'plugin-state-is'; state: PluginState }
  | { action: 'set-input-value'; selector: string; value: string }

type CdpTarget = {
  title: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}

type PendingCdpRequest = {
  reject: (error: Error) => void
  resolve: (result: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

class CdpClient {
  private nextId = 0
  private pageObjectId: string | undefined
  private readonly pending = new Map<number, PendingCdpRequest>()

  private constructor(
    private readonly socket: WebSocket,
    private readonly timeoutMs: number
  ) {
    socket.addEventListener('message', (event) => this.onMessage(event))
    socket.addEventListener('close', () => this.rejectPending('CDP connection closed.'))
    socket.addEventListener('error', () => this.rejectPending('CDP connection failed.'))
  }

  static async connect(url: string, timeoutMs: number): Promise<CdpClient> {
    if (typeof WebSocket === 'undefined') {
      fail('This script requires Node.js 22 or newer for its built-in WebSocket client.')
    }
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out opening the CDP page.')),
        timeoutMs
      )
      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolve()
      })
      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('Could not open the CDP page.'))
      })
    })
    return new CdpClient(socket, timeoutMs)
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out calling CDP method ${method}.`))
      }, this.timeoutMs)
      this.pending.set(id, { reject, resolve, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async runPageRequest<T>(request: PageRequest): Promise<T> {
    const pageObjectId = await this.getPageObjectId()
    const response = objectValue(
      await this.call('Runtime.callFunctionOn', {
        arguments: [{ value: request }],
        awaitPromise: true,
        functionDeclaration: pageFunctionDeclaration,
        objectId: pageObjectId,
        returnByValue: true,
        userGesture: true
      }),
      'Runtime.callFunctionOn response'
    )
    if (response.exceptionDetails) {
      fail(`Codex page function failed: ${JSON.stringify(response.exceptionDetails)}`)
    }
    const result = objectValue(response.result, 'Runtime.callFunctionOn result')
    return result.value as T
  }

  close(): void {
    this.socket.close()
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return
    const message = JSON.parse(event.data) as Record<string, unknown>
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(`CDP request failed: ${JSON.stringify(message.error)}`))
    } else {
      pending.resolve(message.result)
    }
  }

  private async getPageObjectId(): Promise<string> {
    if (this.pageObjectId) return this.pageObjectId
    const response = objectValue(
      await this.call('Runtime.evaluate', {
        expression: 'globalThis'
      }),
      'Runtime.evaluate response'
    )
    if (response.exceptionDetails) {
      fail(`Could not access the Codex page: ${JSON.stringify(response.exceptionDetails)}`)
    }
    const result = objectValue(response.result, 'Runtime.evaluate result')
    if (typeof result.objectId !== 'string') fail('Codex page global object is unavailable.')
    this.pageObjectId = result.objectId
    return this.pageObjectId
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function usage(): string {
  return [
    'Reinstall TemPad Dev (Dev) through a running Codex Desktop CDP endpoint:',
    '',
    '  pnpm agent-plugin:reinstall <version>',
    '  pnpm agent-plugin:reinstall <version> --restart-codex',
    '  pnpm agent-plugin:reinstall <version> --restart-codex --app-path "/path/to/ChatGPT.app"',
    '  pnpm agent-plugin:reinstall <version> --cdp-url http://127.0.0.1:9222',
    '',
    'Arguments:',
    '  <version>              Exact generated plugin version to install',
    '',
    'Options:',
    '  --app-path <path>     Codex app to launch (default: CODEX_APP_PATH or /Applications/ChatGPT.app)',
    '  --cdp-url <url>        Codex CDP endpoint (default: CODEX_CDP_URL or http://127.0.0.1:9222)',
    '  --page-url <url|substring> Select a Codex page; an exact URL wins over substring matching',
    '  --restart-codex        Restart Codex with CDP in a detached helper before reinstalling',
    '  --timeout-ms <number>  Timeout for each UI/runtime transition (default: 60000)',
    '  --help                 Show this help',
    '',
    'Codex Desktop must already be running with remote debugging enabled, for example on macOS:',
    '  open -a ChatGPT --args --remote-debugging-port=9222'
  ].join('\n')
}

function parseArguments(argv: string[]): Arguments | null {
  if (argv.includes('--help')) return null

  let appPath = process.env.CODEX_APP_PATH ?? '/Applications/ChatGPT.app'
  let cdpUrl = process.env.CODEX_CDP_URL ?? 'http://127.0.0.1:9222'
  let pageUrl: string | undefined
  let restartCodex = false
  let resumeAfterRestart = false
  let timeoutMs = 60_000
  let version: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument) continue
    if (argument === '--restart-codex') {
      restartCodex = true
      continue
    }
    if (argument === '--resume-after-restart') {
      resumeAfterRestart = true
      continue
    }
    if (
      argument === '--app-path' ||
      argument === '--cdp-url' ||
      argument === '--page-url' ||
      argument === '--timeout-ms'
    ) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`Missing value for ${argument}.`)
      index += 1
      if (argument === '--app-path') appPath = value
      if (argument === '--cdp-url') cdpUrl = value
      if (argument === '--page-url') pageUrl = value
      if (argument === '--timeout-ms') {
        timeoutMs = Number(value)
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
          fail(`Invalid --timeout-ms value: ${value}`)
        }
      }
      continue
    }
    if (argument.startsWith('--')) fail(`Unknown option: ${argument}`)
    if (version) fail(`Unexpected positional argument: ${argument}`)
    version = argument
  }

  if (!version) fail(`Missing plugin version.\n\n${usage()}`)
  return { appPath, cdpUrl, pageUrl, restartCodex, resumeAfterRestart, timeoutMs, version }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

async function resolveRuntimePaths(expectedVersion: string): Promise<RuntimePaths> {
  const manifestPath = join(pluginRoot, '.codex-plugin/plugin.json')
  const manifest = objectValue(await readJson(manifestPath), manifestPath)
  if (manifest.name !== pluginName) fail(`Unexpected plugin name in ${manifestPath}.`)
  if (manifest.version !== expectedVersion) {
    fail(
      `Generated plugin version is ${String(manifest.version)}, not ${expectedVersion}. ` +
        'Run pnpm agent-plugin:dev and pass the generated version.'
    )
  }

  const mcpPath = join(pluginRoot, '.mcp.json')
  const mcp = objectValue(await readJson(mcpPath), mcpPath)
  const servers = objectValue(mcp.mcpServers, `${mcpPath}#mcpServers`)
  const server = objectValue(servers[pluginName], `${mcpPath}#mcpServers.${pluginName}`)
  if (!Array.isArray(server.args) || typeof server.args[0] !== 'string') {
    fail(`Missing CLI entry in ${mcpPath}.`)
  }

  const cliArgument = server.args[0]
  const cli = normalize(isAbsolute(cliArgument) ? cliArgument : resolve(pluginRoot, cliArgument))
  const hub = join(dirname(cli), 'hub.mjs')
  await Promise.all([access(cli), access(hub)])
  return { cli, hub }
}

async function listProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout
    .split('\n')
    .map((line): ProcessInfo | null => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return null
      const [, pid, ppid, command] = match
      if (!pid || !ppid || !command) return null
      return { command, pid: Number(pid), ppid: Number(ppid) }
    })
    .filter((process): process is ProcessInfo => process !== null)
}

async function listRuntimeProcesses(paths: RuntimePaths): Promise<RuntimeProcesses> {
  const processes = await listProcesses()

  return {
    cli: processes.filter((process) => process.command.includes(paths.cli)),
    hub: processes.filter((process) => process.command.includes(paths.hub))
  }
}

function processSummary(processes: RuntimeProcesses): string {
  const cliPids = processes.cli.map(({ pid }) => pid).join(', ') || 'none'
  const hubPids = processes.hub.map(({ pid }) => pid).join(', ') || 'none'
  return `CLI=${processes.cli.length} [${cliPids}], Hub=${processes.hub.length} [${hubPids}]`
}

async function waitForRuntimeState(
  paths: RuntimePaths,
  expectedState: PluginState,
  timeoutMs: number,
  baseline?: RuntimeProcesses
): Promise<RuntimeProcesses> {
  const deadline = Date.now() + timeoutMs
  const requiredStableSamples = expectedState === 'installed' ? 2 : 3
  let stableSamples = 0
  let lastSummary = ''
  let latest = await listRuntimeProcesses(paths)

  while (Date.now() <= deadline) {
    latest = await listRuntimeProcesses(paths)
    const matches = runtimeStateMatches(latest, expectedState, baseline)
    stableSamples = matches ? stableSamples + 1 : 0

    const summary = processSummary(latest)
    if (summary !== lastSummary) {
      console.log(`Runtime: ${summary}`)
      lastSummary = summary
    }
    if (stableSamples >= requiredStableSamples) return latest
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  const expected =
    expectedState === 'installed'
      ? baseline
        ? 'a new TemPad Dev CLI and an available Hub'
        : 'the TemPad Dev CLI and Hub to be running'
      : 'all TemPad Dev CLI and Hub processes to stop before reinstalling'
  fail(
    `Timed out waiting for ${expected}. Last observed state: ${processSummary(latest)}` +
      (baseline ? `; baseline: ${processSummary(baseline)}` : '')
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function listCodexMainProcesses(): Promise<ProcessInfo[]> {
  return (await listProcesses()).filter(
    ({ command, ppid }) => ppid === 1 && command.includes('.app/Contents/MacOS/ChatGPT')
  )
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

async function isCdpReady(cdpUrl: string): Promise<boolean> {
  try {
    const versionUrl = new URL('/json/version', cdpUrl)
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

function cdpPort(cdpUrl: string): number {
  const url = new URL(cdpUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    fail('--restart-codex requires a local HTTP CDP URL.')
  }
  const port = Number(url.port || 80)
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    fail(`Invalid CDP port in ${cdpUrl}.`)
  }
  return port
}

async function waitForCodexExit(timeoutMs: number): Promise<void> {
  await waitUntil(
    async () => (await listCodexMainProcesses()).length === 0,
    'Codex Desktop to exit',
    timeoutMs
  )
}

async function terminateSingleCodexMainProcess(): Promise<void> {
  const processes = await listCodexMainProcesses()
  if (processes.length === 0) return
  if (processes.length !== 1 || !processes[0]) {
    fail(
      `Refusing to terminate Codex because ${String(processes.length)} main processes were found:\n${processes
        .map(({ command, pid }) => `- ${String(pid)}: ${command}`)
        .join('\n')}`
    )
  }
  const [{ pid }] = processes
  console.log(`Terminating the verified Codex main process ${String(pid)}...`)
  process.kill(pid, 'SIGTERM')
}

async function restartCodexForCdp(
  appPath: string,
  cdpUrl: string,
  timeoutMs: number
): Promise<void> {
  if (process.platform !== 'darwin') fail('--restart-codex is currently supported only on macOS.')
  const port = cdpPort(cdpUrl)
  await access(appPath)

  await new Promise((resolve) => setTimeout(resolve, 1_000))
  console.log('Requesting Codex Desktop to quit...')
  try {
    await execFileAsync('osascript', ['-e', 'tell application id "com.openai.codex" to quit'], {
      timeout: timeoutMs
    })
    await waitForCodexExit(timeoutMs)
  } catch (error) {
    console.warn(`Normal Codex quit did not complete: ${errorMessage(error)}`)
    await terminateSingleCodexMainProcess()
    await waitForCodexExit(timeoutMs)
  }

  console.log(`Starting ${appPath} with --remote-debugging-port=${port}...`)
  await execFileAsync(
    'open',
    ['-n', appPath, '--args', `--remote-debugging-port=${String(port)}`],
    {
      timeout: timeoutMs
    }
  )
  await waitUntil(() => isCdpReady(cdpUrl), `Codex CDP endpoint ${cdpUrl}`, timeoutMs)
  console.log(`Codex CDP endpoint is ready at ${cdpUrl}.`)
}

async function startDetachedRestart(args: Arguments, reason: string): Promise<void> {
  if (process.platform !== 'darwin') fail('--restart-codex is currently supported only on macOS.')
  cdpPort(args.cdpUrl)
  const { stdout: launchctlOutput } = await execFileAsync('/bin/launchctl', ['list'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  assertNoDetachedReinstallJobs(parseLaunchctlLabels(launchctlOutput, detachedReinstallJobPrefix))

  const childArguments = [
    ...process.execArgv,
    scriptPath,
    args.version,
    '--cdp-url',
    args.cdpUrl,
    '--app-path',
    args.appPath,
    '--timeout-ms',
    String(args.timeoutMs),
    '--resume-after-restart',
    ...(args.pageUrl ? ['--page-url', args.pageUrl] : [])
  ]
  const { jobLabel, logFileName } = detachedReinstallIdentity(process.pid, Date.now())
  const restartLogPath = join(repoRoot, '.dev', logFileName)
  await mkdir(dirname(restartLogPath), { recursive: true })
  await writeFile(restartLogPath, '')
  await execFileAsync(
    'launchctl',
    [
      'submit',
      '-l',
      jobLabel,
      '-o',
      restartLogPath,
      '-e',
      restartLogPath,
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

  console.log(reason)
  console.log(`Detached reinstall helper submitted as ${jobLabel}.`)
  console.log(`Codex will restart; progress is written to ${restartLogPath}.`)
}

async function listCdpTargets(cdpUrl: string): Promise<CdpTarget[]> {
  const response = await fetch(new URL('/json/list', cdpUrl), {
    signal: AbortSignal.timeout(2_000)
  })
  if (!response.ok) fail(`Could not list CDP targets: HTTP ${String(response.status)}.`)
  const targets = (await response.json()) as unknown
  if (!Array.isArray(targets)) fail('CDP target list is not an array.')
  return targets.filter(
    (target): target is CdpTarget =>
      Boolean(target) &&
      typeof target === 'object' &&
      typeof target.title === 'string' &&
      typeof target.type === 'string' &&
      typeof target.url === 'string' &&
      typeof target.webSocketDebuggerUrl === 'string'
  )
}

async function selectCodexTarget(
  cdpUrl: string,
  pageUrl: string | undefined,
  timeoutMs: number
): Promise<CdpTarget> {
  const deadline = Date.now() + timeoutMs
  let targets: CdpTarget[] = []
  while (Date.now() <= deadline) {
    targets = await listCdpTargets(cdpUrl).catch(() => [])
    const codexPages = targets.filter((target) => {
      if (target.type !== 'page' || target.url.includes('initialRoute=%2Favatar-overlay')) {
        return false
      }
      try {
        return new URL(target.url).protocol === 'app:'
      } catch {
        return false
      }
    })
    const exactCandidates = pageUrl ? codexPages.filter((target) => target.url === pageUrl) : []
    if (exactCandidates.length === 1 && exactCandidates[0]) return exactCandidates[0]
    const candidates = pageUrl
      ? codexPages.filter((target) => target.url.includes(pageUrl))
      : codexPages
    const candidate = candidates[0]
    if (candidates.length === 1 && candidate) return candidate
    if (candidates.length > 1) {
      fail(
        `Multiple Codex pages are available. Pass --page-url with a unique substring:\n${candidates
          .map(({ title, url }) => `- ${title}: ${url}`)
          .join('\n')}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  fail(
    `No Codex app page found at the CDP endpoint. Exposed pages:\n${targets
      .map(({ title, url }) => `- ${title}: ${url}`)
      .join('\n')}`
  )
}

async function connectToCodex(args: Arguments): Promise<CdpClient | null> {
  if (args.resumeAfterRestart) {
    await restartCodexForCdp(args.appPath, args.cdpUrl, args.timeoutMs)
  }
  if (args.restartCodex && !args.resumeAfterRestart) {
    await startDetachedRestart(
      args,
      'A clean Codex restart was requested before replacing the plugin.'
    )
    return null
  }
  try {
    const target = await selectCodexTarget(args.cdpUrl, args.pageUrl, args.timeoutMs)
    console.log(`Codex page: ${target.title || '(untitled)'} (${target.url})`)
    return await CdpClient.connect(target.webSocketDebuggerUrl, args.timeoutMs)
  } catch (error) {
    const recovery =
      args.restartCodex || args.resumeAfterRestart
        ? 'The CDP endpoint is reachable; fix the exposed target or --page-url selection without restarting Codex.'
        : 'Start Codex with remote debugging, or pass --restart-codex when the CDP endpoint is unavailable.'
    fail(
      `Could not connect to Codex CDP at ${args.cdpUrl}: ${errorMessage(error).split('\n', 1)[0]}. ` +
        recovery
    )
  }
}

async function waitForPageCondition(
  client: CdpClient,
  request: PageRequest,
  description: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await client.runPageRequest<unknown>(request)) return
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  fail(`Timed out waiting for ${description}.`)
}

async function clickElementPhysical(client: CdpClient, query: PageElementQuery): Promise<boolean> {
  const point = await client.runPageRequest<{ x: number; y: number } | null>({
    action: 'element-center',
    query
  })
  if (!point) return false
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  })
  await client.call('Input.dispatchMouseEvent', {
    button: 'left',
    clickCount: 1,
    type: 'mousePressed',
    x: point.x,
    y: point.y
  })
  await client.call('Input.dispatchMouseEvent', {
    button: 'left',
    clickCount: 1,
    type: 'mouseReleased',
    x: point.x,
    y: point.y
  })
  return true
}

async function clickPageElement(
  client: CdpClient,
  selector: string,
  description: string,
  timeoutMs: number,
  text?: string,
  ariaLabel?: string,
  physical = false
): Promise<void> {
  const query: PageElementQuery = {
    selector,
    ...(text === undefined ? {} : { text }),
    ...(ariaLabel === undefined ? {} : { ariaLabel })
  }
  await waitForPageCondition(client, { action: 'element-exists', query }, description, timeoutMs)
  const clicked = physical
    ? await clickElementPhysical(client, query)
    : await client.runPageRequest<boolean>({ action: 'click-element', query })
  if (!clicked) fail(`Could not click ${description}.`)
}

async function waitForPluginState(
  client: CdpClient,
  expected: PluginState,
  timeoutMs: number
): Promise<void> {
  await waitForPageCondition(
    client,
    { action: 'plugin-state-is', state: expected },
    `the plugin to be ${expected}`,
    timeoutMs
  )
}

async function openPluginDetail(client: CdpClient, timeoutMs: number): Promise<PluginState> {
  await clickPageElement(client, 'button', 'the Plugins navigation button', timeoutMs, 'Plugins')
  await waitForPageCondition(
    client,
    {
      action: 'element-exists',
      query: { selector: 'input[placeholder="Search plugins"]', visible: false }
    },
    'the plugin directory search input',
    timeoutMs
  )

  const filled = await client.runPageRequest<boolean>({
    action: 'set-input-value',
    selector: 'input[placeholder="Search plugins"]',
    value: pluginDisplayName
  })
  if (!filled) fail('Could not search for TemPad Dev (Dev).')

  const cardQuery: PageElementQuery = {
    closest: '[role="button"]',
    leafOnly: true,
    selector: 'div',
    text: pluginDisplayName
  }
  await waitForPageCondition(
    client,
    { action: 'element-exists', query: cardQuery },
    'the plugin card',
    timeoutMs
  )
  const opened = await client.runPageRequest<boolean>({
    action: 'click-element',
    query: cardQuery
  })
  if (!opened) fail('Could not open the TemPad Dev (Dev) plugin card.')

  await waitForPageCondition(
    client,
    { action: 'plugin-state' },
    'the plugin detail page',
    timeoutMs
  )
  const state = await client.runPageRequest<PluginState | null>({ action: 'plugin-state' })
  return state ?? fail('The plugin detail page has no install state.')
}

async function assertVisibleVersion(
  client: CdpClient,
  version: string,
  timeoutMs: number
): Promise<void> {
  await waitForPageCondition(
    client,
    { action: 'body-includes', text: version },
    `plugin version ${version}`,
    timeoutMs
  )
}

async function uninstallPlugin(client: CdpClient, timeoutMs: number): Promise<void> {
  await clickPageElement(
    client,
    'button',
    'the plugin actions menu',
    timeoutMs,
    undefined,
    'More actions',
    true
  )
  await clickPageElement(
    client,
    '[role="menuitem"]',
    'the Uninstall menu item',
    timeoutMs,
    'Uninstall',
    undefined,
    true
  )

  await new Promise((resolve) => setTimeout(resolve, 300))
  const confirmQuery: PageElementQuery = {
    selector: '[role="dialog"] button',
    text: 'Uninstall'
  }
  if (await client.runPageRequest<boolean>({ action: 'element-exists', query: confirmQuery })) {
    await clickElementPhysical(client, confirmQuery)
  }

  await waitForPluginState(client, 'uninstalled', timeoutMs)
  console.log('Codex reports the plugin as uninstalled.')
}

async function installPlugin(client: CdpClient, version: string, timeoutMs: number): Promise<void> {
  await assertVisibleVersion(client, version, timeoutMs)
  await clickPageElement(client, 'button', 'the Install plugin button', timeoutMs, 'Install plugin')
  await waitForPluginState(client, 'installed', timeoutMs)
  await assertVisibleVersion(client, version, timeoutMs)
  console.log(`Codex reports TemPad Dev (Dev) ${version} as installed.`)
}

async function tryRestorePreviousCodexView(client: CdpClient, steps: number): Promise<void> {
  try {
    const query: PageElementQuery = { selector: 'button', ariaLabel: 'Back' }
    let restoredSteps = 0
    for (let index = 0; index < steps; index += 1) {
      const exists = await client.runPageRequest<boolean>({ action: 'element-exists', query })
      if (!exists) break
      const clicked = await client.runPageRequest<boolean>({ action: 'click-element', query })
      if (!clicked) break
      restoredSteps += 1
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    console.log(`Restored ${String(restoredSteps)} previous Codex view step(s).`)
  } catch (error) {
    console.warn(`Could not restore the previous Codex view: ${errorMessage(error)}`)
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (!args) {
    console.log(usage())
    return
  }
  if (process.platform === 'win32') {
    fail('Runtime process verification is not implemented for Windows.')
  }

  const runtimePaths = await resolveRuntimePaths(args.version)
  console.log(`Expected CLI: ${runtimePaths.cli}`)
  console.log(`Expected Hub: ${runtimePaths.hub}`)

  let client: CdpClient | undefined
  try {
    client = (await connectToCodex(args)) ?? undefined
    if (!client) return

    const initialState = await openPluginDetail(client, args.timeoutMs)
    const initialRuntime = await listRuntimeProcesses(runtimePaths)
    if (initialState === 'installed') {
      if (initialRuntime.cli.length > 0 && initialRuntime.hub.length > 0) {
        await waitForRuntimeState(runtimePaths, 'installed', args.timeoutMs)
        console.log('Confirmed that the currently installed TemPad Dev CLI and Hub are running.')
      } else if (initialRuntime.cli.length === 0 && initialRuntime.hub.length === 0) {
        console.log(
          'The plugin is installed but its runtime is absent; continuing with repair reinstall.'
        )
      } else {
        fail(`The installed plugin has a partial runtime: ${processSummary(initialRuntime)}`)
      }

      console.log('Uninstalling TemPad Dev (Dev) through Codex...')
      await uninstallPlugin(client, args.timeoutMs)
    } else {
      console.log('The plugin is already uninstalled; continuing the interrupted reinstall.')
    }

    const runtimeAfterUninstall = await waitForRuntimeState(
      runtimePaths,
      'uninstalled',
      args.timeoutMs
    )
    console.log('Confirmed that all TemPad Dev CLI and Hub processes have stopped.')

    const stateAfterUninstall = await openPluginDetail(client, args.timeoutMs)
    if (stateAfterUninstall !== 'uninstalled') {
      fail(`${pluginDisplayName} still appears installed after uninstalling.`)
    }

    console.log(`Installing TemPad Dev (Dev) ${args.version} through Codex...`)
    await installPlugin(client, args.version, args.timeoutMs)
    await tryRestorePreviousCodexView(client, 4)
    const runtimeAfterInstall = await listRuntimeProcesses(runtimePaths)
    if (runtimeAfterInstall.cli.length === 0 && runtimeAfterInstall.hub.length === 0) {
      console.log(
        'Codex installed the plugin; its task-scoped MCP runtime will be verified by the next fresh task.'
      )
    } else {
      await waitForRuntimeState(runtimePaths, 'installed', args.timeoutMs, runtimeAfterUninstall)
      console.log('Confirmed that a new TemPad Dev CLI and an available Hub are running.')
    }
  } finally {
    client?.close()
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
)
