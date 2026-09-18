import type { AgentCapabilities, AgentClient } from '@tempad-dev/shared'

import { AGENT_CLIENTS } from '@tempad-dev/shared'

export type ClientBinding = {
  client: AgentClient
  turnId?: string
}

/** Only clients with a verified native conversation channel can carry comments or interruption. */
export function nativeFeedback(client: AgentClient): boolean {
  return AGENT_CLIENTS[client.kind].feedback
}

/** The conversation reachable over that native channel, which every native delivery path needs. */
export function nativeConversation(client?: AgentClient): string | undefined {
  return client && nativeFeedback(client) ? client.sessionId : undefined
}

export const CANVAS_ONLY: AgentCapabilities = {
  interrupt: false,
  queue: false,
  steer: false,
  continue: false,
  reason:
    'Comments are unavailable for this client. Native conversation delivery is currently supported only in Codex App.'
}

export const CODEX_FEEDBACK_UNAVAILABLE: AgentCapabilities = {
  ...CANVAS_ONLY,
  reason:
    'Codex App comment delivery is unavailable. Open the original conversation in Codex App and retry. Comments stay saved; they are never delivered through hooks.'
}
