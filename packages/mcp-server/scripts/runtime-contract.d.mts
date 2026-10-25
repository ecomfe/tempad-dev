export type RuntimeSnapshot = {
  initialize: {
    serverInfo: { version: string; [key: string]: unknown }
    instructions?: string
    [key: string]: unknown
  }
  tools?: Record<string, unknown>[]
  resources?: Record<string, unknown>[]
  resourceTemplates?: Record<string, unknown>[]
  prompts?: Record<string, unknown>[]
}
export function canonicalJson(value: unknown): string
export function digest(value: unknown): string
export function runtimeContract(snapshot: RuntimeSnapshot): {
  wire: unknown
  presentation: unknown
  wireHash: string
  presentationHash: string
}
export function compareContracts(
  before: { wireHash: string; presentationHash: string },
  after: { wireHash: string; presentationHash: string }
): 'wire-changed' | 'identical' | 'presentation-only'
export function compareReleaseWindow(results: unknown[]): unknown[]
export function summarize(values: number[]): Record<string, number>
