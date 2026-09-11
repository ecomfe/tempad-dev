import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { inspectAgentRunIdentity } from './inspect-agent-run-identity'

interface NodeLimitAttempt {
  limit: number
  dataKeyCount: number
  markupCharacters: number
}

interface AuthoringRolloutInspection {
  execution: ReturnType<typeof inspectAgentRunIdentity>
  prompt: {
    text: string | null
    sha256: string | null
    wordCount: number
    characterCount: number
  }
  tools: {
    completedCalls: number
    failures: number
    byName: Record<string, number>
  }
  skillContext: {
    readCalls: number
    uniqueResources: string[]
  }
  applyCanvas: {
    calls: number
    failures: number
    failureCodes: Record<string, number>
    nodeLimitAttempts: NodeLimitAttempt[]
    maxMarkupCharacters: number
    maxDataKeyCount: number
  }
  research: {
    webCalls: number
    imageQueryCalls: number
    openedSourceCalls: number
    browserScreenshotCalls: number
  }
  imageViews: {
    total: number
    references: number
    tempadScreenshots: number
    other: number
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
  timing: {
    rolloutStartedAt: string | null
    finalResponseAt: string | null
    totalWallClockMs: number | null
    firstToolCallMs: number | null
    firstApplyAttemptMs: number | null
    firstSuccessfulApplyMs: number | null
    firstResearchCallMs: number | null
    lastResearchCallMs: number | null
    firstOpenedTempadScreenshotMs: number | null
    lastOpenedTempadScreenshotMs: number | null
    firstApplyToOpenedScreenshotMs: number | null
    lastSuccessfulApplyMs: number | null
    lastApplyToOpenedScreenshotMs: number | null
    finalizationAfterLastApplyMs: number | null
    observedToolBusyMs: number | null
    nonToolWallClockMs: number | null
  }
  runtime: {
    observations: number
    locked: boolean
    valid: boolean
    hubFingerprints: string[]
    extensionFingerprints: string[]
    issues: string[]
  }
  limitations: string[]
}

interface ApplyEvent {
  arguments: unknown
  result: unknown
  status: unknown
  timestampMs: number | null
}

interface TimedInterval {
  startMs: number
  endMs: number
}

interface CustomCallEvent {
  input: string
  name: string
  timestampMs: number | null
}

interface CompletedToolEvent {
  failed: boolean
  name: string
  timestampMs: number | null
}

interface RuntimeObservation {
  locked: boolean
  valid: boolean
  hubFingerprint: string | null
  extensionFingerprint: string | null
  issues: string[]
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

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function elapsedMs(startMs: number | null, endMs: number | null): number | null {
  if (startMs === null || endMs === null || endMs < startMs) return null
  return endMs - startMs
}

function toolBusyMs(intervals: TimedInterval[], startMs: number, endMs: number): number {
  const clipped = intervals
    .map((interval) => ({
      startMs: Math.max(startMs, interval.startMs),
      endMs: Math.min(endMs, interval.endMs)
    }))
    .filter((interval) => interval.endMs >= interval.startMs)
    .sort((a, b) => a.startMs - b.startMs)

  let total = 0
  let activeStart: number | null = null
  let activeEnd: number | null = null
  for (const interval of clipped) {
    if (activeStart === null || activeEnd === null) {
      activeStart = interval.startMs
      activeEnd = interval.endMs
      continue
    }
    if (interval.startMs <= activeEnd) {
      activeEnd = Math.max(activeEnd, interval.endMs)
      continue
    }
    total += activeEnd - activeStart
    activeStart = interval.startMs
    activeEnd = interval.endMs
  }
  if (activeStart !== null && activeEnd !== null) total += activeEnd - activeStart
  return total
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
        status: get(item, 'status'),
        timestampMs: timestampMs(get(row, 'timestamp'))
      }
    ]
  })
}

function customCallEvents(parsedRows: unknown[]): CustomCallEvent[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'response_item') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'custom_tool_call') return []
    return [
      {
        input: stringify(get(payload, 'input')),
        name: typeof get(payload, 'name') === 'string' ? String(get(payload, 'name')) : '<unknown>',
        timestampMs: timestampMs(get(row, 'timestamp'))
      }
    ]
  })
}

function functionCallEvents(parsedRows: unknown[]): CustomCallEvent[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'response_item') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'function_call') return []
    return [
      {
        input: stringify(get(payload, 'arguments')),
        name: typeof get(payload, 'name') === 'string' ? String(get(payload, 'name')) : '<unknown>',
        timestampMs: timestampMs(get(row, 'timestamp'))
      }
    ]
  })
}

