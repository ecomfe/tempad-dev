import { z } from 'zod'

export const PACKAGE_NAME = '@tempad-dev/mcp'
export const MANIFEST_PATH = 'dist/runtime-manifest.json'
export const VersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine((value) => value.split('.').every((part) => Number.isSafeInteger(Number(part))))
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const IntegritySchema = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/)

export function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !/[\\:]/.test(path) &&
    [...path].every((character) => character.charCodeAt(0) >= 32 && character !== '\x7f') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
}

export const PolicySchema = z
  .object({
    version: z.literal(1),
    guidanceEpoch: z.number().int().positive(),
    guidanceReview: z
      .object({
        version: VersionSchema,
        sourceHash: HashSchema,
        decision: z.enum(['initial', 'compatible', 'new-epoch']),
        baseline: z.object({ version: VersionSchema, integrity: IntegritySchema }),
        rationale: z.string().min(24).max(4000)
      })
      .strict(),
    controlProtocols: z.array(z.number().int().positive()).min(1).max(16),
    state: z
      .object({
        family: z.string().min(1),
        reads: z.array(z.number().int().positive()).min(1),
        writes: z.number().int().positive()
      })
      .strict(),
    extension: z
      .object({ protocols: z.array(z.number().int().positive()).min(1), legacy: z.boolean() })
      .strict(),
    hookProtocol: z.literal(2)
  })
  .strict()
export type RuntimePolicy = z.infer<typeof PolicySchema>

export const ManifestSchema = PolicySchema.extend({
  name: z.literal(PACKAGE_NAME),
  packageVersion: VersionSchema,
  entry: z.literal('dist/managed-runtime.mjs'),
  node: z.string().min(1),
  platforms: z.array(z.enum(['darwin', 'linux'])).min(1),
  wireHash: HashSchema,
  presentationHash: HashSchema,
  lockHash: HashSchema,
  files: z.record(z.string().refine(safePath), HashSchema)
}).refine(
  (value) => value.packageVersion === value.guidanceReview.version,
  'Guidance review belongs to another release.'
)
export type RuntimeManifest = z.infer<typeof ManifestSchema>

export function compareVersions(a: string, b: string) {
  const left = VersionSchema.parse(a).split('.').map(Number)
  const right = VersionSchema.parse(b).split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return Math.sign(left[index]! - right[index]!)
  }
  return 0
}

/** Fail closed on an engine expression this release's checker cannot interpret. */
export function supportsNode(range: string, version = process.versions.node) {
  const [major] = VersionSchema.parse(version).split('.').map(Number)
  const clauses = range.split('||').map((value) => value.trim())
  if (!clauses.every((value) => /^(?:\^|>=)(?:0|[1-9]\d*)$/.test(value)))
    throw new Error('Unsupported Node engine policy; update the release checker first.')
  return clauses.some((value) =>
    value.startsWith('^') ? major === Number(value.slice(1)) : major! >= Number(value.slice(2))
  )
}

export function compatibilityReasons(active: RuntimeManifest, next: RuntimeManifest): string[] {
  const reasons: string[] = []
  if (!supportsNode(next.node)) reasons.push('Node restart/upgrade required')
  if (!next.platforms.includes(process.platform as 'darwin' | 'linux'))
    reasons.push('Unsupported platform')
  if (active.wireHash !== next.wireHash) reasons.push('MCP contract changed; restart MCP')
  if (active.guidanceEpoch !== next.guidanceEpoch)
    reasons.push('Guidance epoch changed; restart MCP')
  if (!active.controlProtocols.every((value) => next.controlProtocols.includes(value)))
    reasons.push('Control component restart required')
  if (
    active.state.family !== next.state.family ||
    !next.state.reads.includes(active.state.writes) ||
    !active.state.reads.includes(next.state.writes)
  )
    reasons.push('State rollback compatibility is missing')
  if (
    (active.extension.legacy && !next.extension.legacy) ||
    !active.extension.protocols.every((value) => next.extension.protocols.includes(value))
  )
    reasons.push('Released extension compatibility is missing')
  return reasons
}

/** Automatic consent never crosses a breaking-release boundary. */
export function automaticCompatibilityReasons(active: RuntimeManifest, next: RuntimeManifest) {
  const reasons = compatibilityReasons(active, next)
  const [major, minor] = active.packageVersion.split('.').map(Number)
  const [nextMajor, nextMinor] = next.packageVersion.split('.').map(Number)
  if (major !== nextMajor || (major === 0 && minor !== nextMinor))
    reasons.push('Breaking release boundary; explicit update required')
  return reasons
}

/** Cold replacement has no frozen MCP sessions, but must retain safe state/rollback access. */
export function coldCompatibilityReasons(active: RuntimeManifest, next: RuntimeManifest) {
  const reasons = compatibilityReasons(active, next).filter(
    (reason) =>
      reason !== 'MCP contract changed; restart MCP' &&
      reason !== 'Guidance epoch changed; restart MCP' &&
      reason !== 'Control component restart required'
  )
  if (!active.controlProtocols.some((value) => next.controlProtocols.includes(value)))
    reasons.push('No common control protocol for binary rollback')
  return reasons
}

export function validatePolicyBaseline(current: RuntimeManifest, baseline?: RuntimeManifest) {
  const review = current.guidanceReview
  if (compareVersions(current.packageVersion, review.baseline.version) <= 0)
    throw new Error('A release must be newer than its reviewed baseline.')
  if (!baseline) {
    if (review.decision !== 'initial' || current.guidanceEpoch !== 1)
      throw new Error('Missing historical guidance evidence.')
    return
  }
  if (baseline.packageVersion !== review.baseline.version)
    throw new Error('Wrong release baseline.')
  if (current.guidanceEpoch < baseline.guidanceEpoch)
    throw new Error('Guidance epochs cannot decrease.')
  if (
    review.decision === 'initial' ||
    (review.decision === 'compatible') !== (current.guidanceEpoch === baseline.guidanceEpoch)
  )
    throw new Error('Guidance decision and epoch disagree.')
  if (!baseline.controlProtocols.every((value) => current.controlProtocols.includes(value)))
    throw new Error('Control protocol retirement requires a separate migration review.')
}
