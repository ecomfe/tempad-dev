type RuntimeProcess = {
  pid: number
}

type RuntimeProcessState = {
  cli: RuntimeProcess[]
  hub: RuntimeProcess[]
}

type RuntimeState = 'installed' | 'uninstalled'

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
