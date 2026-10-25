import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

import { writeDurableJson } from '../durable-json'
import { assertPrivatePath } from '../runtime-platform'

export const ArtifactSchema = z
  .object({
    entry: z.string().refine(isAbsolute),
    bundle: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    release: z
      .object({
        directory: z.string().refine(isAbsolute),
        manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
        integrity: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type Artifact = z.infer<typeof ArtifactSchema>
export const ConfigSchema = z
  .object({
    version: z.literal(1),
    entry: z.string().refine(isAbsolute),
    bundle: z.string().regex(/^[a-f0-9]{64}$/),
    secret: z.uuid(),
    directories: z
      .object({
        runtime: z.string().refine(isAbsolute),
        state: z.string().refine(isAbsolute),
        assets: z.string().refine(isAbsolute),
        log: z.string().refine(isAbsolute)
      })
      .strict()
      .optional(),
    release: ArtifactSchema.shape.release
  })
  .strict()
export type PrototypeConfig = z.infer<typeof ConfigSchema> & { root: string }
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
    coldStart: z.literal(true).optional(),
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
  for (let attempt = 0; ; attempt++) {
    try {
      assertPrivatePath(path, 'file')
      return schema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      // A writer can atomically replace a snapshot during Windows ACL inspection.
      // Retry once from a fresh trust check, never accept the unchecked replacement.
      if (attempt === 0 && code === 'ERUNTIMEPATHCHANGED') continue
      throw error
    }
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
