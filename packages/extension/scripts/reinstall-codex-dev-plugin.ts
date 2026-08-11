import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const pluginRoot = join(repoRoot, '.dev/plugins/tempad-dev-dev')
const restartLogPath = join(repoRoot, '.dev/codex-plugin-reinstall.log')
const scriptPath = fileURLToPath(import.meta.url)
const pluginDisplayName = 'TemPad Dev (Dev)'
const pluginName = 'tempad-dev-dev'
const pollIntervalMs = 500

type Arguments = {
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

  async evaluate<T>(expression: string): Promise<T> {
    const response = objectValue(
      await this.call('Runtime.evaluate', {
        awaitPromise: true,
        expression,
        returnByValue: true,
        userGesture: true
      }),
      'Runtime.evaluate response'
    )
    if (response.exceptionDetails) {
      fail(`Codex page evaluation failed: ${JSON.stringify(response.exceptionDetails)}`)
    }
    const result = objectValue(response.result, 'Runtime.evaluate result')
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
    '  pnpm agent-plugin:reinstall <version> --cdp-url http://127.0.0.1:9222',
    '',
    'Arguments:',
    '  <version>              Exact generated plugin version to install',
    '',
    'Options:',
    '  --cdp-url <url>        Codex CDP endpoint (default: CODEX_CDP_URL or http://127.0.0.1:9222)',
    '  --page-url <substring> Select a Codex page when more than one page is exposed',
    '  --restart-codex        Restart Codex with CDP in a detached helper when CDP is unavailable',
    '  --timeout-ms <number>  Timeout for each UI/runtime transition (default: 60000)',
    '  --help                 Show this help',
    '',
    'Codex Desktop must already be running with remote debugging enabled, for example on macOS:',
    '  open -a ChatGPT --args --remote-debugging-port=9222'
  ].join('\n')
}

function parseArguments(argv: string[]): Arguments | null {
  if (argv.includes('--help')) return null

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
    if (argument === '--cdp-url' || argument === '--page-url' || argument === '--timeout-ms') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`Missing value for ${argument}.`)
      index += 1
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
  return { cdpUrl, pageUrl, restartCodex, resumeAfterRestart, timeoutMs, version }
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

