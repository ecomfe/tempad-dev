import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'

import type { AuthoringPreflightResult } from './agent-authoring-runtime-preflight'

import { runPreflight } from './agent-authoring-runtime-preflight'
import { inspectAuthoringRollout } from './inspect-agent-authoring-rollout'
import { extractSkillCatalog, fingerprintSkillCatalog } from './inspect-agent-skill-catalog'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: 'Expected an ISO UTC timestamp.'
  })
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const DevelopmentPluginCacheVersionPattern =
  /(\/plugins\/cache\/tempad-dev-dev\/tempad-dev-dev\/)[^/]+(\/skills\/)/

const ComparisonSchema = z
  .object({
    id: z.string().min(1),
    arm: z.enum(['baseline', 'candidate']),
    subject: z.string().min(1)
  })
  .strict()

export const AuthoringRunNoteSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    createdAt: IsoDateSchema,
    kind: z.enum(['open', 'probe', 'comparison']),
    intent: z.string().min(1),
    task: z
      .object({
        prompt: z.string().min(1),
        expectedPageName: z.string().min(1).optional()
      })
      .strict(),
    comparison: ComparisonSchema.optional()
  })
  .strict()
  .superRefine((note, context) => {
    if (note.kind === 'comparison' && !note.comparison) {
      context.addIssue({
        code: 'custom',
        message: 'Comparison runs require comparison identity, arm, and subject.',
        path: ['comparison']
      })
    }
    if (note.kind !== 'comparison' && note.comparison) {
      context.addIssue({
        code: 'custom',
        message: 'Only comparison runs may carry comparison metadata.',
        path: ['comparison']
      })
    }
  })

const RunArtifactsSchema = z
  .object({
    taskId: z.string().min(1).nullable(),
    pageId: z.string().min(1).nullable(),
    pageName: z.string().min(1).nullable(),
    evidence: z.array(z.string().min(1))
  })
  .strict()

const RunRolloutSchema = z
  .object({
    source: z.string().min(1),
    sha256: Sha256Schema,
    startedAt: IsoDateSchema.nullable(),
    promptSha256: Sha256Schema.nullable(),
    runtime: z
      .object({
        locked: z.boolean(),
        valid: z.boolean(),
        hubFingerprint: Sha256Schema.nullable(),
        extensionFingerprint: Sha256Schema.nullable()
      })
      .strict(),
    skills: z
      .object({
        catalogFingerprint: Sha256Schema,
        runtimeFingerprint: Sha256Schema,
        contextFingerprint: Sha256Schema,
        authoringSkillLocator: z.string().min(1).nullable()
      })
      .strict()
      .nullable()
  })
  .strict()

export const AuthoringRunReviewDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    noteId: z.string().min(1),
    status: z.enum(['valid', 'invalid']),
    assessment: z.string().min(1),
    nextAction: z.string().min(1),
    artifacts: RunArtifactsSchema,
    skillChangeRationale: z.string().min(1).optional()
  })
  .strict()

export type AuthoringRunNote = z.infer<typeof AuthoringRunNoteSchema>
export type AuthoringRunReviewDraft = z.infer<typeof AuthoringRunReviewDraftSchema>

const AuthoringRunStartEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('start'),
    recordedAt: IsoDateSchema,
    noteSha256: Sha256Schema,
    note: AuthoringRunNoteSchema,
    preflight: z.custom<AuthoringPreflightResult>()
  })
  .strict()

const AuthoringRunFinishEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('finish'),
    recordedAt: IsoDateSchema,
    noteId: z.string().min(1),
    noteSha256: Sha256Schema,
    review: AuthoringRunReviewDraftSchema,
    rollout: RunRolloutSchema.nullable()
  })
  .strict()

const AuthoringRunAbandonEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('abandon'),
    recordedAt: IsoDateSchema,
    noteId: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict()

