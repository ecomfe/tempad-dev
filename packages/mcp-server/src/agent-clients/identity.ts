import type { AgentClient } from '@tempad-dev/shared'

import {
  AGENT_CLIENTS,
  AgentClientKindSchema,
  AgentClientSchema,
  DesignTaskIdSchema
} from '@tempad-dev/shared'
import { z } from 'zod'

import type { ClientBinding } from './types'

export const ClientEventSchema = z.object({
  method: z.literal('notifications/tempad/client-event'),
  params: z
    .object({
      event: z.enum([
        'connect',
        'taskBound',
        'Interrupt',
        'Stop',
        'SessionEnd',
        'UserPromptSubmit'
      ]),
      kind: AgentClientKindSchema,
      sessionId: AgentClientSchema.shape.sessionId,
      taskId: DesignTaskIdSchema.optional(),
      turnId: z.string().min(1).max(256).optional()
    })
    .strict()
})

export function runtimeIdentity(env: NodeJS.ProcessEnv): ClientBinding {
  const kind = env.CODEX_APP_TOOLS_PIPE_PATH
    ? 'codex-app'
    : env.CODEX_THREAD_ID || env.CODEX_SESSION_ID
      ? 'codex-cli'
      : env.CLAUDE_CODE
        ? 'claude'
        : 'other'
  return {
    client: clientDescriptor(kind, env.CODEX_THREAD_ID || env.CODEX_SESSION_ID)
  }
}

export function clientDescriptor(kind: AgentClient['kind'], sessionId?: string): AgentClient {
  return { kind, name: AGENT_CLIENTS[kind].name, ...(sessionId ? { sessionId } : {}) }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Read host-supplied MCP metadata, never agent-authored tool arguments. */
export function bindRequestMetadata(binding: ClientBinding, meta: unknown): ClientBinding {
  const source = object(meta)
  let codex = source['x-codex-turn-metadata']
  if (typeof codex === 'string') {
    try {
      codex = JSON.parse(codex)
    } catch {
      codex = undefined
    }
  }
  const metadata = object(codex)
  const sessionId = metadata.thread_id
  const turnId = metadata.turn_id
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) return binding
  // One MCP process can serve multiple conversations: identity is captured per request.
  const next: ClientBinding = {
    ...binding,
    client: clientDescriptor(
      ['other', 'unknown'].includes(binding.client.kind) ? 'codex' : binding.client.kind,
      sessionId
    )
  }
  if (typeof turnId === 'string' && turnId && turnId.length <= 256) next.turnId = turnId
  else if (sessionId !== binding.client.sessionId) delete next.turnId
  return next
}
