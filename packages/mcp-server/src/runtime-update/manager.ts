import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

import { writeDurableJson } from '../durable-json'
import { hubEnvironment } from '../process-environment'
import { assertPrivatePath } from '../runtime-platform'
import { ArtifactSchema, readPrivateJson, type Artifact } from '../runtime-prototype/state'
import {
  AcquisitionResultSchema,
  SelectionSchema,
  type AcquisitionContext,
  type AcquisitionResult,
  type SelectionCursor
} from './acquire'
import { VersionSchema } from './manifest'

const StateSchema = z
  .object({
    version: z.literal(1),
    nextCheck: z.number(),
    failures: z.number().int().nonnegative(),
    lastAttempt: z.number().optional(),
    candidate: ArtifactSchema.optional(),
    selection: SelectionSchema.optional(),
    error: z.string().optional()
  })
  .strict()
const INTERVAL = 6 * 60 * 60 * 1000

/** Acquisition owns downloads; only the supervisor can activate a committed candidate. */
export class ReleaseUpdates {
  private state: z.infer<typeof StateSchema>
  private timer?: ReturnType<typeof setTimeout>
  private pending?: Promise<Artifact | undefined>
  private abort?: AbortController
  private closed = false
  private explicit = false
  private disabled = false

  constructor(
    private readonly options: {
      root: string
      enrolled: () => boolean
      acquire: (
        selector: string,
        signal: AbortSignal,
        cursor?: SelectionCursor
      ) => Promise<AcquisitionResult>
      now?: () => number
      jitter?: () => number
    }
  ) {
    if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
      throw new Error('Checkout runtimes cannot acquire releases.')
    this.state = { version: 1, nextCheck: 0, failures: 0 }
    try {
      this.state = readPrivateJson(join(options.root, 'updates.json'), StateSchema) ?? this.state
    } catch (error) {
      try {
        // Only this derived download/check state is reconstructible. Preserve
        // its bytes before replacing it; trust and I/O failures remain fatal.
        if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error
        const path = join(options.root, 'updates.json')
        assertPrivatePath(path, 'file')
        const backup = join(options.root, `updates.invalid-${randomUUID()}.json`)
        writeFileSync(backup, readFileSync(path), { flag: 'wx', mode: 0o600, flush: true })
        this.save({
          version: 1,
          nextCheck: this.now() + 5 * 60 * 1000,
          failures: 1,
          error: `Update metadata was rebuilt; diagnostic copy: ${backup}. ${String(error)}`.slice(
            0,
            2000
          )
        })
      } catch (failure) {
        this.disabled = true
        this.state.error =
          `Update metadata is unreadable; checks are disabled: ${String(failure)}`.slice(0, 2000)
      }
    }
  }

  get status() {
    return { ...this.state, checking: !!this.pending, disabled: this.disabled }
  }
  private now() {
    return this.options.now?.() ?? Date.now()
  }
  private save(next: z.infer<typeof StateSchema>) {
    try {
      writeDurableJson(join(this.options.root, 'updates.json'), StateSchema.parse(next))
    } catch (error) {
      this.disabled = true
      clearTimeout(this.timer)
      this.state.error = (
        `Update metadata could not be saved; checks are disabled until MCP restarts: ${String(error)}` +
        (next.error ? ` (check error: ${next.error})` : '')
      ).slice(0, 2000)
      throw new Error(this.state.error, { cause: error })
    }
    // A downloaded candidate is visible to activation only after its metadata
    // commits. A failed fsync must not publish it or restore an older disk file.
    this.state = next
  }

  schedule() {
    clearTimeout(this.timer)
    if (this.closed || this.disabled) return
    if (!this.options.enrolled()) {
      if (!this.explicit) this.abort?.abort()
      return
    }
    if (this.pending) return
    this.timer = setTimeout(
      () => void this.check().catch(() => {}),
      Math.min(0x7fffffff, Math.max(0, this.state.nextCheck - this.now()))
    )
    this.timer.unref()
  }

  async check(selector = 'latest', explicit = false): Promise<Artifact | undefined> {
    if (this.disabled) throw new Error(this.state.error)
    if (selector !== 'latest') VersionSchema.parse(selector)
    if (this.closed || (!explicit && !this.options.enrolled())) return
    if (this.pending)
      return this.pending.then((artifact) => {
        if (selector !== 'latest' && artifact?.version !== selector)
          throw new Error('Another version was being checked; retry the explicit request.')
        return artifact
      })
    clearTimeout(this.timer)
    // Persist the attempt before the worker starts. Crash/reconnect storms cannot
    // create an unbounded series of startup checks.
    const now = this.now()
    this.save({ ...this.state, lastAttempt: now, nextCheck: now + 5 * 60 * 1000 })
    this.abort = new AbortController()
    this.explicit = explicit
    const signal = this.abort.signal
    this.pending = Promise.resolve()
      .then(() =>
        this.options.acquire(
          selector,
          signal,
          selector === 'latest' ? this.state.selection?.cursor : undefined
        )
      )
      .then((value) => {
        if (this.closed) return
        const { candidate, selection } = AcquisitionResultSchema.parse(value)
        this.save({
          ...this.state,
          // A successful scan also revokes old staging when the stable tag rewinds.
          candidate: selector === 'latest' ? candidate : (candidate ?? this.state.candidate),
          selection,
          failures: 0,
          error: undefined,
          nextCheck:
            this.now() +
            (selection?.cursor
              ? 30_000
              : INTERVAL + Math.floor(((this.options.jitter?.() ?? Math.random()) * INTERVAL) / 10))
        })
        return candidate
      })
      .catch((error: unknown) => {
        if (!this.closed && !this.disabled) {
          const failures = Math.min(this.state.failures + 1, 10)
          this.save({
            ...this.state,
            failures,
            nextCheck: this.now() + Math.min(INTERVAL, 5 * 60 * 1000 * 2 ** (failures - 1)),
            error: String(error).slice(0, 2000)
          })
        }
        throw error
      })
      .finally(() => {
        this.pending = undefined
        this.abort = undefined
        this.explicit = false
        this.schedule()
      })
    return this.pending
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    this.abort?.abort()
  }
}

export async function acquireRelease(
  entry: string,
  cache: string,
  selector: string,
  context: AcquisitionContext,
  signal: AbortSignal,
  cursor?: SelectionCursor
) {
  if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
    throw new Error('Checkout runtimes cannot acquire releases.')
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      entry,
      '--cache',
      cache,
      '--version',
      selector,
      '--active',
      JSON.stringify(context.active),
      '--control',
      JSON.stringify(context.control),
      '--excluded',
      JSON.stringify(context.excludedBundles ?? []),
      ...(cursor ? ['--cursor', JSON.stringify(cursor)] : [])
    ],
    {
      env: hubEnvironment(process.env),
      windowsHide: true,
      signal,
      timeout: 240_000,
      maxBuffer: 1024 * 1024
    }
  )
  const result: unknown = JSON.parse(stdout)
  return AcquisitionResultSchema.parse(result)
}