type AuthoringRunRollout = z.infer<typeof RunRolloutSchema>
type AuthoringRunStartEvent = z.infer<typeof AuthoringRunStartEventSchema>
type AuthoringRunFinishEvent = z.infer<typeof AuthoringRunFinishEventSchema>
type AuthoringRunAbandonEvent = z.infer<typeof AuthoringRunAbandonEventSchema>

interface AuthoringRunRecord {
  start: AuthoringRunStartEvent
  finish: AuthoringRunFinishEvent
}

interface AuthoringRunLogState {
  starts: AuthoringRunStartEvent[]
  records: AuthoringRunRecord[]
  pending: AuthoringRunStartEvent[]
  abandoned: AuthoringRunAbandonEvent[]
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeDevelopmentPluginLocator(locator: string): string {
  return locator.replace(DevelopmentPluginCacheVersionPattern, '$1<generated-version>$2')
}

function comparisonSkillLocator(name: string, locator: string): string {
  return name.startsWith('tempad-dev-dev:') ? normalizeDevelopmentPluginLocator(locator) : locator
}

function hasSameComparisonSkillContext(
  first: AuthoringRunRollout['skills'],
  second: AuthoringRunRollout['skills']
): boolean {
  if (!first || !second) return first === second
  if (first.contextFingerprint === second.contextFingerprint) return true
  return (
    first.catalogFingerprint === second.catalogFingerprint &&
    first.authoringSkillLocator !== null &&
    second.authoringSkillLocator !== null &&
    normalizeDevelopmentPluginLocator(first.authoringSkillLocator) ===
      normalizeDevelopmentPluginLocator(second.authoringSkillLocator)
  )
}

function promptFingerprint(prompt: string): string {
  return sha256(prompt.trim().replaceAll(/\s+/g, ' '))
}

export function fingerprintRunNote(noteInput: unknown): string {
  return sha256(JSON.stringify(AuthoringRunNoteSchema.parse(noteInput)))
}

function validatePreflight(input: unknown): asserts input is AuthoringPreflightResult {
  if (!input || typeof input !== 'object') throw new Error('Run start has no preflight evidence.')
  const preflight = input as Partial<AuthoringPreflightResult>
  const extension = preflight.runtime?.extension
  const plugin = preflight.plugin
  if (
    preflight.valid !== true ||
    !Array.isArray(preflight.issues) ||
    preflight.issues.length > 0 ||
    typeof preflight.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(preflight.checkedAt)) ||
    typeof preflight.checkout !== 'string' ||
    !extension ||
    !Sha256Schema.safeParse(extension.checkoutFingerprint).success ||
    !plugin ||
    typeof plugin.generatedVersion !== 'string' ||
    !plugin.generatedVersion
  ) {
    throw new Error('Run start requires one successful current-checkout preflight.')
  }
}

export function buildStartEvent(
  noteInput: unknown,
  preflightInput: unknown,
  recordedAt = new Date().toISOString()
): AuthoringRunStartEvent {
  const note = AuthoringRunNoteSchema.parse(noteInput)
  validatePreflight(preflightInput)
  const event = AuthoringRunStartEventSchema.parse({
    schemaVersion: 1,
    type: 'start',
    recordedAt,
    noteSha256: fingerprintRunNote(note),
    note,
    preflight: preflightInput
  })
  if (Date.parse(note.createdAt) > Date.parse(event.recordedAt)) {
    throw new Error('Run note cannot be created after its start event.')
  }
  if (Date.parse(preflightInput.checkedAt) > Date.parse(event.recordedAt)) {
    throw new Error('Run start cannot precede its preflight.')
  }
  return event
}

export function validateFreshRunPrompt(
  noteInput: AuthoringRunNote,
  priorStarts: AuthoringRunStartEvent[]
): void {
  const note = AuthoringRunNoteSchema.parse(noteInput)
  const duplicate = priorStarts.find(({ note: prior }) => {
    if (promptFingerprint(prior.task.prompt) !== promptFingerprint(note.task.prompt)) return false
    return !(
      note.kind === 'comparison' &&
      prior.kind === 'comparison' &&
      note.comparison?.id === prior.comparison?.id &&
      note.comparison?.arm !== prior.comparison?.arm
    )
  })
  if (duplicate) {
    throw new Error(
      `Live prompt duplicates prior run ${duplicate.note.id}; write a fresh realistic task.`
    )
  }
}

