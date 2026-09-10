type RuntimeProcess = {
  pid: number
}

type RuntimeProcessState = {
  cli: RuntimeProcess[]
  hub: RuntimeProcess[]
}

type RuntimeState = 'installed' | 'uninstalled'

export type CdpTarget = {
  title: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}

export function formatCodexConnectionError(
  cdpUrl: string,
  message: string,
  cdpReady: boolean
): string {
  const recovery = cdpReady
    ? 'The CDP endpoint is reachable; inspect the connection error and exposed targets without restarting Codex.'
    : 'Start Codex with remote debugging, or pass --restart-codex when the CDP endpoint is unavailable.'
  return `Could not connect to Codex CDP at ${cdpUrl}: ${message}\n${recovery}`
}

export async function selectCodexTarget(
  listTargets: () => Promise<CdpTarget[]>,
  pageUrl: string | undefined,
  timeoutMs: number
): Promise<CdpTarget> {
  const deadline = Date.now() + timeoutMs
  let targets: CdpTarget[] = []
  let lastFailure: { error: unknown } | undefined
  while (Date.now() <= deadline) {
    try {
      targets = await listTargets()
      lastFailure = undefined
    } catch (error) {
      targets = []
      lastFailure = { error }
    }
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
      throw new Error(
        `Multiple Codex pages are available. Pass --page-url with a unique substring:\n${candidates
          .map(({ title, url }) => `- ${title}: ${url}`)
          .join('\n')}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (lastFailure) {
    const { error } = lastFailure
    throw new Error(
      `Could not list Codex CDP targets: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
  throw new Error(
    `No Codex app page found at the CDP endpoint. Exposed pages:\n${targets
      .map(({ title, url }) => `- ${title}: ${url}`)
      .join('\n')}`
  )
}

export const detachedReinstallJobPrefix = 'com.tempad-dev.codex-plugin-reinstall.'

type DetachedReinstallIdentity = {
  jobLabel: string
  logFileName: string
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
        'Run pnpm agent-plugin:dev, then omit the version or pass the generated value.'
    )
  }
  return manifest.version
}

export function detachedReinstallIdentity(
  pid: number,
  timestamp: number
): DetachedReinstallIdentity {
  const suffix = `${String(pid)}.${String(timestamp)}`
  return {
    jobLabel: `${detachedReinstallJobPrefix}${suffix}`,
    logFileName: `codex-plugin-reinstall.${suffix}.log`
  }
}

export function assertNoDetachedReinstallJobs(labels: string[]): void {
  if (labels.length === 0) return
  throw new Error(`A detached Codex plugin reinstall is already running: ${labels.join(', ')}`)
}

export function assertRestartCodexNeeded(cdpReady: boolean): void {
  if (!cdpReady) return
  throw new Error(
    'Refusing to restart Codex because its CDP endpoint is already available. ' +
      'Run pnpm agent-plugin:reinstall without --restart-codex; if target selection fails, ' +
      'fix --page-url instead.'
  )
}

export function runtimeStateMatches(
  processes: RuntimeProcessState,
  expectedState: RuntimeState,
  baseline?: RuntimeProcessState
): boolean {
  if (expectedState === 'uninstalled') {
    return processes.cli.length === 0 && processes.hub.length === 0
  }

  return (
    processes.hub.length > 0 &&
    (baseline
      ? processes.cli.some(({ pid }) => !baseline.cli.some((process) => process.pid === pid))
      : processes.cli.length > 0)
  )
}
