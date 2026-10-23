import { DesignTaskSchema, stringRecord } from '@tempad-dev/shared'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

const SnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  current: stringRecord(z.string(), z.string()),
  fileFences: stringRecord(z.string(), z.boolean()).optional(),
  records: z.array(
    z.object({
      task: DesignTaskSchema.strip(),
      requestId: z.string(),
      retiredAt: z.number().nonnegative().optional(),
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
const RecoveryMarkerSchema = z.object({ recoveryGeneration: z.string().uuid() }).strict()
const FileReadMarkerSchema = z
  .object({
    readRequired: z.literal(true),
    task: z.object({ target: z.object({ fileKey: z.string().min(1) }).strict() }).strict()
  })
  .strict()
export type DesignTaskSnapshot = z.infer<typeof SnapshotSchema> & {
  recoveryGeneration?: string
  filesNeedingRead?: string[]
}

/** One lock-owning Hub writes a small atomic snapshot; transport and leases are never restored. */
export class DesignTaskStore {
  recoveryError?: string
  blockedFiles?: Set<string>
  private incompatibleRecords: unknown[] = []
  private readonly incompatibleCurrent = new Map<string, string>()
  constructor(private readonly path: string) {}

  load(): DesignTaskSnapshot | undefined {
    this.recoveryError = undefined
    this.blockedFiles = new Set()
    this.incompatibleRecords = []
    this.incompatibleCurrent.clear()
    try {
      if (!existsSync(this.path) && existsSync(`${this.path}.corrupt`))
        throw new Error('A quarantined task snapshot requires recovery.')
      const raw = SnapshotSchema.extend({ records: z.array(z.unknown()) }).parse(
        JSON.parse(readFileSync(this.path, 'utf8'))
      )
      const records: DesignTaskSnapshot['records'] = []
      const filesNeedingRead = new Set<string>()
      let recoveryGeneration: string | undefined
      for (const item of raw.records) {
        const readMarker = FileReadMarkerSchema.safeParse(item)
        if (readMarker.success) {
          filesNeedingRead.add(readMarker.data.task.target.fileKey)
          continue
        }
        const marker = RecoveryMarkerSchema.safeParse(item)
        if (marker.success) {
          if (recoveryGeneration) throw new Error('Multiple task recovery generations.')
          recoveryGeneration = marker.data.recoveryGeneration
          continue
        }
        if (item && typeof item === 'object' && 'recoveryGeneration' in item)
          throw new Error('Invalid task recovery generation.')
        const parsed = SnapshotSchema.shape.records.element.safeParse(item)
        if (parsed.success) {
          records.push(parsed.data)
          continue
        }
        const target = z
          .object({
            task: z.object({
              taskId: z.unknown().optional(),
              target: z.object({ fileKey: z.string().min(1) })
            })
          })
          .safeParse(item)
        if (!target.success) throw new Error('An incompatible task has no identifiable file fence.')
        const {
          taskId,
          target: { fileKey }
        } = target.data.task
        this.blockedFiles.add(fileKey)
        if (typeof taskId === 'string' && raw.current[fileKey] === taskId)
          this.incompatibleCurrent.set(fileKey, taskId)
        // Preserve incompatible records verbatim so later writes and restarts keep their fences.
        this.incompatibleRecords.push(item)
      }
      return {
        ...raw,
        records,
        ...(recoveryGeneration ? { recoveryGeneration } : {}),
        ...(filesNeedingRead.size ? { filesNeedingRead: [...filesNeedingRead] } : {})
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      // Keep a durable marker: restarting must never erase unknown Stop fences.
      if (existsSync(this.path) && !existsSync(`${this.path}.corrupt`)) {
        try {
          renameSync(this.path, `${this.path}.corrupt`)
        } catch {
          /* Keep the original evidence. */
        }
      }
      this.recoveryError = `Design task storage requires recovery at ${this.path}. Reads remain available; canvas writes are blocked to preserve saved Stop fences. Restore a verified complete snapshot including the latest Stop fences, or disconnect all MCP clients and run npx -y @tempad-dev/mcp@latest --recover-task-storage to retire all old tasks. Keep ${this.path}.corrupt; see Task storage recovery in the MCP README.`
      return undefined
    }
  }

  save(snapshot: DesignTaskSnapshot): void {
    if (this.recoveryError) throw new Error(this.recoveryError)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    const { recoveryGeneration, filesNeedingRead, ...stored } = snapshot
    writeFileSync(
      temporary,
      JSON.stringify({
        ...stored,
        current: { ...snapshot.current, ...Object.fromEntries(this.incompatibleCurrent) },
        // Old readers must fail closed rather than ignore a new top-level generation field.
        records: [
          ...(recoveryGeneration ? [RecoveryMarkerSchema.parse({ recoveryGeneration })] : []),
          // Old readers retain these as incompatible per-file fences.
          ...(filesNeedingRead ?? []).map((fileKey) =>
            FileReadMarkerSchema.parse({ readRequired: true, task: { target: { fileKey } } })
          ),
          ...snapshot.records,
          ...this.incompatibleRecords
        ]
      }),
      { mode: 0o600, flush: true }
    )
    renameSync(temporary, this.path)
  }
}