function buildRolloutEvidence(
  input?: {
    source: string
    text: string
  },
  inspectionInput?: ReturnType<typeof inspectAuthoringRollout>
): AuthoringRunRollout | null {
  if (!input) return null
  const inspection = inspectionInput ?? inspectAuthoringRollout(input.text)
  const catalog = (() => {
    try {
      return fingerprintSkillCatalog(extractSkillCatalog(input.text))
    } catch {
      return null
    }
  })()
  const authoringSkill = catalog?.skills.find(
    ({ name }) => name === 'tempad-dev-dev:figma-canvas-authoring'
  )
  return {
    source: basename(input.source),
    sha256: sha256(input.text),
    startedAt: inspection.timing.rolloutStartedAt,
    promptSha256: inspection.prompt.sha256,
    runtime: {
      locked: inspection.runtime.locked,
      valid: inspection.runtime.valid,
      hubFingerprint:
        inspection.runtime.hubFingerprints.length === 1
          ? (inspection.runtime.hubFingerprints[0] ?? null)
          : null,
      extensionFingerprint:
        inspection.runtime.extensionFingerprints.length === 1
          ? (inspection.runtime.extensionFingerprints[0] ?? null)
          : null
    },
    skills: catalog
      ? {
          catalogFingerprint: catalog.catalogFingerprint,
          runtimeFingerprint: catalog.runtimeFingerprint,
          contextFingerprint: sha256(
            JSON.stringify(
              catalog.skills
                .filter(({ name }) => name !== 'tempad-dev-dev:figma-canvas-authoring')
                .map(({ name, description, locatorKind, locator }) => ({
                  name,
                  description,
                  locatorKind,
                  locator: comparisonSkillLocator(name, locator)
                }))
            )
          ),
          authoringSkillLocator: authoringSkill?.locator ?? null
        }
      : null
  }
}

const crossTaskDispatchTools = new Set([
  'codex_app.create_thread',
  'codex_app.fork_thread',
  'codex_app.handoff_thread',
  'codex_app.send_message_to_thread'
])

function crossTaskDispatch(
  inspection: ReturnType<typeof inspectAuthoringRollout>
): string | undefined {
  return Object.keys(inspection.tools.byName).find((name) => crossTaskDispatchTools.has(name))
}

function validatesExpectedTempadSkill(
  start: AuthoringRunStartEvent,
  locator: string | null | undefined
): boolean {
  const version = start.preflight.plugin.generatedVersion
  return Boolean(
    locator
      ?.replaceAll('\\', '/')
      .includes(`/tempad-dev-dev/${version}/skills/figma-canvas-authoring/SKILL.md`)
  )
}

