import type { Page } from 'playwright'

import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

import {
  parseProcessTable,
  resolveCodexExecutable,
  type RuntimeProcess
} from './agent-authoring-runtime-preflight'
import {
  assertCdpOwner,
  assertNoRestartJob,
  cdpWebSocketUrl,
  checkoutRuntimeProcesses,
  inspectDevPlugin,
  matchingProcesses,
  parseReinstallArguments,
  resolveDevPluginVersion,
  restartJobPrefix,
  selectCodexPageUrl,
  type ReinstallArguments
} from './reinstall-codex-dev-plugin-runtime'

const exec = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const pluginRoot = join(repoRoot, '.dev/plugins/tempad-dev-dev')
const displayName = 'TemPad Dev (Dev)'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntil(check: () => Promise<boolean>, label: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  do {
    if (await check()) return
    await pause(250)
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${label}.`)
}

async function cdpReady(url: string): Promise<boolean> {
  try {
    return (await fetch(new URL('/json/version', url), { signal: AbortSignal.timeout(1000) })).ok
  } catch {
    return false
  }
}

/** One table serves executable matching, checkout runtime matching, and CDP ownership. */
async function processes(): Promise<RuntimeProcess[]> {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
    maxBuffer: 16 * 1024 * 1024
  })
  return parseProcessTable(stdout)
}

async function appExecutable(appPath: string): Promise<string> {
  const { stdout } = await exec('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    join(appPath, 'Contents/Info.plist')
  ])
  const executable = join(appPath, 'Contents/MacOS', stdout.trim())
  await access(executable)
  return executable
}

async function restartApp(args: ReinstallArguments, appPath: string, appBinary: string) {
  if (await cdpReady(args.cdpUrl))
    throw new Error('CDP became available before restart; rerun without --restart-codex.')
  const pids = matchingProcesses(await processes(), appBinary)
  if (pids.length > 1) throw new Error('Multiple main processes match the configured Codex App.')
  const waitForExit = (label: string) =>
    waitUntil(
      async () => matchingProcesses(await processes(), appBinary).length === 0,
      label,
      10_000
    )
  // This runs outside the App so quitting cannot interrupt installation halfway through.
  await pause(1500)
  if (pids.length) {
    console.log(`Quitting ${appPath} (PID ${pids[0]}).`)
    try {
      await exec(
        'osascript',
        ['-e', 'on run argv\ntell application (item 1 of argv) to quit\nend run', appPath],
        { timeout: 10_000 }
      )
      await waitForExit('Codex to quit')
    } catch {
      const remaining = matchingProcesses(await processes(), appBinary)
      if (remaining.some((pid) => !pids.includes(pid)))
        throw new Error('Codex process changed during restart; refusing to stop its replacement.')
      for (const pid of remaining) process.kill(pid, 'SIGTERM')
      await waitForExit('Codex to exit')
    }
  }
  await exec('open', [
    '-n',
    appPath,
    '--args',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${args.cdpPort}`
  ])
  await waitUntil(() => cdpReady(args.cdpUrl), 'Codex CDP', args.timeoutMs)
}

async function detachRestart(args: ReinstallArguments, appPath: string) {
  assertNoRestartJob((await exec('/bin/launchctl', ['list'])).stdout)
  const label = `${restartJobPrefix}${process.pid}.${Date.now()}`
  const logPath = join(repoRoot, '.dev', `${label}.log`)
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, '')
  await exec(
    '/bin/launchctl',
    [
      'submit',
      '-l',
      label,
      '-o',
      logPath,
      '-e',
      logPath,
      '--',
      '/bin/sh',
      '-c',
      '"$@"\nstatus=$?\n/bin/launchctl remove "$0"\nexit "$status"',
      label,
      process.execPath,
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      '--resume-after-restart',
      '--app-path',
      appPath,
      '--cdp-url',
      args.cdpUrl,
      '--timeout-ms',
      String(args.timeoutMs),
      ...(args.version ? [args.version] : []),
      ...(args.pageUrl ? ['--page-url', args.pageUrl] : [])
    ],
    { cwd: repoRoot }
  )
  console.log(`Restart and App reinstall scheduled. Log: ${logPath}`)
}

async function stopCheckoutRuntime() {
  const entries = ['cli.mjs', 'hub.mjs'].map((name) =>
    join(repoRoot, 'packages/mcp-server/dist', name)
  )
  const matching = async () => checkoutRuntimeProcesses(await processes(), entries)
  // Uninstall in the App first, so its MCP connections cannot relaunch the old runtime.
  for (const pid of await matching()) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  await waitUntil(
    async () => (await matching()).length === 0,
    'this checkout’s old MCP processes to exit',
    15_000
  )
}

