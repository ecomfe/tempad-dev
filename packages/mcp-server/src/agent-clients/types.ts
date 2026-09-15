import type { AgentCapabilities, AgentClient } from '@tempad-dev/shared'

export type ClientBinding = {
  client: AgentClient
  turnId?: string
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
