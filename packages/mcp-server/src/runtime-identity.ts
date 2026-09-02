import { createHash } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface HubRuntimeIdentity {
  schemaVersion: 1
  packageVersion: string
  runtimeFingerprint: string
  entryPath: string
  startedAt: string
  processId: number
  expectedExtensionRuntimeFingerprint: string | null
  activeExtension: ActiveExtensionRuntimeIdentity | null
}

export interface ActiveExtensionRuntimeIdentity {
  id: string
  connectedAt: string
  version: string | null
  fingerprint: string | null
}

export interface HubRuntimeExpectation {
  packageVersion: string
  runtimeFingerprint: string
  expectedExtensionRuntimeFingerprint: string | null
}

export interface ExtensionRuntimeSnapshot {
  version: string
  fingerprint: string
}

export class RuntimeIdentityMismatchError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`TemPad runtime identity mismatch: ${issues.join('; ')}`)
    this.name = 'RuntimeIdentityMismatchError'
    this.issues = issues
  }
}

export function fingerprintRuntimeFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export async function resolveExpectedExtensionRuntimeFingerprint(
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const checkout = env.TEMPAD_MCP_DEV_CHECKOUT
  if (!checkout) return null
  const modulePath = join(resolve(checkout), 'scripts/extension-runtime-fingerprint.mjs')
  const fingerprintModule = (await import(pathToFileURL(modulePath).href)) as {
    computeExtensionRuntimeFingerprint?: (root: string) => string
  }
  if (typeof fingerprintModule.computeExtensionRuntimeFingerprint !== 'function') {
    throw new Error(`Invalid extension runtime fingerprint module: ${modulePath}`)
  }
  return fingerprintModule.computeExtensionRuntimeFingerprint(resolve(checkout))
}

export function createHubRuntimeIdentity(
  entryPath: string,
  packageVersion: string,
  expectedExtensionRuntimeFingerprint: string | null,
  options: { now?: Date; processId?: number } = {}
): HubRuntimeIdentity {
  return {
    schemaVersion: 1,
    packageVersion,
    runtimeFingerprint: fingerprintRuntimeFile(entryPath),
    entryPath: resolve(entryPath),
    startedAt: (options.now ?? new Date()).toISOString(),
    processId: options.processId ?? process.pid,
    expectedExtensionRuntimeFingerprint,
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
    (candidate.expectedExtensionRuntimeFingerprint !== null &&
      !isSha256(candidate.expectedExtensionRuntimeFingerprint)) ||
    activeExtension === undefined
  ) {
    return null
  }
  return { ...candidate, activeExtension } as HubRuntimeIdentity
}

function parseActiveExtensionRuntimeIdentity(
  value: unknown
): ActiveExtensionRuntimeIdentity | null | undefined {
  // Runtime records from before active-extension publication remain readable so
  // a new CLI can reject or replace their stale Hub by executable fingerprint.
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

export function compareHubRuntimeIdentity(
  identity: HubRuntimeIdentity | null,
  expected: HubRuntimeExpectation
): string[] {
  if (!identity) return ['Hub did not publish a valid runtime identity record']
  const issues: string[] = []
  if (identity.packageVersion !== expected.packageVersion) {
    issues.push(
      `Hub package version is ${identity.packageVersion}; expected ${expected.packageVersion}`
    )
  }
  if (identity.runtimeFingerprint !== expected.runtimeFingerprint) {
    issues.push('Hub executable fingerprint differs from the requesting MCP client')
  }
  if (
    identity.expectedExtensionRuntimeFingerprint !== expected.expectedExtensionRuntimeFingerprint
  ) {
    issues.push('Hub extension-source cohort differs from the requesting MCP client')
  }
  return issues
}

export function assertHubRuntimeIdentity(
  identity: HubRuntimeIdentity | null,
  expected: HubRuntimeExpectation
): HubRuntimeIdentity {
  const issues = compareHubRuntimeIdentity(identity, expected)
  if (issues.length) throw new RuntimeIdentityMismatchError(issues)
  return identity as HubRuntimeIdentity
}

export function compareExtensionRuntimeIdentity(
  runtime: ExtensionRuntimeSnapshot | undefined,
  expectedFingerprint: string | null
): string[] {
  if (!runtime) return ['Extension did not publish a runtime identity handshake']
  if (expectedFingerprint && runtime.fingerprint !== expectedFingerprint) {
    return ['Active extension fingerprint differs from the development checkout']
  }
  return []
}