async function openPlugin(page: Page) {
  // The heading's accessible name also includes its "Folder marketplace plugin" icon.
  const title = page.getByRole('heading', { level: 1 }).filter({ hasText: /^TemPad Dev \(Dev\)$/ })
  if (await title.isVisible()) return
  const search = page.getByPlaceholder('Search plugins', { exact: true })
  if (!(await search.isVisible())) {
    await page
      .getByRole('button', { name: 'Plugins', exact: true })
      .and(page.locator('.sidebar-item'))
      .evaluate((element: HTMLElement) => element.click())
    await page.getByRole('heading', { name: 'Plugins', exact: true }).waitFor({ state: 'visible' })
  }
  // The App commits catalog navigation and debounced search asynchronously.
  // Selecting the transient search result can otherwise reset to the empty catalog.
  await pause(500)
  await search.evaluate((input: HTMLInputElement, value) => {
    input.blur()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('Could not update the plugin search input.')
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, displayName)
  await pause(500)
  await page
    .getByRole('button')
    .filter({ has: page.getByText(displayName, { exact: true }) })
    .and(page.locator(':not([data-search-result-active])'))
    .evaluate((element: HTMLElement) => element.click())
  await search.waitFor({ state: 'hidden' })
  await title.waitFor({ state: 'visible' })
  await page
    .getByRole('button', { name: 'Install plugin', exact: true })
    .or(page.getByRole('button', { name: 'More actions', exact: true }))
    .first()
    .waitFor({ state: 'visible' })
}

async function reinstallInApp(page: Page, version: string) {
  await openPlugin(page)
  console.log('Opened the development plugin detail in Codex App.')
  // Detail and sticky-header controls can both render the same plugin action.
  const install = page.getByRole('button', { name: 'Install plugin', exact: true }).first()
  const actions = page.getByRole('button', { name: 'More actions', exact: true }).first()
  if (await actions.isVisible()) {
    await actions.click()
    await page.getByRole('menuitem', { name: 'Uninstall', exact: true }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Uninstall', exact: true })
    await confirm.or(install).first().waitFor({ state: 'visible' })
    if (await confirm.isVisible()) await confirm.click()
    await install.waitFor({ state: 'visible' })
    console.log('Codex App confirms the development plugin is uninstalled.')
  }
  await stopCheckoutRuntime()
  // Reopen the catalog entry to read the generated source rather than cached installed details.
  await openPlugin(page)
  await page.getByText(version, { exact: true }).waitFor({ state: 'visible' })
  await install.evaluate((element: HTMLElement) => element.click())
  await actions.waitFor({ state: 'visible' })
  await page.getByText(version, { exact: true }).waitFor({ state: 'visible' })
  if (await install.isVisible())
    throw new Error('Codex App still offers installation; reinstall is not confirmed.')
}

async function main() {
  const args = parseReinstallArguments(process.argv.slice(2))
  if (!args) {
    console.log(
      [
        'Reinstall TemPad Dev (Dev) in the running Codex App through CDP.',
        'pnpm agent-plugin:reinstall [version] [--cdp-url http://127.0.0.1:9222]',
        '  --page-url <url|substring>  Select one app page when multiple windows are open',
        '  --app-path <path>           Host app (default: CODEX_APP_PATH or /Applications/ChatGPT.app)',
        '  --timeout-ms <number>       Each UI transition timeout (default: 60000)',
        '  --restart-codex             Explicitly authorize restarting the App to enable CDP',
        'CLI discovery checks the source only. Success requires uninstall/install in the App.',
        'Restart recovery runs detached and logs to .dev; it can interrupt other Codex tasks.'
      ].join('\n')
    )
    return
  }
  if (process.platform !== 'darwin')
    throw new Error('Codex App reinstall currently supports macOS only.')
  const appPath = resolve(args.appPath ?? process.env.CODEX_APP_PATH ?? '/Applications/ChatGPT.app')
  const version = resolveDevPluginVersion(
    JSON.parse(await readFile(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8')),
    args.version
  )
  const cliExecutable = resolveCodexExecutable(appPath)
  const appBinary = await appExecutable(appPath)
  const runCodex = async (command: string[]) =>
    JSON.parse(
      (await exec(cliExecutable, command, { timeout: args.timeoutMs, maxBuffer: 16 * 1024 * 1024 }))
        .stdout
    ) as unknown
  await inspectDevPlugin(runCodex, pluginRoot)
  if (args.resumeAfterRestart) await restartApp(args, appPath, appBinary)
  else if (args.restartCodex) {
    if (await cdpReady(args.cdpUrl))
      throw new Error(
        'CDP is already available. Retry without --restart-codex; select a page with --page-url if needed.'
      )
    await detachRestart({ ...args, version }, appPath)
    return
  }
  if (!(await cdpReady(args.cdpUrl)))
    throw new Error(
      `Codex CDP is unavailable at ${args.cdpUrl}. Use --restart-codex to authorize restarting the App and enabling CDP.`
    )
  const [listeners, running] = await Promise.all([
    exec('lsof', ['-nP', `-iTCP:${args.cdpPort}`, '-sTCP:LISTEN', '-Fp']),
    processes()
  ])
  assertCdpOwner(listeners.stdout, matchingProcesses(running, appBinary), running)
  // Resolve via native fetch, then connect directly: the App's local endpoint must not
  // depend on Playwright's proxy-aware HTTP discovery.
  const discovery = await fetch(new URL('/json/version', args.cdpUrl), {
    signal: AbortSignal.timeout(args.timeoutMs)
  })
  if (!discovery.ok) throw new Error(`CDP discovery failed: HTTP ${discovery.status}.`)
  const browser = await chromium.connectOverCDP(
    cdpWebSocketUrl(await discovery.json(), args.cdpUrl),
    { timeout: args.timeoutMs }
  )
  try {
    await waitUntil(
      async () =>
        browser
          .contexts()
          .some((context) => context.pages().some((page) => page.url().startsWith('app:'))),
      'the Codex App page',
      args.timeoutMs
    )
    const pages = browser.contexts().flatMap((context) => context.pages())
    const url = selectCodexPageUrl(
      pages.map((page) => page.url()),
      args.pageUrl
    )
    const page = pages.find((page) => page.url() === url)!
    page.setDefaultTimeout(args.timeoutMs)
    console.log(`Reinstalling ${displayName} ${version} in ${url}.`)
    await reinstallInApp(page, version)
    await inspectDevPlugin(runCodex, pluginRoot, version)
    console.log(`Verified Codex App installation and enabled disk version ${version}.`)
    console.log(
      'Run preflight and a native MCP read before live testing; installation alone does not prove task transport readiness.'
    )
  } finally {
    // For a CDP-attached browser, close disconnects this client without quitting Codex.
    await browser.close()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
