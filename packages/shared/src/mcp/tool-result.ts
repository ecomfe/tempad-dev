export const TOOL_RESULT_OUTCOME_ERROR =
  'Tool results must contain exactly one defined payload or error.'

export function hasToolResultOutcome(result: { error?: unknown; payload?: unknown }): boolean {
  return (result.payload !== undefined) !== (result.error !== undefined)
}