async function listRuntimeProcesses(paths: RuntimePaths): Promise<RuntimeProcesses> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
  const processes = stdout
    .split('\n')
    .map((line): ProcessInfo | null => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return null
      const [, pid, ppid, command] = match
      if (!pid || !ppid || !command) return null
      return { command, pid: Number(pid), ppid: Number(ppid) }
    })
    .filter((process): process is ProcessInfo => process !== null)

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
  timeoutMs: number
): Promise<RuntimeProcesses> {
  const deadline = Date.now() + timeoutMs
  const requiredStableSamples = expectedState === 'installed' ? 2 : 3
  let stableSamples = 0
  let lastSummary = ''
  let latest = await listRuntimeProcesses(paths)

  while (Date.now() <= deadline) {
    latest = await listRuntimeProcesses(paths)
    const matches =
      expectedState === 'installed'
        ? latest.cli.length > 0 && latest.hub.length > 0
        : latest.cli.length === 0 && latest.hub.length === 0
    stableSamples = matches ? stableSamples + 1 : 0

    const summary = processSummary(latest)
    if (summary !== lastSummary) {
      console.log(`Runtime: ${summary}`)
      lastSummary = summary
    }
    if (stableSamples >= requiredStableSamples) return latest
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  fail(
    `Timed out waiting for TemPad Dev CLI and Hub to be ${expectedState === 'installed' ? 'running' : 'stopped'}. ` +
      `Last observed state: ${processSummary(latest)}`
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function isCodexRunning(): Promise<boolean> {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    'application id "com.openai.codex" is running'
  ])
  return stdout.trim() === 'true'
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

async function restartCodexForCdp(cdpUrl: string, timeoutMs: number): Promise<void> {
  if (process.platform !== 'darwin') fail('--restart-codex is currently supported only on macOS.')
  const port = cdpPort(cdpUrl)

  await new Promise((resolve) => setTimeout(resolve, 1_000))
  console.log('Requesting Codex Desktop to quit...')
  await execFileAsync('osascript', ['-e', 'tell application id "com.openai.codex" to quit'])
  await waitUntil(async () => !(await isCodexRunning()), 'Codex Desktop to exit', timeoutMs)

  console.log(`Starting Codex Desktop with --remote-debugging-port=${port}...`)
  await execFileAsync('open', [
    '-a',
    'ChatGPT',
    '--args',
    `--remote-debugging-port=${String(port)}`
  ])
  await waitUntil(() => isCdpReady(cdpUrl), `Codex CDP endpoint ${cdpUrl}`, timeoutMs)
  console.log(`Codex CDP endpoint is ready at ${cdpUrl}.`)
}

async function startDetachedRestart(args: Arguments, connectionError: unknown): Promise<void> {
  if (process.platform !== 'darwin') fail('--restart-codex is currently supported only on macOS.')
  cdpPort(args.cdpUrl)
  await mkdir(dirname(restartLogPath), { recursive: true })

  const childArguments = [
    ...process.execArgv,
    scriptPath,
    args.version,
    '--cdp-url',
    args.cdpUrl,
    '--timeout-ms',
    String(args.timeoutMs),
    '--resume-after-restart',
    ...(args.pageUrl ? ['--page-url', args.pageUrl] : [])
  ]
  const jobLabel = `com.tempad-dev.codex-plugin-reinstall.${String(process.pid)}.${String(Date.now())}`
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

  console.log(`CDP is unavailable: ${errorMessage(connectionError).split('\n', 1)[0]}`)
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
    const candidates = targets.filter((target) => {
      if (target.type !== 'page' || target.url.includes('initialRoute=%2Favatar-overlay')) {
        return false
      }
      if (pageUrl && !target.url.includes(pageUrl)) return false
      try {
        return new URL(target.url).protocol === 'app:'
      } catch {
        return false
      }
    })
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
  if (args.resumeAfterRestart) await restartCodexForCdp(args.cdpUrl, args.timeoutMs)
  if (args.restartCodex && !args.resumeAfterRestart && !(await isCdpReady(args.cdpUrl))) {
    await startDetachedRestart(args, new Error('the CDP endpoint is not listening'))
    return null
  }
  try {
    const target = await selectCodexTarget(args.cdpUrl, args.pageUrl, args.timeoutMs)
    console.log(`Codex page: ${target.title || '(untitled)'} (${target.url})`)
    return await CdpClient.connect(target.webSocketDebuggerUrl, args.timeoutMs)
  } catch (error) {
    if (args.restartCodex && !args.resumeAfterRestart) {
      await startDetachedRestart(args, error)
      return null
    }
    fail(
      `Could not connect to Codex CDP at ${args.cdpUrl}: ${errorMessage(error).split('\n', 1)[0]}. ` +
        'Start Codex with remote debugging, or pass --restart-codex.'
    )
  }
}

async function waitForPageCondition(
  client: CdpClient,
  expression: string,
  description: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await client.evaluate<boolean>(expression)) return
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  fail(`Timed out waiting for ${description}.`)
}

function elementExpression(selector: string, text?: string, ariaLabel?: string): string {
  return `(()=>{const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);return [...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>visible(e)&&${
    text === undefined ? 'true' : `e.textContent.trim()===${JSON.stringify(text)}`
  }&&${ariaLabel === undefined ? 'true' : `e.getAttribute('aria-label')===${JSON.stringify(ariaLabel)}`})||null})()`
}

async function clickExpression(client: CdpClient, expression: string): Promise<boolean> {
  const point = await client.evaluate<{ x: number; y: number } | null>(
    `(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`
  )
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
  const find = elementExpression(selector, text, ariaLabel)
  await waitForPageCondition(client, `Boolean(${find})`, description, timeoutMs)
  const clicked = physical
    ? await clickExpression(client, find)
    : await client.evaluate<boolean>(
        `(()=>{const e=${find};if(!e)return false;e.click();return true})()`
      )
  if (!clicked) fail(`Could not click ${description}.`)
}

function pluginStateExpression(): string {
  const installed = elementExpression('button', undefined, 'More actions')
  const uninstalled = elementExpression('button', 'Install plugin')
  return `(()=>${installed}?'installed':${uninstalled}?'uninstalled':null)()`
}

async function waitForPluginState(
  client: CdpClient,
  expected: PluginState,
  timeoutMs: number
): Promise<void> {
  await waitForPageCondition(
    client,
    `${pluginStateExpression()}===${JSON.stringify(expected)}`,
    `the plugin to be ${expected}`,
    timeoutMs
  )
}

async function openPluginDetail(client: CdpClient, timeoutMs: number): Promise<PluginState> {
  await clickPageElement(client, 'button', 'the Plugins navigation button', timeoutMs, 'Plugins')
  await waitForPageCondition(
    client,
    `Boolean(document.querySelector('input[placeholder="Search plugins"]'))`,
    'the plugin directory search input',
    timeoutMs
  )

  const filled = await client.evaluate<boolean>(
    `(()=>{const input=document.querySelector('input[placeholder="Search plugins"]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(pluginDisplayName)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`
  )
  if (!filled) fail('Could not search for TemPad Dev (Dev).')

  const cardExpression = `(()=>{const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);const title=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&visible(e)&&e.textContent.trim()===${JSON.stringify(pluginDisplayName)}&&e.closest('[role="button"]'));return title?.closest('[role="button"]')||null})()`
  await waitForPageCondition(client, `Boolean(${cardExpression})`, 'the plugin card', timeoutMs)
  const opened = await client.evaluate<boolean>(
    `(()=>{const card=${cardExpression};if(!card)return false;card.click();return true})()`
  )
  if (!opened) fail('Could not open the TemPad Dev (Dev) plugin card.')

  await waitForPageCondition(
    client,
    `Boolean(${pluginStateExpression()})`,
    'the plugin detail page',
    timeoutMs
  )
  return await client.evaluate<PluginState>(pluginStateExpression())
}

async function assertVisibleVersion(
  client: CdpClient,
  version: string,
  timeoutMs: number
): Promise<void> {
  await waitForPageCondition(
    client,
    `document.body.innerText.includes(${JSON.stringify(version)})`,
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
  const confirm = `(()=>{const dialog=document.querySelector('[role="dialog"]');return dialog?[...dialog.querySelectorAll('button')].find(e=>e.textContent.trim()==='Uninstall')||null:null})()`
  if (await client.evaluate<boolean>(`Boolean(${confirm})`)) {
    await clickExpression(client, confirm)
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

async function restorePreviousCodexView(client: CdpClient, steps: number): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    await clickPageElement(client, 'button', 'the Codex Back button', 5_000, undefined, 'Back')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  console.log('Restored the previous Codex view.')
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
    if (initialState !== 'installed') fail(`${pluginDisplayName} is not currently installed.`)
    await waitForRuntimeState(runtimePaths, 'installed', args.timeoutMs)
    console.log('Confirmed that the currently installed TemPad Dev CLI and Hub are running.')

    console.log('Uninstalling TemPad Dev (Dev) through Codex...')
    await uninstallPlugin(client, args.timeoutMs)
    await waitForRuntimeState(runtimePaths, 'uninstalled', args.timeoutMs)
    console.log('Confirmed that the TemPad Dev CLI and Hub have stopped.')

    const stateAfterUninstall = await openPluginDetail(client, args.timeoutMs)
    if (stateAfterUninstall !== 'uninstalled') {
      fail(`${pluginDisplayName} still appears installed after uninstalling.`)
    }

    console.log(`Installing TemPad Dev (Dev) ${args.version} through Codex...`)
    await installPlugin(client, args.version, args.timeoutMs)
    await restorePreviousCodexView(client, 4)
    await waitForRuntimeState(runtimePaths, 'installed', args.timeoutMs)
    console.log('Confirmed that the TemPad Dev CLI and Hub are running.')
  } finally {
    client?.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
