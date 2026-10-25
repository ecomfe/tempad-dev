import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

import { writeDurableJson } from '../durable-json'

export const ArtifactSchema = z
  .object({
    entry: z.string().refine(isAbsolute),
    bundle: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/)
  })
  .strict()
export type Artifact = z.infer<typeof ArtifactSchema>
export const EndpointsSchema = z
  .object({
    wsPort: z.number().int().min(1).max(65535),
    httpPort: z.number().int().min(1).max(65535),
    accessToken: z.string().min(32),
    legacyAccessToken: z.string().min(32)
  })
  .strict()
export type Endpoints = z.infer<typeof EndpointsSchema>
export const JournalSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    phase: z.enum(['committed', 'preparing', 'old-stopped', 'candidate-ready']),
    active: ArtifactSchema,
    candidate: ArtifactSchema.optional(),
    previous: ArtifactSchema.optional(),
    oldHub: z.object({ id: z.uuid(), pid: z.number().int().positive() }).optional(),
    failedBundles: z.array(z.string()),
    failure: z.string().optional()
  })
  .strict()
export type Journal = z.infer<typeof JournalSchema>

export function readPrivateJson<T extends z.ZodType>(
  path: string,
  schema: T
): z.output<T> | undefined {
  try {
    const stat = lstatSync(path)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077
    )
      throw new Error(`Refusing untrusted runtime state: ${path}`)
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

export function readEndpoints(root: string) {
  return readPrivateJson(join(root, 'endpoints.json'), EndpointsSchema)
}
export function writeEndpoints(root: string, endpoints: Endpoints) {
  writeDurableJson(join(root, 'endpoints.json'), EndpointsSchema.parse(endpoints))
}
export function readJournal(root: string) {
  return readPrivateJson(join(root, 'switch.json'), JournalSchema)
}
export function writeJournal(root: string, journal: Journal) {
  writeDurableJson(join(root, 'switch.json'), JournalSchema.parse(journal))
}

export function newerVersion(candidate: string, active: string) {
  const next = candidate.split('.').map(Number)
  const prior = active.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (next[index] !== prior[index]) return next[index]! > prior[index]!
  }
  return false
}
