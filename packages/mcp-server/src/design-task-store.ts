import { DesignTaskSchema } from '@tempad-dev/shared'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

const SnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  current: z.record(z.string(), z.string()),
  records: z.array(
    z.object({
      task: DesignTaskSchema,
      requestId: z.string(),
      browser: z
        .object({
          browserId: z.string(),
          origin: z.string(),
          tabId: z.number(),
          documentId: z.string()
        })
        .optional(),
      resultNodeIds: z.array(z.string()).optional()
    })
  )
})
export type DesignTaskSnapshot = z.infer<typeof SnapshotSchema>

/** One lock-owning Hub writes a small atomic snapshot; transport and leases are never restored. */
export class DesignTaskStore {
  constructor(private readonly path: string) {}

  load(): DesignTaskSnapshot | undefined {
    try {
      return SnapshotSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      // Do not silently erase task identity or Stop/Done fences on corrupt storage.
      throw error
    }
  }

  save(snapshot: DesignTaskSnapshot): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600, flush: true })
    renameSync(temporary, this.path)
  }
}
