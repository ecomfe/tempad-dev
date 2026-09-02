import { execFile } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const defaultRepoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tempadPluginId = 'tempad-dev-dev@tempad-dev-dev'
const tempadPluginName = 'tempad-dev-dev'
const monthIndexes = new Map(
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(
    (month, index) => [month, index]
  )
)

interface RuntimeProcess {
  command: string
  pid: number
  ppid: number
  startedAtMs: number
}

interface RuntimePaths {
  cli: string
  hub: string
}

interface RuntimeBundleMtimes {
  cli: number
  hub: number
}

interface EnabledPlugin {
  id: string
  path: string
  version: string
}

interface PreflightIssue {
  code: string
  message: string
}

interface AuthoringPreflightArguments {
  checkout: string
}

interface RuntimeConfiguration {
  generatedVersion: string
  hubRuntimeIdentityPath: string
  paths: RuntimePaths
}

interface ActiveExtensionRuntimeIdentity {
  connectedAt: string
  fingerprint: string | null
  id: string
  version: string | null
}

interface HubRuntimeIdentitySnapshot {
  activeExtension: ActiveExtensionRuntimeIdentity | null
  expectedExtensionRuntimeFingerprint: string | null
  processId: number
}

export interface AuthoringPreflightResult {
  valid: boolean
  checkedAt: string
  checkout: string
  runtime: {
    cli: {
      bundle: string
      bundleModifiedAt: string
      processes: Array<{ pid: number; startedAt: string }>
    }
    hub: {
      bundle: string
      bundleModifiedAt: string
      processes: Array<{ pid: number; startedAt: string }>
    }
    extension: {
      checkoutFingerprint: string
      identityFile: string
      hubProcessId: number | null
      active: ActiveExtensionRuntimeIdentity | null
    }
  }
  plugin: {
    generatedVersion: string
    installedVersion: string | null
    installedPath: string | null
  }
  issues: PreflightIssue[]
}

function fail(message: string): never {
  throw new Error(message)
}

function usage(): string {
  return [
    'Verify the live authoring runtime before page creation:',
    '',
    '  pnpm agent-eval:preflight [--checkout <path>]',
    '',
    'Options:',
    '  --checkout <path>  TemPad checkout (default: current repository)',
    '  --help             Show this help'
  ].join('\n')
}

function parseArguments(argv: string[]): AuthoringPreflightArguments | null {
  if (argv.includes('--help')) return null
  let checkout = defaultRepoRoot

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument) continue
    if (argument !== '--checkout') {
      fail(`Unknown option: ${argument}\n\n${usage()}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for ${argument}.`)
    index += 1
    checkout = normalize(resolve(value))
  }

  return { checkout }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return await readJson(path)
  } catch {
    return null
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function parseHubRuntimeIdentitySnapshot(value: unknown): HubRuntimeIdentitySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    !Number.isInteger(candidate.processId) ||
    (candidate.expectedExtensionRuntimeFingerprint !== null &&
      !isSha256(candidate.expectedExtensionRuntimeFingerprint)) ||
    !Object.hasOwn(candidate, 'activeExtension')
  ) {
    return null
  }
  if (candidate.activeExtension === null) {
    return {
      activeExtension: null,
      expectedExtensionRuntimeFingerprint: candidate.expectedExtensionRuntimeFingerprint as
        | string
        | null,
      processId: candidate.processId as number
    }
  }
  if (!candidate.activeExtension || typeof candidate.activeExtension !== 'object') return null
  const active = candidate.activeExtension as Record<string, unknown>
  if (
    typeof active.id !== 'string' ||
    typeof active.connectedAt !== 'string' ||
    !Number.isFinite(Date.parse(active.connectedAt)) ||
    (active.version !== null && typeof active.version !== 'string') ||
    (active.fingerprint !== null && !isSha256(active.fingerprint))
  ) {
    return null
  }
  return {
    activeExtension: active as unknown as ActiveExtensionRuntimeIdentity,
    expectedExtensionRuntimeFingerprint: candidate.expectedExtensionRuntimeFingerprint as
      | string
      | null,
    processId: candidate.processId as number
  }
}

