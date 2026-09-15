import { describe, expect, it } from 'vitest'

import { CodexTurnState } from '../src/agent-clients/codex-turn-state'

const prefix = ['turnHistory', 'history', 'entitiesByKey']
const a = { turnId: 'a', status: 'inProgress' }
const b = { turnId: 'b', status: 'completed' }
const canonical = (entries: Record<string, unknown>) => ({
  id: 'thread',
  turns: [],
  turnHistory: { kind: 'canonical', history: { entitiesByKey: entries } }
})
const patch = (path: (string | number)[], value?: unknown, op = 'replace') => ({ op, path, value })

describe('Codex lifecycle projection', () => {
  it('ignores high-volume content without retaining or publishing it', () => {
    const state = new CodexTurnState(canonical({ key: { ...a, items: ['private'] } }), 'thread')
    expect(
      state.apply([
        patch([...prefix, 'key', 'items', 0], 'private'),
        patch(['turnHistory', 'history', 'orderedKeys'], ['key']),
        patch(['title'], 'private')
      ])
    ).toBe(false)
    expect(state.state()).toEqual({ turns: [a] })
    expect(JSON.stringify(state)).not.toContain('private')
    // Inspect Map values too: JSON.stringify does not traverse them.
    expect([
      ...(state as unknown as { canonical: Map<string, unknown> }).canonical.values()
    ]).toEqual([a])
  })

  it('tracks pending IDs, removals and moved canonical keys in one batch', () => {
    const state = new CodexTurnState(
      canonical({ pending: { turnId: null, status: 'inProgress' } }),
      'thread'
    )
    expect(state.state()).toEqual({ turns: [] })
    state.apply([patch([...prefix, 'pending', 'turnId'], 'a')])
    expect(state.state()).toEqual({ turns: [a] })
    state.apply([
      patch([...prefix, 'pending'], undefined, 'remove'),
      patch([...prefix, 'server-key'], a, 'add'),
      patch([...prefix, 'server-key', 'status'], 'completed'),
      patch([...prefix, 'other'], b, 'add')
    ])
    expect(state.state()).toEqual({ turns: [{ ...a, status: 'completed' }, b] })
    state.apply([patch([...prefix, 'server-key', 'status'], undefined, 'remove')])
    expect(state.state()).toEqual({ turns: [b] })
  })

  it.each([
    { path: prefix, value: { next: b } },
    { path: ['turnHistory', 'history'], value: { entitiesByKey: { next: b } } },
    { path: ['turnHistory'], value: canonical({ next: b }).turnHistory },
    { path: [], value: canonical({ next: b }) }
  ])('projects replacement containers at $path', ({ path, value }) => {
    const state = new CodexTurnState(canonical({ key: a }), 'thread')
    state.apply([patch(path, value)])
    expect(state.state()).toEqual({ turns: [b] })
  })

  it('preserves legacy array positions through insertions, removals and truncation', () => {
    const state = new CodexTurnState({ id: 'thread', turns: [a, b] }, 'thread')
    state.apply([
      patch(['turns', 0], { status: 'inProgress' }, 'add'),
      patch(['turns', 0, 'turnId'], 'new', 'add'),
      patch(['turns', 1], undefined, 'remove'),
      patch(['turns', 1, 'status'], 'failed')
    ])
    expect(state.state()).toEqual({
      turns: [
        { turnId: 'new', status: 'inProgress' },
        { ...b, status: 'failed' }
      ]
    })
    state.apply([patch(['turns', 'length'], 1)])
    expect(state.state().turns).toHaveLength(1)
    state.apply([patch(['turns', 0], b)])
    expect(state.state()).toEqual({ turns: [b] })
    state.apply([patch(['turns'], [a])])
    expect(state.state()).toEqual({ turns: [a] })
  })

  it('switches history representations without publishing intermediate empty state', () => {
    const state = new CodexTurnState({ id: 'thread', turns: [a] }, 'thread')
    state.apply([
      patch(['turnHistory', 'kind'], 'canonical', 'add'),
      patch(['turnHistory', 'history'], { entitiesByKey: { key: b } }, 'add'),
      patch(['turns'], [], 'replace')
    ])
    expect(state.state()).toEqual({ turns: [b] })
    state.apply([patch(['turns'], [a]), patch(['turnHistory'], undefined, 'remove')])
    expect(state.state()).toEqual({ turns: [a] })
  })

  it.each([
    { path: 'invalid' },
    patch([...prefix, 'key', 'status'], 42),
    patch([...prefix, 'key', 'status', 'nested'], 'completed'),
    patch([...prefix, 'missing', 'status'], 'completed'),
    patch(prefix, []),
    patch(['id'], 'other'),
    patch([], { id: 'other', turns: [] }),
    patch([...prefix, 'key'], a, 'move')
  ])('rejects unsupported lifecycle changes for resynchronization: %j', (change) => {
    const state = new CodexTurnState(canonical({ key: a }), 'thread')
    expect(() => state.apply([change])).toThrow()
  })

  it.each([
    patch(['turns', -1], a, 'add'),
    patch(['turns', 2], a, 'add'),
    patch(['turns', 1], a),
    patch(['turns', 'length'], 2),
    patch(['turns', 'length'], -1)
  ])('rejects out-of-range legacy changes: %j', (change) => {
    const state = new CodexTurnState({ id: 'thread', turns: [a] }, 'thread')
    expect(() => state.apply([change])).toThrow()
  })
})
