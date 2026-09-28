import { describe, expect, it } from 'vitest'

import { createTokenDiagnostics } from '@/mcp/tools/code/tokens/diagnostics'

describe('token diagnostics', () => {
  it('deduplicates, bounds samples, and isolates results', () => {
    const first = createTokenDiagnostics()
    const second = createTokenDiagnostics()
    first.report('token-resolution', 'same')
    first.report('token-resolution', 'same')
    expect(first.warnings()[0]?.message.match(/same/g)).toHaveLength(1)
    for (let i = 0; i < 100; i += 1) first.report('token-resolution', `${i}:${'long'.repeat(200)}`)
    first.report('token-definition', 'missing alias')
    expect(first.warnings().map((w) => w.type)).toEqual(['token-resolution', 'token-definition'])
    expect(first.warnings()[0]?.message.length).toBeLessThan(800)
    expect(first.warnings()[0]?.message).toContain('Additional issues omitted')
    expect(second.warnings()).toEqual([])
  })
})