export function validateRunRecord(record: AuthoringRunRecord): void {
  const start = record.start
  const finish = record.finish
  validatePreflight(start.preflight)
  if (finish.noteId !== start.note.id || finish.review.noteId !== start.note.id) {
    throw new Error('Run finish does not match its start note.')
  }
  if (
    finish.noteSha256 !== start.noteSha256 ||
    fingerprintRunNote(start.note) !== start.noteSha256
  ) {
    throw new Error('Run note changed after start.')
  }
  if (Date.parse(finish.recordedAt) < Date.parse(start.recordedAt)) {
    throw new Error('Run finish predates its start.')
  }
  if (finish.review.status === 'invalid') return
  if (!finish.rollout) throw new Error('A valid live run requires rollout evidence.')
  const rolloutStartedAt = finish.rollout.startedAt
  if (!rolloutStartedAt || Date.parse(rolloutStartedAt) < Date.parse(start.recordedAt)) {
    throw new Error('A valid rollout must start after the run note is frozen.')
  }
  if (finish.rollout.promptSha256 !== promptFingerprint(start.note.task.prompt)) {
    throw new Error('Rollout prompt does not match the frozen live task.')
  }
  const runtime = finish.rollout.runtime
  if (!runtime.locked || !runtime.valid) {
    throw new Error('A valid live run requires locked runtime evidence from the rollout.')
  }
  const expectedExtension = start.preflight.runtime.extension.checkoutFingerprint
  if (runtime.extensionFingerprint !== expectedExtension) {
    throw new Error('Rollout extension runtime differs from the successful preflight checkout.')
  }
  if (!validatesExpectedTempadSkill(start, finish.rollout.skills?.authoringSkillLocator)) {
    throw new Error('Rollout did not load the TemPad authoring skill verified at run start.')
  }
  const artifacts = finish.review.artifacts
  if (
    !artifacts.taskId ||
    !artifacts.pageId ||
    !artifacts.pageName ||
    artifacts.evidence.length === 0
  ) {
    throw new Error('A valid live review must retain task, page, and reviewable artifact evidence.')
  }
  if (start.note.task.expectedPageName && artifacts.pageName !== start.note.task.expectedPageName) {
    throw new Error('Reviewed page name differs from the frozen live task.')
  }
}

export function buildFinishEvent(
  start: AuthoringRunStartEvent,
  reviewInput: unknown,
  rolloutInput?: { source: string; text: string },
  recordedAt = new Date().toISOString()
): AuthoringRunFinishEvent {
  const review = AuthoringRunReviewDraftSchema.parse(reviewInput)
  const inspection = rolloutInput ? inspectAuthoringRollout(rolloutInput.text) : undefined
  const dispatch = inspection && crossTaskDispatch(inspection)
  if (review.status === 'valid' && dispatch) {
    throw new Error(`A valid live run cannot dispatch work through ${dispatch}.`)
  }
  const event = AuthoringRunFinishEventSchema.parse({
    schemaVersion: 1,
    type: 'finish',
    recordedAt,
    noteId: start.note.id,
    noteSha256: start.noteSha256,
    review,
    rollout: buildRolloutEvidence(rolloutInput, inspection)
  })
  validateRunRecord({ start, finish: event })
  return event
}

export function buildAbandonEvent(
  noteId: string,
  reason: string,
  recordedAt = new Date().toISOString()
): AuthoringRunAbandonEvent {
  return AuthoringRunAbandonEventSchema.parse({
    schemaVersion: 1,
    type: 'abandon',
    recordedAt,
    noteId,
    reason
  })
}

function parseStartEvent(input: unknown): AuthoringRunStartEvent {
  const event = AuthoringRunStartEventSchema.parse(input)
  validatePreflight(event.preflight)
  if (fingerprintRunNote(event.note) !== event.noteSha256) {
    throw new Error(`Run note hash mismatch for ${event.note.id}.`)
  }
  if (Date.parse(event.note.createdAt) > Date.parse(event.recordedAt)) {
    throw new Error(`Run note ${event.note.id} was created after its start event.`)
  }
  return event
}

function parseFinishEvent(input: unknown): AuthoringRunFinishEvent {
  return AuthoringRunFinishEventSchema.parse(input)
}

export function validateComparisonRecords(records: AuthoringRunRecord[]): void {
  const groups = new Map<string, AuthoringRunRecord[]>()
  for (const record of records) {
    const comparison = record.start.note.comparison
    if (!comparison) continue
    groups.set(comparison.id, [...(groups.get(comparison.id) ?? []), record])
  }
  for (const [id, group] of groups) {
    const arms = group.map(({ start }) => start.note.comparison!.arm)
    if (new Set(arms).size !== arms.length) {
      throw new Error(`Comparison ${id} contains a duplicate arm.`)
    }
    if (group.length < 2 || group.some(({ finish }) => finish.review.status === 'invalid')) continue
    const [first, second] = group
    if (!first || !second) continue
    if (
      first.start.note.task.prompt !== second.start.note.task.prompt ||
      first.start.note.comparison?.subject !== second.start.note.comparison?.subject
    ) {
      throw new Error(`Comparison ${id} changed its prompt or subject between arms.`)
    }
    const firstRollout = first.finish.rollout
    const secondRollout = second.finish.rollout
    if (
      !firstRollout ||
      !secondRollout ||
      firstRollout.runtime.hubFingerprint !== secondRollout.runtime.hubFingerprint ||
      firstRollout.runtime.extensionFingerprint !== secondRollout.runtime.extensionFingerprint ||
      !hasSameComparisonSkillContext(firstRollout.skills, secondRollout.skills)
    ) {
      throw new Error(`Comparison ${id} changed its supporting context or runtime.`)
    }
  }
}