function commandExecutionInputs(parsedRows: unknown[]): string[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'event_msg') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'item_completed') return []
    const item = get(payload, 'item')
    if (get(item, 'type') !== 'CommandExecution' || get(item, 'status') === 'failed') return []
    const command = get(item, 'command')
    if (typeof command === 'string') return [command]
    if (!Array.isArray(command)) return []
    return [command.map(stringify).join(' ')]
  })
}

function itemToolName(item: unknown): string | null {
  const type = get(item, 'type')
  if (type === 'McpToolCall') {
    const server = get(item, 'server')
    const tool = get(item, 'tool')
    return typeof tool === 'string'
      ? `${typeof server === 'string' ? `${server}.` : ''}${tool}`
      : null
  }
  if (type === 'ImageView') return 'view_image'
  if (type === 'CommandExecution') return 'exec_command'
  if (type === 'Extension') {
    const name = get(item, 'name') ?? get(item, 'tool')
    return typeof name === 'string' ? name : 'extension'
  }
  return null
}

function completedToolEvents(parsedRows: unknown[]): CompletedToolEvent[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'event_msg') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'item_completed') return []
    const item = get(payload, 'item')
    const name = itemToolName(item)
    if (!name) return []
    return [
      {
        name,
        failed: get(item, 'status') === 'failed' || get(get(item, 'result'), 'isError') === true,
        timestampMs: timestampMs(get(row, 'timestamp'))
      }
    ]
  })
}

function messageText(row: unknown): { role: string | null; text: string } | null {
  if (get(row, 'type') !== 'response_item') return null
  const payload = get(row, 'payload')
  if (get(payload, 'type') !== 'message') return null
  const content = get(payload, 'content')
  if (!Array.isArray(content)) return null
  return {
    role: typeof get(payload, 'role') === 'string' ? String(get(payload, 'role')) : null,
    text: content
      .map((item) => (typeof get(item, 'text') === 'string' ? String(get(item, 'text')) : ''))
      .join('\n')
  }
}

function createThreadOutputText(row: unknown): string | null {
  if (get(row, 'type') !== 'response_item') return null
  const payload = get(row, 'payload')
  if (
    get(payload, 'type') !== 'function_call_output' ||
    get(payload, 'namespace') !== 'codex_app' ||
    get(payload, 'name') !== 'create_thread'
  ) {
    return null
  }
  const output = get(payload, 'output')
  return typeof output === 'string' ? output : null
}

function normalizePrompt(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ')
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const point = code.toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10)
      try {
        return String.fromCodePoint(point)
      } catch {
        return entity
      }
    })
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function extractPrompt(parsedRows: unknown[]): string | null {
  const messages = parsedRows.flatMap((row) => {
    const message = messageText(row)
    return message ? [message] : []
  })
  const delegatedTexts = [
    ...messages.map(({ text }) => text),
    ...parsedRows.flatMap((row) => {
      const output = createThreadOutputText(row)
      return output ? [output] : []
    })
  ]
  for (const text of delegatedTexts) {
    const delegated = text.match(/<codex_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>/)
    if (delegated?.[1]) return normalizePrompt(decodeXmlText(delegated[1]))
  }
  const userMessages = messages
    .filter(
      ({ role, text }) =>
        role === 'user' && !/<recommended_plugins>|<environment_context>/.test(text)
    )
    .map(({ text }) => normalizePrompt(text))
    .filter(Boolean)
  return userMessages.at(-1) ?? null
}

