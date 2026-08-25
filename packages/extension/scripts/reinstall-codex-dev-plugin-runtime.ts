export type RuntimeProcess = {
  pid: number
}

export type RuntimeProcessState = {
  cli: RuntimeProcess[]
  hub: RuntimeProcess[]
}

export type RuntimeState = 'installed' | 'uninstalled'

export const detachedReinstallJobPrefix = 'com.tempad-dev.codex-plugin-reinstall.'

export type DetachedReinstallIdentity = {
  jobLabel: string
  logFileName: string
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
