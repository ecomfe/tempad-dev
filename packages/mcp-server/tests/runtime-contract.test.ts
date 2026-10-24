import { describe, expect, it } from 'vitest'

const modulePath = '../scripts/runtime-contract.mjs'
const { canonicalJson, runtimeContract, compareContracts, compareReleaseWindow, summarize } =
  await import(modulePath)

function snapshot() {
  return {
    initialize: {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'tempad', version: '1' },
      instructions: 'Read first.'
    },
    tools: [
      {
        name: 'read',
        description: 'Read nodes.',
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: 'object',
          properties: { description: { type: 'string', description: 'Node description.' } },
          required: ['description']
        }
      }
    ]
  }
}

describe('released runtime contract screening', () => {
  it('ignores object and catalog ordering and package version, without mutating snapshots', () => {
    const before = snapshot()
    const after = JSON.parse(JSON.stringify(before))
    after.initialize.serverInfo.version = '2'
    after.tools[0].inputSchema = {
      required: ['description'],
      properties: { description: { description: 'Node description.', type: 'string' } },
      type: 'object'
    }
    const saved = JSON.stringify(before)
    expect(compareContracts(runtimeContract(before), runtimeContract(after))).toBe('identical')
    expect(JSON.stringify(before)).toBe(saved)
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(canonicalJson(JSON.parse('{"__proto__":{"value":1}}'))).toBe('{"__proto__":{"value":1}}')
  })

  it('separates actual schema documentation and instructions from executable contracts', () => {
    const before = snapshot()
    const after = snapshot()
    after.initialize.instructions = 'Read before writing.'
    after.tools[0]!.description = 'Inspect nodes.'
    after.tools[0]!.inputSchema.properties.description.description = 'Updated explanation.'
    expect(compareContracts(runtimeContract(before), runtimeContract(after))).toBe(
      'presentation-only'
    )
  })

  it.each(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])(
    'does not erase a literal description property in %s',
    (key) => {
      const before = snapshot()
      const after = snapshot()
      Object.assign(before.tools[0]!.inputSchema, { [key]: { description: { const: 'a' } } })
      Object.assign(after.tools[0]!.inputSchema, { [key]: { description: { const: 'b' } } })
      expect(compareContracts(runtimeContract(before), runtimeContract(after))).toBe('wire-changed')
    }
  )

  it.each(['const', 'default', 'enum', 'x-custom'])(
    'preserves descriptions inside %s data',
    (key) => {
      const before = snapshot()
      const after = snapshot()
      Object.assign(before.tools[0]!.inputSchema, { [key]: { description: 'a' } })
      Object.assign(after.tools[0]!.inputSchema, { [key]: { description: 'b' } })
      expect(compareContracts(runtimeContract(before), runtimeContract(after))).toBe('wire-changed')
    }
  )

  it('keeps annotations, output schemas, capabilities and schema array ordering significant', () => {
    for (const change of [
      (value: ReturnType<typeof snapshot>) => {
        value.tools[0]!.annotations.readOnlyHint = false
      },
      (value: ReturnType<typeof snapshot>) => {
        Object.assign(value.tools[0]!, { outputSchema: { type: 'string' } })
      },
      (value: ReturnType<typeof snapshot>) => {
        Object.assign(value.initialize.capabilities, { resources: {} })
      },
      (value: ReturnType<typeof snapshot>) => {
        value.tools[0]!.inputSchema.required = ['other', 'description']
      }
    ]) {
      const before = snapshot()
      const after = snapshot()
      change(after)
      expect(compareContracts(runtimeContract(before), runtimeContract(after))).toBe('wire-changed')
    }
  })

  it('sorts catalogs and rejects duplicate identifiers', () => {
    const before = snapshot()
    before.tools.push({ ...before.tools[0]!, name: 'write' })
    const after = { ...before, tools: [...before.tools].reverse() }
    expect(compareContracts(runtimeContract(before), runtimeContract(after))).toBe('identical')
    expect(() => runtimeContract({ ...before, tools: [before.tools[0], before.tools[0]] })).toThrow(
      'unique name'
    )
  })

  it('reports observed nearest-rank percentiles without inventing small-sample precision', () => {
    expect(summarize([30, 10, 20])).toEqual({ samples: 3, p50: 20, p95: 30, p99: 30, max: 30 })
    expect(() => summarize([])).toThrow('nonempty')
    expect(() => summarize([NaN])).toThrow('finite')
  })

  it('does not infer cumulative compatibility from reverted endpoints or matching wire hashes', () => {
    const results = [
      { version: '0.5.0', wireHash: 'a', presentationHash: 'a' },
      { version: '0.5.1', wireHash: 'b', presentationHash: 'b' },
      { version: '0.6.0', wireHash: 'a', presentationHash: 'a' }
    ]
    expect(compareReleaseWindow(results)).toContainEqual({
      from: '0.5.0',
      to: '0.6.0',
      adjacent: false,
      structural: 'identical',
      wireUnchangedThroughout: false,
      breakingReleaseBoundary: true,
      guidance: 'unreviewed',
      activation: 'not-established'
    })
    results[1]!.wireHash = 'a'
    const adjacent = compareReleaseWindow(results).find(
      (item: { to: string }) => item.to === '0.5.1'
    )
    expect(adjacent).toMatchObject({
      structural: 'presentation-only',
      breakingReleaseBoundary: false,
      activation: 'not-established'
    })
  })
})
