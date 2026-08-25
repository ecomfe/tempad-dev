import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export interface SkillCatalogEntry {
  name: string
  description: string
  locatorKind: 'file' | 'environment resource' | 'orchestrator package' | 'custom resource'
  locator: string
}

export interface SkillCatalogFingerprint {
  catalogFingerprint: string
  runtimeFingerprint: string
  count: number
  skills: SkillCatalogEntry[]
  tempadSkillPaths: string[]
}

const SKILL_ENTRY_PATTERN =
  /^- ([^\n]+?): (.*) \((file|environment resource|orchestrator package|custom resource): (.+)\)$/gm

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function messageText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const payload = Reflect.get(value, 'payload')
  if (!payload || typeof payload !== 'object' || Reflect.get(payload, 'type') !== 'message') {
    return ''
  }
  const content = Reflect.get(payload, 'content')
  if (!Array.isArray(content)) return ''
  return content
    .map((item) =>
      item && typeof item === 'object' && typeof Reflect.get(item, 'text') === 'string'
        ? String(Reflect.get(item, 'text'))
        : ''
    )
    .join('\n')
}

export function extractSkillCatalog(rolloutJsonl: string): SkillCatalogEntry[] {
  for (const line of rolloutJsonl.split('\n')) {
    if (!line.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const text = messageText(row)
    const start = text.indexOf('<skills_instructions>')
    const end = text.indexOf('</skills_instructions>')
    if (start === -1 || end === -1 || end <= start) continue

    const block = text.slice(start, end)
    const entries: SkillCatalogEntry[] = []
    for (const match of block.matchAll(SKILL_ENTRY_PATTERN)) {
      const [, name, description, locatorKind, locator] = match
      if (!name || !description || !locatorKind || !locator) continue
      entries.push({
        name,
        description,
        locatorKind: locatorKind as SkillCatalogEntry['locatorKind'],
        locator
      })
    }
    if (entries.length) return entries
  }
  throw new Error('No complete <skills_instructions> catalog found in rollout.')
}

export function fingerprintSkillCatalog(skills: SkillCatalogEntry[]): SkillCatalogFingerprint {
  const portable = skills.map(({ name, description }) => ({ name, description }))
  const runtime = skills.map(({ name, description, locatorKind, locator }) => ({
    name,
    description,
    locatorKind,
    locator
  }))
  return {
    catalogFingerprint: hash(portable),
    runtimeFingerprint: hash(runtime),
    count: skills.length,
    skills,
    tempadSkillPaths: skills
      .filter((skill) => skill.name.endsWith(':figma-canvas-authoring'))
      .map((skill) => skill.locator)
  }
}

function parseExpected(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value) throw new Error(`${flag} requires a SHA-256 fingerprint.`)
  return value
}

function main(): void {
  const args = process.argv.slice(2)
  const rolloutPath = args.find((arg) => !arg.startsWith('--'))
  if (!rolloutPath) {
    throw new Error(
      'Usage: inspect-agent-skill-catalog <rollout.jsonl> [--expect-catalog <sha256>] [--expect-runtime <sha256>]'
    )
  }
  const result = fingerprintSkillCatalog(extractSkillCatalog(readFileSync(rolloutPath, 'utf8')))
  const expectedCatalog = parseExpected(args, '--expect-catalog')
  const expectedRuntime = parseExpected(args, '--expect-runtime')

  if (expectedCatalog && result.catalogFingerprint !== expectedCatalog) {
    throw new Error(
      `Skill catalog fingerprint mismatch: expected ${expectedCatalog}, received ${result.catalogFingerprint}.`
    )
  }
  if (expectedRuntime && result.runtimeFingerprint !== expectedRuntime) {
    throw new Error(
      `Skill runtime fingerprint mismatch: expected ${expectedRuntime}, received ${result.runtimeFingerprint}.`
    )
  }

  process.stdout.write(`${JSON.stringify({ rolloutPath, ...result }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