export function parseRunLogState(input: string): AuthoringRunLogState {
  const starts: AuthoringRunStartEvent[] = []
  const pending = new Map<string, AuthoringRunStartEvent>()
  const records: AuthoringRunRecord[] = []
  const abandoned: AuthoringRunAbandonEvent[] = []

  for (const [index, line] of input.split('\n').entries()) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch (error) {
      throw new Error(`Invalid run-log JSON on line ${String(index + 1)}: ${String(error)}`, {
        cause: error
      })
    }
    if (!value || typeof value !== 'object' || !('type' in value)) {
      throw new Error(`Unknown run-log event on line ${String(index + 1)}.`)
    }
    if (value.type === 'start') {
      const event = parseStartEvent(value)
      if (starts.some(({ note }) => note.id === event.note.id)) {
        throw new Error(`Duplicate run note id: ${event.note.id}.`)
      }
      validateFreshRunPrompt(event.note, starts)
      starts.push(event)
      pending.set(event.note.id, event)
      continue
    }
    if (value.type === 'finish') {
      const event = parseFinishEvent(value)
      const start = pending.get(event.noteId)
      if (!start) throw new Error(`Run finish has no pending note ${event.noteId}.`)
      const record = { start, finish: event }
      validateRunRecord(record)
      pending.delete(event.noteId)
      records.push(record)
      continue
    }
    if (value.type === 'abandon') {
      const event = AuthoringRunAbandonEventSchema.parse(value)
      const start = pending.get(event.noteId)
      if (!start) throw new Error(`Run abandonment has no pending note ${event.noteId}.`)
      if (Date.parse(event.recordedAt) < Date.parse(start.recordedAt)) {
        throw new Error(`Run abandonment predates note ${event.noteId}.`)
      }
      pending.delete(event.noteId)
      abandoned.push(event)
      continue
    }
    throw new Error(`Unknown run-log event on line ${String(index + 1)}.`)
  }
  validateComparisonRecords(records)
  return { starts, records, pending: [...pending.values()], abandoned }
}

export function summarizeRunLog(state: AuthoringRunLogState) {
  const byKind: Record<string, number> = {}
  for (const { start } of state.records) {
    byKind[start.note.kind] = (byKind[start.note.kind] ?? 0) + 1
  }
  return {
    runs: state.records.length,
    valid: state.records.filter(({ finish }) => finish.review.status === 'valid').length,
    invalid: state.records.filter(({ finish }) => finish.review.status === 'invalid').length,
    pending: state.pending.length,
    abandoned: state.abandoned.length,
    byKind
  }
}

export function resolveRunLogPath(path: string): string {
  return isAbsolute(path) ? path : join(repositoryRoot, path)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolveRunLogPath(path), 'utf8')) as unknown
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value) throw new Error(`${name} requires a value.`)
  return value
}

