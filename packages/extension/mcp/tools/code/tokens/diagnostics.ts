import type { GetCodeWarning } from '@tempad-dev/shared'

export type TokenDiagnosticType = 'token-definition' | 'token-resolution'
export type ReportTokenDiagnostic = (type: TokenDiagnosticType, message: string) => void

const MAX_SAMPLES = 3
const MAX_SAMPLE_LENGTH = 180

export function createTokenDiagnostics() {
  const groups = new Map<TokenDiagnosticType, { samples: Set<string>; truncated: boolean }>()
  const report: ReportTokenDiagnostic = (type, message) => {
    let group = groups.get(type)
    if (!group) {
      group = { samples: new Set(), truncated: false }
      groups.set(type, group)
    }
    const sample =
      message.length > MAX_SAMPLE_LENGTH ? `${message.slice(0, MAX_SAMPLE_LENGTH - 1)}…` : message
    if (group.samples.has(sample)) return
    if (group.samples.size < MAX_SAMPLES) group.samples.add(sample)
    else group.truncated = true
  }
  return {
    report,
    warnings(): GetCodeWarning[] {
      return Array.from(groups, ([type, { samples, truncated }]) => ({
        type,
        message: `${
          type === 'token-resolution'
            ? 'Some token references could not be resolved for their consuming nodes and were preserved.'
            : 'Some token definitions or mode labels are unavailable or ambiguous.'
        } ${Array.from(samples).join(' ')}${truncated ? ' Additional issues omitted.' : ''}`
      }))
    }
  }
}