function skillResources(input: string): string[] {
  const normalized = input.replaceAll('\\/', '/').replaceAll('\\\\', '/')
  const expanded = normalized.replace(
    /(\/skills\/[^/"'\s]+\/references\/)\{([^{}]+)\}/g,
    (_match, prefix: string, resources: string) =>
      resources
        .split(',')
        .map((resource) => `${prefix}${resource}`)
        .join(' ')
  )
  return [
    ...expanded.matchAll(/\/skills\/([^/"'\s]+)\/(SKILL\.md|references\/[^"'\s),{}]+\.md)/g)
  ].flatMap((match) => (match[1] && match[2] ? [`${match[1]}/${match[2]}`] : []))
}

function runtimeObservation(value: unknown, seen = new Set<unknown>()): RuntimeObservation | null {
  const trimmedValue = typeof value === 'string' ? value.trimStart() : ''
  if (trimmedValue.startsWith('{') || trimmedValue.startsWith('[')) {
    try {
      return runtimeObservation(JSON.parse(trimmedValue), seen)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  const locked = get(value, 'locked')
  const valid = get(value, 'valid')
  const hub = get(value, 'hub')
  const extension = get(value, 'extension')
  if (typeof locked === 'boolean' && typeof valid === 'boolean' && hub && extension) {
    const hubFingerprint = get(hub, 'runtimeFingerprint')
    const extensionFingerprint = get(extension, 'runtimeFingerprint')
    const issues = get(value, 'issues')
    return {
      locked,
      valid,
      hubFingerprint: typeof hubFingerprint === 'string' ? hubFingerprint : null,
      extensionFingerprint: typeof extensionFingerprint === 'string' ? extensionFingerprint : null,
      issues: Array.isArray(issues)
        ? issues.filter((issue): issue is string => typeof issue === 'string')
        : []
    }
  }
  for (const nested of Object.values(value)) {
    const observation = runtimeObservation(nested, seen)
    if (observation) return observation
  }
  return null
}

function imageViewPaths(parsedRows: unknown[]): string[] {
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'event_msg') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'item_completed') return []
    const item = get(payload, 'item')
    if (get(item, 'type') !== 'ImageView') return []
    const path = get(item, 'path')
    return typeof path === 'string' ? [path] : []
  })
}

function itemTimestampMs(row: unknown, itemType: string): number | null {
  if (get(row, 'type') !== 'event_msg') return null
  const payload = get(row, 'payload')
  if (get(payload, 'type') !== 'item_completed') return null
  const item = get(payload, 'item')
  if (get(item, 'type') !== itemType) return null
  return timestampMs(get(row, 'timestamp'))
}

function completedToolIntervals(parsedRows: unknown[]): TimedInterval[] {
  const toolItemTypes = new Set(['CommandExecution', 'Extension', 'ImageView', 'McpToolCall'])
  return parsedRows.flatMap((row) => {
    if (get(row, 'type') !== 'event_msg') return []
    const payload = get(row, 'payload')
    if (get(payload, 'type') !== 'item_completed') return []
    const item = get(payload, 'item')
    if (!toolItemTypes.has(String(get(item, 'type')))) return []
    const startMs = get(payload, 'started_at_ms')
    const endMs = get(payload, 'completed_at_ms')
    if (
      typeof startMs !== 'number' ||
      typeof endMs !== 'number' ||
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs < startMs
    ) {
      return []
    }
    return [{ startMs, endMs }]
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
  const customCalls = customCallEvents(parsedRows)
  const callEvents = [...customCalls, ...functionCallEvents(parsedRows)]
  const callInputs = callEvents.map(({ input }) => input)
  const commandInputs = commandExecutionInputs(parsedRows)
  const completedTools = completedToolEvents(parsedRows)
  const viewedImages = imageViewPaths(parsedRows)
  const applyPayloads = applies.map((event) => stringify(event.arguments))
  const failureCodes: Record<string, number> = {}
  const nodeLimitAttempts: NodeLimitAttempt[] = []
  const domains = new Set<string>()
  const iconLibraries = new Set<string>()
  const rowTimestamps = parsedRows
    .map((row) => timestampMs(get(row, 'timestamp')))
    .filter((value): value is number => value !== null)
  const rolloutStartedMs = rowTimestamps.length ? Math.min(...rowTimestamps) : null
  const prompt = extractPrompt(parsedRows)
  const finalResponseMs = parsedRows.reduce<number | null>((latest, row) => {
    const value = itemTimestampMs(row, 'AgentMessage')
    return value === null || (latest !== null && value <= latest) ? latest : value
  }, null)
  const successfulApplyTimestamps = applies
    .filter((event) => event.status === 'completed' && get(event.result, 'isError') !== true)
    .map((event) => event.timestampMs)
    .filter((value): value is number => value !== null)
  const firstSuccessfulApplyAt = successfulApplyTimestamps.length
    ? Math.min(...successfulApplyTimestamps)
    : null
  const applyAttemptTimestamps = applies
    .map((event) => event.timestampMs)
    .filter((value): value is number => value !== null)
  const firstApplyAttemptAt = applyAttemptTimestamps.length
    ? Math.min(...applyAttemptTimestamps)
    : null
  const completedToolTimestamps = completedTools
    .map(({ timestampMs: value }) => value)
    .filter((value): value is number => value !== null)
  const firstToolTimestamps = [
    ...completedToolTimestamps,
    ...callEvents
      .map(({ timestampMs: value }) => value)
      .filter((value): value is number => value !== null)
  ]
  const researchTimestamps = callEvents
    .filter(({ input, name }) =>
      /web__run|image_query|createBrowserTab|\.goto\s*\(|\.(?:getScreenshot|getAXStateAndScreenshot|screenshot)\s*\(|\bopen\s*:/i.test(
        `${name}\n${input}`
      )
    )
    .map(({ timestampMs: value }) => value)
    .filter((value): value is number => value !== null)
  const lastSuccessfulApplyAt = successfulApplyTimestamps.length
    ? Math.max(...successfulApplyTimestamps)
    : null
  const openedTempadScreenshotTimestamps = parsedRows.flatMap((row) => {
    const value = itemTimestampMs(row, 'ImageView')
    if (value === null) return []
    const payload = get(row, 'payload')
    const path = get(get(payload, 'item'), 'path')
    return typeof path === 'string' && /\/tempad-dev\/assets\//.test(path) ? [value] : []
  })
  const firstOpenedTempadScreenshotAt = openedTempadScreenshotTimestamps.length
    ? Math.min(...openedTempadScreenshotTimestamps)
    : null
  const lastOpenedTempadScreenshotAt = openedTempadScreenshotTimestamps.length
    ? Math.max(...openedTempadScreenshotTimestamps)
    : null
  const firstOpenedTempadScreenshotAfterLastApplyAt =
    lastSuccessfulApplyAt === null
      ? null
      : (openedTempadScreenshotTimestamps.find((value) => value >= lastSuccessfulApplyAt) ?? null)
  const totalWallClockMs = elapsedMs(rolloutStartedMs, finalResponseMs)
  const observedToolBusyMs =
    rolloutStartedMs !== null && finalResponseMs !== null
      ? toolBusyMs(completedToolIntervals(parsedRows), rolloutStartedMs, finalResponseMs)
      : null

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
    for (const match of payload.matchAll(/"imageUrl"\s*:\s*"https?:\\?\/\\?\/([^/\\?"\s]+)/g)) {
      if (match[1]) domains.add(match[1].replaceAll('\\', '').toLowerCase())
    }

    if (/"type"\s*:\s*"COMPONENT"/.test(payload)) authoredComponentCalls += 1
    if (/"component"\s*:\s*\{\s*"(?:id|key)"\s*:/.test(payload)) {
      instanceBindingCalls += 1
    }
  }

  const allCalls = callInputs.join('\n')
  const iconEvidence = [...applyPayloads, ...callInputs].join('\n')
  const referenceImageViews = viewedImages.filter((path) =>
    /\/work\/(?:references|research)\//.test(path)
  ).length
  const tempadScreenshotViews = viewedImages.filter((path) =>
    /\/tempad-dev\/assets\//.test(path)
  ).length
  if (/lucide-icons|lucide-static/i.test(iconEvidence)) iconLibraries.add('Lucide')
  if (/primer\\?\/octicons|@primer\\?\/octicons/i.test(iconEvidence)) iconLibraries.add('Octicons')
  if (/material-design-icons|material-symbols/i.test(iconEvidence)) iconLibraries.add('Material')

  const byName: Record<string, number> = {}
  for (const tool of completedTools) increment(byName, tool.name)
  const executedSkillReads = commandInputs
    .map(skillResources)
    .filter((resources) => resources.length)
  const requestedSkillReads = callInputs.map(skillResources).filter((resources) => resources.length)
  const skillReads = executedSkillReads.length ? executedSkillReads : requestedSkillReads
  const uniqueResources = new Set(skillReads.flat())
  let missingRuntimeEvidence = false
  const runtimeObservations = applies.flatMap((event) => {
    const observation = runtimeObservation(event.result)
    if (!observation && event.status === 'completed' && get(event.result, 'isError') !== true) {
      missingRuntimeEvidence = true
    }
    return observation ? [observation] : []
  })
  const runtimeIssues = new Set(runtimeObservations.flatMap(({ issues }) => issues))
  if (applies.length > 0 && runtimeObservations.length === 0) {
    runtimeIssues.add('No runtime identity evidence was returned by apply_canvas.')
  } else if (missingRuntimeEvidence) {
    runtimeIssues.add('A successful apply_canvas call has no runtime identity evidence.')
  }

  return {
    execution: inspectAgentRunIdentity(rolloutJsonl),
    prompt: {
      text: prompt,
      sha256: prompt ? createHash('sha256').update(prompt).digest('hex') : null,
      wordCount: prompt ? prompt.split(/\s+/).filter(Boolean).length : 0,
      characterCount: prompt?.length ?? 0
    },
    tools: {
      completedCalls: completedTools.length,
      failures: completedTools.filter(({ failed }) => failed).length,
      byName
    },
    skillContext: {
      readCalls: skillReads.length,
      uniqueResources: [...uniqueResources].sort()
    },
    applyCanvas: {
      calls: applies.length,
      failures,
      failureCodes,
      nodeLimitAttempts,
      maxMarkupCharacters: Math.max(0, ...applies.map((event) => markup(event).length)),
      maxDataKeyCount: Math.max(
        0,
        ...applies.map((event) => countMatches(markup(event), /\bdata-key\s*=/g))
      )
    },
    research: {
      webCalls: callInputs.filter((input) => input.includes('web__run')).length,
      imageQueryCalls: callInputs.filter((input) => /\bimage_query\s*:/.test(input)).length,
      openedSourceCalls: callInputs.filter(
        (input) =>
          /\.goto\s*\(/.test(input) ||
          /\bcreateBrowserTab\s*\(/.test(input) ||
          /\bopen\s*:/.test(input)
      ).length,
      browserScreenshotCalls: callInputs.filter((input) =>
        /\.(?:getScreenshot|getAXStateAndScreenshot|screenshot)\s*\(/.test(input)
      ).length
    },
    imageViews: {
      total: viewedImages.length,
      references: referenceImageViews,
      tempadScreenshots: tempadScreenshotViews,
      other: viewedImages.length - referenceImageViews - tempadScreenshotViews
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
    timing: {
      rolloutStartedAt: rolloutStartedMs === null ? null : new Date(rolloutStartedMs).toISOString(),
      finalResponseAt: finalResponseMs === null ? null : new Date(finalResponseMs).toISOString(),
      totalWallClockMs,
      firstToolCallMs: elapsedMs(
        rolloutStartedMs,
        firstToolTimestamps.length ? Math.min(...firstToolTimestamps) : null
      ),
      firstApplyAttemptMs: elapsedMs(rolloutStartedMs, firstApplyAttemptAt),
      firstSuccessfulApplyMs: elapsedMs(rolloutStartedMs, firstSuccessfulApplyAt),
      firstResearchCallMs: elapsedMs(
        rolloutStartedMs,
        researchTimestamps.length ? Math.min(...researchTimestamps) : null
      ),
      lastResearchCallMs: elapsedMs(
        rolloutStartedMs,
        researchTimestamps.length ? Math.max(...researchTimestamps) : null
      ),
      firstOpenedTempadScreenshotMs: elapsedMs(rolloutStartedMs, firstOpenedTempadScreenshotAt),
      lastOpenedTempadScreenshotMs: elapsedMs(rolloutStartedMs, lastOpenedTempadScreenshotAt),
      firstApplyToOpenedScreenshotMs: elapsedMs(
        firstSuccessfulApplyAt,
        firstOpenedTempadScreenshotAt
      ),
      lastSuccessfulApplyMs: elapsedMs(rolloutStartedMs, lastSuccessfulApplyAt),
      lastApplyToOpenedScreenshotMs: elapsedMs(
        lastSuccessfulApplyAt,
        firstOpenedTempadScreenshotAfterLastApplyAt
      ),
      finalizationAfterLastApplyMs: elapsedMs(lastSuccessfulApplyAt, finalResponseMs),
      observedToolBusyMs,
      nonToolWallClockMs:
        totalWallClockMs === null || observedToolBusyMs === null
          ? null
          : Math.max(0, totalWallClockMs - observedToolBusyMs)
    },
    runtime: {
      observations: runtimeObservations.length,
      locked:
        runtimeObservations.length > 0 &&
        runtimeObservations.every((observation) => observation.locked),
      valid:
        runtimeObservations.length > 0 &&
        !missingRuntimeEvidence &&
        runtimeObservations.every((observation) => observation.valid),
      hubFingerprints: [
        ...new Set(runtimeObservations.flatMap(({ hubFingerprint }) => hubFingerprint ?? []))
      ].sort(),
      extensionFingerprints: [
        ...new Set(
          runtimeObservations.flatMap(({ extensionFingerprint }) => extensionFingerprint ?? [])
        )
      ].sort(),
      issues: [...runtimeIssues].sort()
    },
    limitations: [
      'Image-view categories use path heuristics; final-write timing does not prove screenshot capture freshness, target identity, or full-screen coverage.',
      'Trace signals do not prove that researched evidence or acquired assets were retained in the final artifact.',
      'Component counters identify authoring mechanics, not whether the chosen component boundary was semantically correct.',
      'Timing milestones identify trace events, not the first usable design: an apply may be scaffolding and a screenshot may show a component or partial screen. Inspect the opened pixels and record usability separately.',
      'Trace counts do not substitute for evaluator inspection of screenshot pixels and live native structure.'
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
