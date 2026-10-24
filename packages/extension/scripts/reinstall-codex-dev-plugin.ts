import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

import { listRuntimeProcesses, resolveCodexExecutable } from './agent-authoring-runtime-preflight'
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
  stopRuntimeProcesses,
  type ReinstallArguments
} from './reinstall-codex-dev-plugin-runtime'
import { reinstallInApp, resumeThreadInApp } from './reinstall-codex-dev-plugin-ui'

const exec = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const pluginRoot = join(repoRoot, '.dev/plugins/tempad-dev-dev')
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type RecoveryReport = {
  checkout: string
  threadId: string
  version: string
  logPath: string
  phase: string
  updatedAt: string
  error?: string
}

async function saveReport(path: string, report: RecoveryReport) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

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
  const pids = matchingProcesses(await listRuntimeProcesses(), appBinary)
  if (pids.length > 1) throw new Error('Multiple main processes match the configured Codex App.')
  const waitForExit = (label: string) =>
    waitUntil(
      async () => matchingProcesses(await listRuntimeProcesses(), appBinary).length === 0,
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
      const remaining = matchingProcesses(await listRuntimeProcesses(), appBinary)
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
  const label = `${restartJobPrefix}${process.pid}.${Date.now()}`
  const logPath = join(repoRoot, '.dev', `${label}.log`)
  const reportPath = join(repoRoot, '.dev', `${label}.json`)
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, '', { mode: 0o600 })
  // Save identity before the independent job can quit the parent App.
  await saveReport(reportPath, {
    checkout: repoRoot,
    threadId: args.resumeThread!,
    version: args.version!,
    logPath,
    phase: 'scheduled',
    updatedAt: new Date().toISOString()
  })
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
      '/usr/bin/env',
      '-i',
      ...['HOME', 'USER', 'LOGNAME', 'PATH', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'TMPDIR'].flatMap(
        (key) => (process.env[key] === undefined ? [] : [`${key}=${process.env[key]}`])
      ),
      process.execPath,
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      '--resume-after-restart',
      '--resume-thread',
      args.resumeThread!,
      '--report-path',
      reportPath,
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
  console.log(
    `Restart, reinstall and task recovery scheduled. Report: ${reportPath}\nLog: ${logPath}`
  )
}

async function stopCheckoutRuntime() {
  const entries = ['cli.mjs', 'hub.mjs'].map((name) =>
    join(repoRoot, 'packages/mcp-server/dist', name)
  )
  const matching = async () => checkoutRuntimeProcesses(await listRuntimeProcesses(), entries)
  const stopped = await stopRuntimeProcesses(matching, (pid) => process.kill(pid, 'SIGTERM'))
  console.log(
    `Confirmed checkout CLI/Hub processes stayed stopped for 1500ms. Stopped PIDs: ${stopped.join(', ') || 'none'}.`
  )
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
        '  --resume-thread <uuid>      Restore and continue this task (restart defaults to CODEX_THREAD_ID)',
        'CLI discovery checks the source only. Success requires uninstall/install in the App.',
        'Restart recovery runs detached and logs to .dev; it can interrupt other Codex tasks.'
      ].join('\n')
    )
    return
  }
  if (process.platform !== 'darwin')
    throw new Error('Codex App reinstall currently supports macOS only.')
  if (!args.resumeAfterRestart) assertNoRestartJob((await exec('/bin/launchctl', ['list'])).stdout)
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
  if (args.restartCodex) {
    if (await cdpReady(args.cdpUrl))
      throw new Error(
        'CDP is already available. Retry without --restart-codex; select a page with --page-url if needed.'
      )
    await detachRestart({ ...args, version }, appPath)
    return
  }
  const report: RecoveryReport | undefined = args.reportPath
    ? JSON.parse(await readFile(args.reportPath, 'utf8'))
    : undefined
  if (
    args.reportPath &&
    (!report ||
      report.checkout !== repoRoot ||
      report.threadId !== args.resumeThread ||
      report.version !== version ||
      report.phase !== 'scheduled')
  )
    throw new Error('Recovery report does not match this scheduled restart; refusing to replay it.')
  const progress = async (phase: string, error?: string) => {
    console.log(phase, error ?? '')
    if (report && args.reportPath) {
      Object.assign(report, {
        phase,
        updatedAt: new Date().toISOString(),
        ...(error ? { error } : {})
      })
      await saveReport(args.reportPath, report)
    }
  }
  try {
    if (args.resumeAfterRestart) {
      await progress('restarting')
      await restartApp(args, appPath, appBinary)
    }
    if (!(await cdpReady(args.cdpUrl)))
      throw new Error(
        `Codex CDP is unavailable at ${args.cdpUrl}. Use --restart-codex to authorize restarting the App and enabling CDP.`
      )
    const [listeners, running] = await Promise.all([
      exec('lsof', ['-nP', `-iTCP:${args.cdpPort}`, '-sTCP:LISTEN', '-Fp']),
      listRuntimeProcesses()
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
      let installError: unknown
      try {
        await progress('reinstalling')
        await reinstallInApp(page, version, async () => {
          if (await inspectDevPlugin(runCodex, pluginRoot))
            throw new Error(
              'Plugin still installed on disk after UI uninstall; refusing to continue.'
            )
          await progress('uninstalled')
          await stopCheckoutRuntime()
          await progress('runtime-stopped')
        })
        await inspectDevPlugin(runCodex, pluginRoot, version)
        await progress('installed')
        console.log(`Verified Codex App installation and enabled disk version ${version}.`)
      } catch (error) {
        installError = error
        await progress('install-failed', error instanceof Error ? error.message : String(error))
      }
      if (args.resumeThread) {
        const message = [
          'Continue the TemPad Dev runtime refresh task after the authorized App restart.',
          installError
            ? 'The plugin reinstall failed; inspect its log before taking further action.'
            : `The development plugin was reinstalled at ${version}; verify runtime readiness before live testing.`,
          args.reportPath ? `Recovery report: ${args.reportPath}` : '',
          installError
            ? 'Do not repeat the restart or dispatch live Figma writes. Diagnose the saved failure first; preserve the existing task scope.'
            : 'Do not repeat this restart. Continue with Chrome extension reload, Figma refresh, MCP activation and preflight; preserve the existing task scope.'
        ]
          .filter(Boolean)
          .join(' ')
        const result = await resumeThreadInApp(page, args.resumeThread, message, () =>
          progress('resume-dispatching')
        )
        await progress(`resume-${result}`)
      }
      if (installError) throw installError
      await progress('complete')
      console.log(
        'Run preflight and a native MCP read before live testing; installation alone does not prove task transport readiness.'
      )
    } finally {
      // For a CDP-attached browser, close disconnects this client without quitting Codex.
      await browser.close()
    }
  } catch (error) {
    await progress('failed', error instanceof Error ? error.message : String(error))
    throw error
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
