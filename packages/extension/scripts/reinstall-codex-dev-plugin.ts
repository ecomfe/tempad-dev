import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Locator, type Page } from 'playwright'

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

async function connectToCodex(args: Arguments): Promise<Browser | null> {
  if (args.resumeAfterRestart) await restartCodexForCdp(args.cdpUrl, args.timeoutMs)
  if (args.restartCodex && !args.resumeAfterRestart && !(await isCdpReady(args.cdpUrl))) {
    await startDetachedRestart(args, new Error('the CDP endpoint is not listening'))
    return null
  }
  try {
    return await chromium.connectOverCDP(args.cdpUrl, { timeout: args.timeoutMs })
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

async function selectCodexPage(browser: Browser, pageUrl?: string): Promise<Page> {
  const pages = browser.contexts().flatMap((context) => context.pages())
  const candidates = (
    await Promise.all(
      pages.map(async (page) => ({
        focused: await page.evaluate(() => document.hasFocus()).catch(() => false),
        page,
        title: await page.title().catch(() => ''),
        url: page.url(),
        visible: await page
          .evaluate(() => document.visibilityState === 'visible')
          .catch(() => false)
      }))
    )
  ).filter(({ url }) => {
    if (pageUrl && !url.includes(pageUrl)) return false
    try {
      return new URL(url).protocol === 'app:'
    } catch {
      return false
    }
  })

  if (candidates.length === 0) {
    fail(
      `No Codex app page found at the CDP endpoint. Exposed pages:\n${pages
        .map((page) => `- ${page.url()}`)
        .join('\n')}`
    )
  }

  const focused = candidates.filter((candidate) => candidate.focused)
  const visible = candidates.filter((candidate) => candidate.visible)
  const selected =
    focused.length === 1
      ? focused[0]
      : visible.length === 1
        ? visible[0]
        : candidates.length === 1
          ? candidates[0]
          : null
  if (!selected) {
    fail(
      `Multiple Codex pages are available. Pass --page-url with a unique substring:\n${candidates
        .map(({ title, url }) => `- ${title}: ${url}`)
        .join('\n')}`
    )
  }

  console.log(`Codex page: ${selected.title || '(untitled)'} (${selected.url})`)
  return selected.page
}

async function waitForEither(
  first: { locator: Locator; state: PluginState },
  second: { locator: Locator; state: PluginState },
  timeoutMs: number
): Promise<PluginState> {
  return Promise.any([
    first.locator.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => first.state),
    second.locator.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => second.state)
  ]).catch(() => fail('Could not determine the plugin installation state from Codex.'))
}

function pluginActions(page: Page): {
  install: Locator
  more: Locator
} {
  return {
    install: page.getByRole('button', { name: 'Install plugin', exact: true }),
    more: page.getByRole('button', { name: 'More actions', exact: true })
  }
}

async function openPluginDetail(page: Page, timeoutMs: number): Promise<PluginState> {
  const currentUrl = new URL(page.url())
  const directoryUrl = new URL('/plugins', currentUrl)
  await page.goto(directoryUrl.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs })

  const search = page.getByRole('searchbox', { name: 'Search plugins', exact: true })
  await search.waitFor({ state: 'visible', timeout: timeoutMs })
  await search.fill(pluginDisplayName)

  const pluginTitle = page.getByText(pluginDisplayName, { exact: true }).first()
  await pluginTitle.waitFor({ state: 'visible', timeout: timeoutMs })
  await pluginTitle.click()

  const heading = page.getByRole('heading', { name: pluginDisplayName, exact: true }).first()
  await heading.waitFor({ state: 'visible', timeout: timeoutMs })
  const actions = pluginActions(page)
  return waitForEither(
    { locator: actions.more, state: 'installed' },
    { locator: actions.install, state: 'uninstalled' },
    timeoutMs
  )
}

async function assertVisibleVersion(page: Page, version: string, timeoutMs: number): Promise<void> {
  await page.getByText(version, { exact: true }).waitFor({ state: 'visible', timeout: timeoutMs })
}

async function uninstallPlugin(page: Page, timeoutMs: number): Promise<void> {
  const actions = pluginActions(page)
  await actions.more.click()
  await page.getByRole('menuitem', { name: 'Uninstall', exact: true }).click()

  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Uninstall', exact: true })
  if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click()

  await actions.install.waitFor({ state: 'visible', timeout: timeoutMs })
  console.log('Codex reports the plugin as uninstalled.')
}

async function installPlugin(page: Page, version: string, timeoutMs: number): Promise<void> {
  await assertVisibleVersion(page, version, timeoutMs)
  const actions = pluginActions(page)
  await actions.install.click()
  await actions.more.waitFor({ state: 'visible', timeout: timeoutMs })
  await assertVisibleVersion(page, version, timeoutMs)
  console.log(`Codex reports TemPad Dev (Dev) ${version} as installed.`)
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

  let browser: Browser | undefined
  try {
    browser = (await connectToCodex(args)) ?? undefined
    if (!browser) return
    const page = await selectCodexPage(browser, args.pageUrl)
    page.setDefaultTimeout(args.timeoutMs)
    const returnUrl = page.url()

    const initialState = await openPluginDetail(page, args.timeoutMs)
    if (initialState !== 'installed') fail(`${pluginDisplayName} is not currently installed.`)
    await waitForRuntimeState(runtimePaths, 'installed', args.timeoutMs)
    console.log('Confirmed that the currently installed TemPad Dev CLI and Hub are running.')

    console.log('Uninstalling TemPad Dev (Dev) through Codex...')
    await uninstallPlugin(page, args.timeoutMs)
    await waitForRuntimeState(runtimePaths, 'uninstalled', args.timeoutMs)
    console.log('Confirmed that the TemPad Dev CLI and Hub have stopped.')

    const stateAfterUninstall = await openPluginDetail(page, args.timeoutMs)
    if (stateAfterUninstall !== 'uninstalled') {
      fail(`${pluginDisplayName} still appears installed after uninstalling.`)
    }

    console.log(`Installing TemPad Dev (Dev) ${args.version} through Codex...`)
    await installPlugin(page, args.version, args.timeoutMs)
    await page.goto(returnUrl, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs })
    console.log(`Restored Codex page: ${returnUrl}`)
    await waitForRuntimeState(runtimePaths, 'installed', args.timeoutMs)
    console.log('Confirmed that the TemPad Dev CLI and Hub are running.')
  } finally {
    await browser?.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
