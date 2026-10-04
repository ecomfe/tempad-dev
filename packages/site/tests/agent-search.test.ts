import { AGENT_INTEGRATIONS } from '@tempad-dev/shared'
import { describe, expect, it } from 'vitest'

import { searchAgents } from '../src/utils/agent-search'

describe('agent search', () => {
  it.each(['', '   ', ' -_ '])('preserves browsing order for an empty query %j', (query) => {
    expect(searchAgents(AGENT_INTEGRATIONS, query)).toEqual(AGENT_INTEGRATIONS)
  })

  it.each([
    [' cc ', 'claude'],
    ['vsc', 'vscode'],
    ['VS-Code', 'vscode'],
    ['oc', 'opencode'],
    ['qc', 'qwen-code'],
    ['cb', 'codebuddy'],
    ['QwEn', 'qwen-code'],
    ['github copilot', 'github-copilot'],
    ['kiro', 'kiro-cli']
  ])('ranks %j with %s first', (query, id) => {
    expect(searchAgents(AGENT_INTEGRATIONS, query)[0]?.id).toBe(id)
  })

  it('requires the entire query in order within a single field', () => {
    expect(searchAgents(AGENT_INTEGRATIONS, 'not-an-agent')).toEqual([])
    expect(searchAgents(AGENT_INTEGRATIONS, 'xedoc')).toEqual([])
    expect(searchAgents([{ id: 'bar', name: 'Foo' }], 'foobar')).toEqual([])
  })

  it('prefers exact names, then prefixes, then word starts and consecutive matches', () => {
    const agents = ['X c a b', 'X cab', 'X scab', 'Cab tool', 'Cab'].map((name, index) => ({
      id: String(index),
      name
    }))
    expect(searchAgents(agents, 'cab').map(({ name }) => name)).toEqual([
      'Cab',
      'Cab tool',
      'X cab',
      'X c a b',
      'X scab'
    ])
  })

  it('penalizes gaps and uses the best alignment rather than the first match', () => {
    const agents = ['Z c---d', 'Z cd', 'Z c---cd'].map((name, index) => ({
      id: String(index),
      name
    }))
    expect(searchAgents(agents, 'cd').map(({ name }) => name)).toEqual([
      'Z cd',
      'Z c---cd',
      'Z c---d'
    ])
  })

  it('keeps equal scores stable without mutating the catalog', () => {
    const agents = [
      { id: 'one', name: 'Agent' },
      { id: 'two', name: 'Agent' }
    ]
    const before = [...agents]
    expect(searchAgents(agents, 'ag')).toEqual(before)
    expect(agents).toEqual(before)
  })

  it('finds manual setup by both its label and its visible alias', () => {
    const other = { id: 'other', name: 'Manual setup' }
    expect(searchAgents([other], 'manual')).toEqual([other])
    expect(searchAgents([other], 'other agents')).toEqual([other])
  })
})
