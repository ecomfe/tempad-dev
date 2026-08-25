import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export interface NodeLimitAttempt {
  limit: number
  dataKeyCount: number
  markupCharacters: number
}

export interface AuthoringRolloutInspection {
  applyCanvas: {
    calls: number
    failures: number
    failureCodes: Record<string, number>
    nodeLimitAttempts: NodeLimitAttempt[]
  }
  research: {
    webCalls: number
    imageQueryCalls: number
    openedSourceCalls: number
    browserScreenshotCalls: number
  }
  assets: {
    imageGenerationCalls: number
    appliedRemoteImageDomains: string[]
    iconLibraries: string[]
  }
  components: {
    authoredComponentCalls: number
    instanceBindingCalls: number
  }
  limitations: string[]
}

interface ApplyEvent {
  arguments: unknown
  result: unknown
  status: unknown
}

function rows(rolloutJsonl: string): unknown[] {
  return rolloutJsonl
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        return []
      }
    })
}

function get(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function applyEvents(parsedRows: unknown[]): ApplyEvent[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'event_msg') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'item_completed') return []
    const item = get(payload, 'item')
    if (get(item, 'type') !== 'McpToolCall' || get(item, 'tool') !== 'apply_canvas') return []
    return [
      {
        arguments: get(item, 'arguments'),
        result: get(item, 'result'),
        status: get(item, 'status')
      }
    ]
  })
}

function customCallInputs(parsedRows: unknown[]): string[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'response_item') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'custom_tool_call') return []
    return [stringify(get(payload, 'input'))]
  })
}

function resultText(event: ApplyEvent): string {
  return stringify(event.result)
}

function markup(event: ApplyEvent): string {
  const value = get(event.arguments, 'markup')
  return typeof value === 'string' ? value : ''
}

export function inspectAuthoringRollout(rolloutJsonl: string): AuthoringRolloutInspection {
  const parsedRows = rows(rolloutJsonl)
  const applies = applyEvents(parsedRows)
  const callInputs = customCallInputs(parsedRows)
  const applyPayloads = applies.map((event) => stringify(event.arguments))
  const failureCodes: Record<string, number> = {}
  const nodeLimitAttempts: NodeLimitAttempt[] = []
  const domains = new Set<string>()
  const iconLibraries = new Set<string>()

  let failures = 0
  let authoredComponentCalls = 0
  let instanceBindingCalls = 0

  for (const event of applies) {
    const output = resultText(event)
    const failed = event.status === 'failed' || get(event.result, 'isError') === true
    if (failed) failures += 1
    const failureCode = output.match(/failed \[([A-Z][A-Z0-9_]*)\]/)?.[1]
    if (failureCode) increment(failureCodes, failureCode)

    const limit = output.match(/more than (\d+) elements/i)?.[1]
    if (limit) {
      const value = markup(event)
      nodeLimitAttempts.push({
        limit: Number(limit),
        dataKeyCount: countMatches(value, /\bdata-key\s*=/g),
        markupCharacters: value.length
      })
    }

    const payload = stringify(event.arguments)
    for (const match of payload.matchAll(/https?:\\?\/\\?\/([^/\\?"\s]+)/g)) {
      if (match[1]) domains.add(match[1].replaceAll('\\', '').toLowerCase())
    }

    if (/"type"\s*:\s*"COMPONENT"/.test(payload)) authoredComponentCalls += 1
    if (/"component"\s*:\s*\{\s*"(?:id|key)"\s*:/.test(payload)) {
      instanceBindingCalls += 1
    }
  }

  const allCalls = callInputs.join('\n')
  const iconEvidence = [...applyPayloads, ...callInputs].join('\n')
  if (/lucide-icons|lucide-static/i.test(iconEvidence)) iconLibraries.add('Lucide')
  if (/primer\\?\/octicons|@primer\\?\/octicons/i.test(iconEvidence)) iconLibraries.add('Octicons')
  if (/material-design-icons|material-symbols/i.test(iconEvidence)) iconLibraries.add('Material')

  return {
    applyCanvas: {
      calls: applies.length,
      failures,
      failureCodes,
      nodeLimitAttempts
    },
    research: {
      webCalls: callInputs.filter((input) => input.includes('web__run')).length,
      imageQueryCalls: callInputs.filter((input) => /\bimage_query\s*:/.test(input)).length,
      openedSourceCalls: callInputs.filter(
        (input) => /\.goto\s*\(/.test(input) || /\bopen\s*:/.test(input)
      ).length,
      browserScreenshotCalls: callInputs.filter((input) => /\.screenshot\s*\(/.test(input)).length
    },
    assets: {
      imageGenerationCalls: countMatches(allCalls, /image_gen__imagegen/g),
      appliedRemoteImageDomains: [...domains].sort(),
      iconLibraries: [...iconLibraries].sort()
    },
    components: {
      authoredComponentCalls,
      instanceBindingCalls
    },
    limitations: [
      'Trace signals do not prove that researched evidence or acquired assets were retained in the final artifact.',
      'Component counters identify authoring mechanics, not whether the chosen component boundary was semantically correct.',
      'Screenshot pixels and live native structure still require direct inspection.'
    ]
  }
}

function main(): void {
  const rolloutPaths = process.argv.slice(2)
  if (!rolloutPaths.length) {
    throw new Error('Usage: inspect-agent-authoring-rollout <rollout.jsonl> [...]')
  }
  const results = rolloutPaths.map((rolloutPath) => ({
    rolloutPath,
    ...inspectAuthoringRollout(readFileSync(rolloutPath, 'utf8'))
  }))
  process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