export function evaluateActiveExtensionRuntime(
  expectedFingerprint: string,
  hubProcesses: RuntimeProcess[],
  identityInput: unknown
): {
  activeExtension: ActiveExtensionRuntimeIdentity | null
  hubProcessId: number | null
  issues: PreflightIssue[]
} {
  const issues: PreflightIssue[] = []
  const identity = parseHubRuntimeIdentitySnapshot(identityInput)
  if (!identity) {
    issues.push({
      code: 'RUNTIME_IDENTITY_RECORD_MISSING',
      message:
        'The active Hub did not publish a readable active-extension runtime record. Refresh the MCP runtime before dispatch.'
    })
    return { activeExtension: null, hubProcessId: null, issues }
  }
  if (!hubProcesses.some(({ pid }) => pid === identity.processId)) {
    issues.push({
      code: 'RUNTIME_IDENTITY_RECORD_STALE',
      message: `The runtime identity record belongs to Hub PID ${String(identity.processId)}, not the exact-checkout Hub selected by preflight.`
    })
  }
  if (identity.expectedExtensionRuntimeFingerprint !== expectedFingerprint) {
    issues.push({
      code: 'RUNTIME_HUB_EXTENSION_EXPECTATION_MISMATCH',
      message:
        'The active Hub extension-source expectation differs from the current checkout. Refresh the MCP runtime before dispatch.'
    })
  }
  if (!identity.activeExtension) {
    issues.push({
      code: 'RUNTIME_EXTENSION_INACTIVE',
      message:
        'The Hub has no active extension connection. Activate the intended Figma file and repeat preflight before page creation.'
    })
  } else if (!identity.activeExtension.fingerprint) {
    issues.push({
      code: 'RUNTIME_EXTENSION_IDENTITY_MISSING',
      message:
        'The active extension has not published a runtime fingerprint. Reload the browser extension and Figma tab before dispatch.'
    })
  } else if (identity.activeExtension.fingerprint !== expectedFingerprint) {
    issues.push({
      code: 'RUNTIME_EXTENSION_FINGERPRINT_MISMATCH',
      message: `The active extension fingerprint ${identity.activeExtension.fingerprint} differs from the current checkout fingerprint ${expectedFingerprint}. Rebuild/reload the browser extension and Figma tab before dispatch.`
    })
  }
  return {
    activeExtension: identity.activeExtension,
    hubProcessId: identity.processId,
    issues
  }
}

export function commandIncludesExactPath(command: string, path: string): boolean {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s'"])${escapedPath}(?=$|[\\s'"])`).test(command)
}

export function parseProcessTable(output: string): RuntimeProcess[] {
  return output
    .split('\n')
    .map((line): RuntimeProcess | null => {
      const match = line.match(
        /^\s*(\d+)\s+(\d+)\s+\S+\s+(\S+)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+(.*)$/
      )
      if (!match) return null
      const [, pid, ppid, month, day, hour, minute, second, year, command] = match
      const monthIndex = month ? monthIndexes.get(month) : undefined
      if (
        !pid ||
        !ppid ||
        monthIndex === undefined ||
        !day ||
        !hour ||
        !minute ||
        !second ||
        !year ||
        !command
      ) {
        return null
      }
      const startedAtMs = new Date(
        Number(year),
        monthIndex,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ).getTime()
      if (!Number.isFinite(startedAtMs)) return null
      return { command: command.trim(), pid: Number(pid), ppid: Number(ppid), startedAtMs }
    })
    .filter((process): process is RuntimeProcess => process !== null)
}

