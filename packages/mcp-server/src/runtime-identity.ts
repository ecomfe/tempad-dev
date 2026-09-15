import { createHash } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface HubRuntimeIdentity {
  schemaVersion: 1
  packageVersion: string
  runtimeFingerprint: string
  entryPath: string
  startedAt: string
  processId: number
  activeExtension: ActiveExtensionRuntimeIdentity | null
}

export interface ActiveExtensionRuntimeIdentity {
  id: string
  connectedAt: string
  version: string | null
  fingerprint: string | null
}

export interface ExtensionRuntimeSnapshot {
  version: string
  fingerprint: string
}

export function fingerprintRuntimeFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function createHubRuntimeIdentity(
  entryPath: string,
  packageVersion: string,
  options: { now?: Date; processId?: number } = {}
): HubRuntimeIdentity {
  return {
    schemaVersion: 1,
    packageVersion,
    runtimeFingerprint: fingerprintRuntimeFile(entryPath),
    entryPath: resolve(entryPath),
    startedAt: (options.now ?? new Date()).toISOString(),
    processId: options.processId ?? process.pid,
    activeExtension: null
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function parseHubRuntimeIdentity(value: unknown): HubRuntimeIdentity | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<HubRuntimeIdentity>
  const activeExtension = parseActiveExtensionRuntimeIdentity(candidate.activeExtension)
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.packageVersion !== 'string' ||
    !isSha256(candidate.runtimeFingerprint) ||
    typeof candidate.entryPath !== 'string' ||
    typeof candidate.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.startedAt)) ||
    typeof candidate.processId !== 'number' ||
    !Number.isInteger(candidate.processId) ||
    activeExtension === undefined
  ) {
    return null
  }
  return { ...candidate, activeExtension } as HubRuntimeIdentity
}

function parseActiveExtensionRuntimeIdentity(
  value: unknown
): ActiveExtensionRuntimeIdentity | null | undefined {
  // Keep runtime records from before active-extension publication readable for diagnostics.
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<ActiveExtensionRuntimeIdentity>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.connectedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.connectedAt)) ||
    (candidate.version !== null && typeof candidate.version !== 'string') ||
    (candidate.fingerprint !== null && !isSha256(candidate.fingerprint))
  ) {
    return undefined
  }
  return candidate as ActiveExtensionRuntimeIdentity
}

export function readHubRuntimeIdentity(path: string): HubRuntimeIdentity | null {
  try {
    return parseHubRuntimeIdentity(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export function writeHubRuntimeIdentity(path: string, identity: HubRuntimeIdentity): void {
  const temporaryPath = `${path}.${identity.processId}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, path)
}

export function removeHubRuntimeIdentityIfOwned(path: string, processId: number): void {
  if (readHubRuntimeIdentity(path)?.processId !== processId) return
  rmSync(path, { force: true })
}

export function getExtensionRuntimeIssues(runtime: ExtensionRuntimeSnapshot | undefined): string[] {
  if (!runtime) return ['Extension did not publish a runtime identity handshake']
  return []
}