function usage(): string {
  return [
    'Record live authoring evidence without turning the log into a rubric:',
    '',
    '  pnpm agent-eval:log start --note <note.json> --log <runs.jsonl> [--checkout <path>]',
    '  pnpm agent-eval:log finish --note-id <id> --review <review.json> --log <runs.jsonl> [--rollout <rollout.jsonl>]',
    '  pnpm agent-eval:log abandon --note-id <id> --reason <text> --log <runs.jsonl>',
    '  pnpm agent-eval:log check <runs.jsonl>',
    '  pnpm agent-eval:log summary <runs.jsonl>'
  ].join('\n')
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (command === 'start') {
    const notePath = flag(args, '--note')
    const logPath = flag(args, '--log')
    const checkout = flag(args, '--checkout') ?? repositoryRoot
    if (!notePath || !logPath) throw new Error(usage())
    const resolvedLog = resolveRunLogPath(logPath)
    const existingText = existsSync(resolvedLog) ? readFileSync(resolvedLog, 'utf8') : ''
    const state = parseRunLogState(existingText)
    const note = AuthoringRunNoteSchema.parse(readJson(notePath))
    validateFreshRunPrompt(note, state.starts)
    const preflight = await runPreflight({ checkout: resolveRunLogPath(checkout) })
    if (!preflight.valid) {
      throw new Error(
        `Runtime preflight failed:\n${preflight.issues.map(({ code, message }) => `- ${code}: ${message}`).join('\n')}`
      )
    }
    const event = buildStartEvent(note, preflight)
    parseRunLogState(`${existingText}${JSON.stringify(event)}\n`)
    appendFileSync(resolvedLog, `${JSON.stringify(event)}\n`)
    process.stdout.write(
      `${JSON.stringify({ started: note.id, recordedAt: event.recordedAt }, null, 2)}\n`
    )
    return
  }
  if (command === 'finish') {
    const noteId = flag(args, '--note-id')
    const reviewPath = flag(args, '--review')
    const logPath = flag(args, '--log')
    const rolloutPath = flag(args, '--rollout')
    if (!noteId || !reviewPath || !logPath) throw new Error(usage())
    const resolvedLog = resolveRunLogPath(logPath)
    if (!existsSync(resolvedLog)) throw new Error('Run log does not exist.')
    const existingText = readFileSync(resolvedLog, 'utf8')
    const state = parseRunLogState(existingText)
    const start = state.pending.find(({ note }) => note.id === noteId)
    if (!start) throw new Error(`No pending run note ${noteId}.`)
    const resolvedRollout = rolloutPath ? resolveRunLogPath(rolloutPath) : undefined
    const event = buildFinishEvent(
      start,
      readJson(reviewPath),
      resolvedRollout
        ? { source: resolvedRollout, text: readFileSync(resolvedRollout, 'utf8') }
        : undefined
    )
    parseRunLogState(`${existingText}${JSON.stringify(event)}\n`)
    appendFileSync(resolvedLog, `${JSON.stringify(event)}\n`)
    process.stdout.write(
      `${JSON.stringify({ finished: noteId, status: event.review.status }, null, 2)}\n`
    )
    return
  }
  if (command === 'abandon') {
    const noteId = flag(args, '--note-id')
    const reason = flag(args, '--reason')
    const logPath = flag(args, '--log')
    if (!noteId || !reason || !logPath) throw new Error(usage())
    const resolvedLog = resolveRunLogPath(logPath)
    if (!existsSync(resolvedLog)) throw new Error('Run log does not exist.')
    const existingText = readFileSync(resolvedLog, 'utf8')
    const state = parseRunLogState(existingText)
    if (!state.pending.some(({ note }) => note.id === noteId)) {
      throw new Error(`No pending run note ${noteId}.`)
    }
    const event = buildAbandonEvent(noteId, reason)
    parseRunLogState(`${existingText}${JSON.stringify(event)}\n`)
    appendFileSync(resolvedLog, `${JSON.stringify(event)}\n`)
    process.stdout.write(`${JSON.stringify({ abandoned: noteId }, null, 2)}\n`)
    return
  }
  const logPath = args[0]
  if ((command === 'check' || command === 'summary') && logPath) {
    const state = parseRunLogState(readFileSync(resolveRunLogPath(logPath), 'utf8'))
    const result =
      command === 'summary' ? summarizeRunLog(state) : { ok: true, ...summarizeRunLog(state) }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error(usage())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