export function evaluateRuntimeFreshness(
  paths: RuntimePaths,
  bundleMtimes: RuntimeBundleMtimes,
  processes: RuntimeProcess[]
): {
  cli: RuntimeProcess[]
  hub: RuntimeProcess[]
  issues: PreflightIssue[]
} {
  const cli = processes.filter(({ command }) => commandIncludesExactPath(command, paths.cli))
  const hub = processes.filter(({ command }) => commandIncludesExactPath(command, paths.hub))
  const issues: PreflightIssue[] = []

  if (cli.length === 0 && hub.length === 0) {
    issues.push({
      code: 'RUNTIME_ABSENT',
      message:
        'No exact-checkout TemPad CLI or Hub process is running. Repair or reinstall the plugin before creating an evaluation page.'
    })
  } else if (cli.length === 0 || hub.length === 0) {
    issues.push({
      code: 'RUNTIME_PARTIAL',
      message: `The exact-checkout runtime is partial: CLI=${String(cli.length)}, Hub=${String(hub.length)}. Repair or reinstall it before dispatch.`
    })
  }

  if (hub.length > 1) {
    issues.push({
      code: 'RUNTIME_MULTIPLE_HUBS',
      message: `Found ${String(hub.length)} exact-checkout Hub processes; require exactly one unambiguous Hub before dispatch.`
    })
  }

  // macOS `ps lstart` has one-second precision. Treat an equal-second process
  // as stale rather than guessing that it started after a sub-second bundle write.
  const staleCli = cli.filter(({ startedAtMs }) => startedAtMs <= bundleMtimes.cli)
  const staleHub = hub.filter(({ startedAtMs }) => startedAtMs <= bundleMtimes.hub)
  if (staleCli.length > 0) {
    issues.push({
      code: 'RUNTIME_STALE_CLI',
      message: `${String(staleCli.length)} exact-checkout CLI process(es) predate the current CLI bundle. Replace the plugin runtime before dispatch.`
    })
  }
  if (staleHub.length > 0) {
    issues.push({
      code: 'RUNTIME_STALE_HUB',
      message:
        'The exact-checkout Hub predates the current Hub bundle. Replace the plugin runtime before dispatch; a fresh task alone may reuse this stale Hub.'
    })
  }

  return { cli, hub, issues }
}

export function parseEnabledPlugins(output: string): EnabledPlugin[] {
  return output
    .split('\n')
    .map((line): EnabledPlugin | null => {
      const match = line.match(/^\s*(\S+@\S+)\s+installed,\s+enabled\s+(\S+)\s+(.+?)\s*$/)
      if (!match) return null
      const [, id, version, path] = match
      return id && version && path ? { id, path, version } : null
    })
    .filter((plugin): plugin is EnabledPlugin => plugin !== null)
}

export function evaluateTempadPluginIdentity(
  generatedVersion: string,
  plugins: EnabledPlugin[]
): { installed: EnabledPlugin | null; issues: PreflightIssue[] } {
  const matches = plugins.filter(({ id }) => id === tempadPluginId)
  const issues: PreflightIssue[] = []
  if (matches.length !== 1) {
    issues.push({
      code: 'TEMPAD_PLUGIN_NOT_ENABLED',
      message: `Expected exactly one enabled ${tempadPluginId} installation, found ${String(matches.length)}.`
    })
    return { installed: null, issues }
  }
  const installed = matches[0]!
  if (installed.version !== generatedVersion) {
    issues.push({
      code: 'TEMPAD_PLUGIN_VERSION_MISMATCH',
      message: `Generated TemPad cachebuster ${generatedVersion} differs from installed enabled version ${installed.version}. Replace the plugin before dispatch.`
    })
  }
  return { installed, issues }
}

async function resolveRuntimeConfiguration(checkout: string): Promise<RuntimeConfiguration> {
  const pluginRoot = join(checkout, '.dev/plugins/tempad-dev-dev')
  const manifestPath = join(pluginRoot, '.codex-plugin/plugin.json')
  const manifest = objectValue(await readJson(manifestPath), manifestPath)
  if (manifest.name !== tempadPluginName || typeof manifest.version !== 'string') {
    fail(`Unexpected generated plugin identity in ${manifestPath}.`)
  }

  const mcpPath = join(pluginRoot, '.mcp.json')
  const mcp = objectValue(await readJson(mcpPath), mcpPath)
  const servers = objectValue(mcp.mcpServers, `${mcpPath}#mcpServers`)
  const server = objectValue(servers[tempadPluginName], `${mcpPath}#mcpServers.${tempadPluginName}`)
  if (!Array.isArray(server.args) || typeof server.args[0] !== 'string') {
    fail(`Missing CLI entry in ${mcpPath}.`)
  }
  const cliArgument = server.args[0]
  const cli = normalize(isAbsolute(cliArgument) ? cliArgument : resolve(pluginRoot, cliArgument))
  const hub = join(dirname(cli), 'hub.mjs')
  const serverEnv = server.env === undefined ? {} : objectValue(server.env, `${mcpPath}#env`)
  const configuredRuntimeDir = serverEnv.TEMPAD_MCP_RUNTIME_DIR
  if (configuredRuntimeDir !== undefined && typeof configuredRuntimeDir !== 'string') {
    fail(`Invalid TEMPAD_MCP_RUNTIME_DIR in ${mcpPath}.`)
  }
  const runtimeDir = configuredRuntimeDir
    ? normalize(
        isAbsolute(configuredRuntimeDir)
          ? configuredRuntimeDir
          : resolve(pluginRoot, configuredRuntimeDir)
      )
    : join(tmpdir(), 'tempad-dev', 'run')
  await Promise.all([access(cli), access(hub)])
  return {
    generatedVersion: manifest.version,
    hubRuntimeIdentityPath: join(runtimeDir, 'hub-runtime.json'),
    paths: { cli, hub }
  }
}

