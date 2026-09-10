import { createHash } from 'node:crypto'

export interface AgentRunIdentity {
  taskId: string | null
  model: string | null
  reasoningEffort: string | null
  promptCount: number
  promptSha256: string | null
  issues: string[]
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function decodeXml(value: string): string {
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

// Inspect source records, not model prose or tool output claiming an identity.
export function inspectAgentRunIdentity(source: string): AgentRunIdentity {
  const taskIds = new Set<string>()
  const models = new Set<string>()
  const efforts = new Set<string>()
  const prompts: string[] = []
  const delegatedPrompts = new Set<string>()
  const issues = new Set<string>()

  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(line) as unknown
    } catch {
      issues.add(`Invalid rollout JSON on line ${String(index + 1)}.`)
      continue
    }
    const payload = field(row, 'payload')
    if (field(row, 'type') === 'session_meta') {
      for (const key of ['id', 'session_id']) {
        const id = text(field(payload, key))
        if (id) taskIds.add(id)
      }
    }
    if (field(row, 'type') === 'turn_context') {
      const settings = field(field(payload, 'collaboration_mode'), 'settings')
      const model = text(field(payload, 'model'))
      const effort = text(field(payload, 'effort')) ?? text(field(settings, 'reasoning_effort'))
      if (model) models.add(model)
      else issues.add('A turn context has no model identity.')
      if (effort) efforts.add(effort)
      else issues.add('A turn context has no reasoning effort.')
      const settingsModel = text(field(settings, 'model'))
      const settingsEffort = text(field(settings, 'reasoning_effort'))
      if (settingsModel && model && settingsModel !== model) {
        issues.add('Turn model disagrees with collaboration settings.')
      }
      if (settingsEffort && effort && settingsEffort !== effort) {
        issues.add('Turn reasoning effort disagrees with collaboration settings.')
      }
    }
    if (field(row, 'type') !== 'response_item') continue
    if (
      field(payload, 'type') === 'function_call_output' &&
      field(payload, 'name') === 'create_thread' &&
      field(payload, 'namespace') === 'codex_app'
    ) {
      const output = text(field(payload, 'output')) ?? ''
      for (const match of output.matchAll(
        /<codex_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/g
      )) {
        delegatedPrompts.add(decodeXml(match[1]!))
      }
      continue
    }
    if (field(payload, 'type') !== 'message') continue
    const content = field(payload, 'content')
    if (!Array.isArray(content)) continue
    const message = content.map((item) => text(field(item, 'text')) ?? '').join('\n')
    if (field(payload, 'role') === 'developer') {
      // Some native host versions carry the original request in this envelope.
      for (const match of message.matchAll(
        /<codex_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/g
      )) {
        delegatedPrompts.add(decodeXml(match[1]!))
      }
    } else if (field(payload, 'role') === 'user') {
      let remainder = message
        .replaceAll(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/g, '')
        .replaceAll(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
        .trim()
      if (/^# AGENTS\.md instructions(?: for .*)?\n/.test(remainder)) {
        // Preserve any task text following the host-supplied repository block.
        const end = remainder.indexOf('</INSTRUCTIONS>')
        if (end < 0) issues.add('Unrecognized repository instruction envelope.')
        remainder = end < 0 ? '' : remainder.slice(end + '</INSTRUCTIONS>'.length).trim()
      }
      if (remainder) prompts.push(remainder)
      else if (content.some((item) => field(item, 'type') === 'input_image')) {
        issues.add('An additional user image requires intervention review.')
      }
    }
  }

  function single(values: Set<string>, label: string): string | null {
    if (values.size === 1) return [...values][0]!
    issues.add(
      values.size ? `${label} changed within the rollout.` : `No ${label.toLowerCase()} evidence.`
    )
    return null
  }
  const taskId = single(taskIds, 'Task identity')
  const model = single(models, 'Model')
  const reasoningEffort = single(efforts, 'Reasoning effort')
  prompts.unshift(...delegatedPrompts)
  if (prompts.length !== 1) issues.add('A clean run requires exactly one original task prompt.')
  const prompt = prompts[0]?.trim().replaceAll(/\s+/g, ' ')
  return {
    taskId,
    model,
    reasoningEffort,
    promptCount: prompts.length,
    promptSha256: prompt ? createHash('sha256').update(prompt).digest('hex') : null,
    issues: [...issues]
  }
}
