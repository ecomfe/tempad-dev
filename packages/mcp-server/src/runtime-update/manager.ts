import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

import { writeDurableJson } from '../durable-json'
import { hubEnvironment } from '../process-environment'
import { ArtifactSchema, readPrivateJson, type Artifact } from '../runtime-prototype/state'
import { VersionSchema } from './manifest'

const StateSchema = z
  .object({
    version: z.literal(1),
    nextCheck: z.number(),
    failures: z.number().int().nonnegative(),
    lastAttempt: z.number().optional(),
    candidate: ArtifactSchema.optional(),
    error: z.string().optional()
  })
  .strict()
const INTERVAL = 6 * 60 * 60 * 1000

/** One owner schedules acquisition. Neither timers nor completion can activate it. */
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
      acquire: (selector: string, signal: AbortSignal) => Promise<Artifact | undefined>
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
      this.disabled = true
      this.state.error = `Update metadata is unreadable; automatic checks are disabled: ${String(error)}`
    }
  }

  get status() {
    return { ...this.state, checking: !!this.pending, automaticActivation: false as const }
  }
  private now() {
    return this.options.now?.() ?? Date.now()
  }
  private save() {
    writeDurableJson(join(this.options.root, 'updates.json'), StateSchema.parse(this.state))
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

  check(selector = 'latest', explicit = false): Promise<Artifact | undefined> {
    if (this.disabled) return Promise.reject(new Error(this.state.error))
    if (selector !== 'latest') VersionSchema.parse(selector)
    if (this.closed || (!explicit && !this.options.enrolled())) return Promise.resolve(undefined)
    if (this.pending)
      return this.pending.then((artifact) => {
        if (selector !== 'latest' && artifact?.version !== selector)
          throw new Error('Another version was being checked; retry the explicit request.')
        return artifact
      })
    clearTimeout(this.timer)
    this.abort = new AbortController()
    this.explicit = explicit
    // Persist the attempt before the worker starts. Crash/reconnect storms cannot
    // create an unbounded series of startup checks.
    this.state.lastAttempt = this.now()
    this.state.nextCheck = this.now() + 5 * 60 * 1000
    this.save()
    const signal = this.abort.signal
    this.pending = Promise.resolve()
      .then(() => this.options.acquire(selector, signal))
      .then((candidate) => {
        if (this.closed) return
        this.state = {
          ...this.state,
          candidate: candidate ? ArtifactSchema.parse(candidate) : this.state.candidate,
          failures: 0,
          error: undefined,
          nextCheck:
            this.now() +
            INTERVAL +
            Math.floor(((this.options.jitter?.() ?? Math.random()) * INTERVAL) / 10)
        }
        this.save()
        return candidate
      })
      .catch((error: unknown) => {
        if (!this.closed) {
          const failures = Math.min(this.state.failures + 1, 10)
          this.state = {
            ...this.state,
            failures,
            nextCheck: this.now() + Math.min(INTERVAL, 5 * 60 * 1000 * 2 ** (failures - 1)),
            error: String(error).slice(0, 2000)
          }
          this.save()
        }
        throw error
      })
      .finally(() => {
        this.pending = undefined
        this.abort = undefined
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
  current: string,
  signal: AbortSignal
) {
  if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
    throw new Error('Checkout runtimes cannot acquire releases.')
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [entry, '--cache', cache, '--version', selector, '--current', current],
    {
      env: hubEnvironment(process.env),
      signal,
      timeout: 150_000,
      maxBuffer: 1024 * 1024
    }
  )
  const result: unknown = JSON.parse(stdout)
  return result === null ? undefined : ArtifactSchema.parse(result)
}