async function resolveCheckoutExtensionFingerprint(checkout: string): Promise<string> {
  const modulePath = join(checkout, 'scripts/extension-runtime-fingerprint.mjs')
  const fingerprintModule = (await import(pathToFileURL(modulePath).href)) as {
    computeExtensionRuntimeFingerprint?: (root: string) => string
  }
  if (typeof fingerprintModule.computeExtensionRuntimeFingerprint !== 'function') {
    fail(`Invalid extension runtime fingerprint module: ${modulePath}`)
  }
  return fingerprintModule.computeExtensionRuntimeFingerprint(checkout)
}

async function listProcesses(): Promise<RuntimeProcess[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
  return parseProcessTable(stdout)
}

async function listEnabledPlugins(): Promise<EnabledPlugin[]> {
  const { stdout } = await execFileAsync('codex', ['plugin', 'list'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  return parseEnabledPlugins(stdout)
}

function processEvidence(processes: RuntimeProcess[]): Array<{ pid: number; startedAt: string }> {
  return processes.map(({ pid, startedAtMs }) => ({
    pid,
    startedAt: new Date(startedAtMs).toISOString()
  }))
}

export async function runPreflight(
  args: AuthoringPreflightArguments
): Promise<AuthoringPreflightResult> {
  const runtime = await resolveRuntimeConfiguration(args.checkout)
  const [cliStat, hubStat, processes, plugins, checkoutExtensionFingerprint, hubRuntimeIdentity] =
    await Promise.all([
      stat(runtime.paths.cli),
      stat(runtime.paths.hub),
      listProcesses(),
      listEnabledPlugins(),
      resolveCheckoutExtensionFingerprint(args.checkout),
      readOptionalJson(runtime.hubRuntimeIdentityPath)
    ])
  const freshness = evaluateRuntimeFreshness(
    runtime.paths,
    { cli: cliStat.mtimeMs, hub: hubStat.mtimeMs },
    processes
  )
  const pluginIdentity = evaluateTempadPluginIdentity(runtime.generatedVersion, plugins)
  const activeExtension = evaluateActiveExtensionRuntime(
    checkoutExtensionFingerprint,
    freshness.hub,
    hubRuntimeIdentity
  )
  const issues = [...freshness.issues, ...pluginIdentity.issues, ...activeExtension.issues]

  return {
    valid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    checkout: args.checkout,
    runtime: {
      cli: {
        bundle: runtime.paths.cli,
        bundleModifiedAt: cliStat.mtime.toISOString(),
        processes: processEvidence(freshness.cli)
      },
      hub: {
        bundle: runtime.paths.hub,
        bundleModifiedAt: hubStat.mtime.toISOString(),
        processes: processEvidence(freshness.hub)
      },
      extension: {
        checkoutFingerprint: checkoutExtensionFingerprint,
        identityFile: runtime.hubRuntimeIdentityPath,
        hubProcessId: activeExtension.hubProcessId,
        active: activeExtension.activeExtension
      }
    },
    plugin: {
      generatedVersion: runtime.generatedVersion,
      installedVersion: pluginIdentity.installed?.version ?? null,
      installedPath: pluginIdentity.installed?.path ?? null
    },
    issues
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (!args) {
    console.log(usage())
    return
  }
  if (process.platform === 'win32') {
    fail('Authoring runtime process freshness verification is not implemented for Windows.')
  }
  const result = await runPreflight(args)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.valid !== true) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
